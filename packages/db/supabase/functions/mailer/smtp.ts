// A small SMTP client for the mailer: implicit TLS (port 465, as Gmail offers; Supabase's
// functions can't use ports 25 or 587), AUTH LOGIN, and plain-text UTF-8 messages. The
// connection is passed in, so tests can play the server.

export interface Duplex {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
}
export interface Message {
  from: string;
  to: string;
  subject: string;
  text: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Base64 of a UTF-8 string. */
export const b64 = (s: string) => {
  let bin = "";
  for (const byte of enc.encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
};

/** The address inside "Name <addr>", or the address itself. */
const addressOf = (s: string) => s.match(/<([^>]+)>/)?.[1] ?? s.trim();

/** The message as sent after DATA: headers, a base64 body in 76-character lines, dot-stuffing not needed for base64. */
export function formatMessage(m: Message, now = new Date(), id: string = crypto.randomUUID()): string {
  const name = m.from.match(/^(.*?)\s*</)?.[1];
  const body = b64(m.text).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${name ? `=?UTF-8?B?${b64(name)}?= <${addressOf(m.from)}>` : addressOf(m.from)}`,
    `To: <${addressOf(m.to)}>`,
    `Subject: =?UTF-8?B?${b64(m.subject)}?=`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${addressOf(m.from).split("@")[1] ?? "localhost"}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** One SMTP conversation: replies read line by line, multi-line replies joined. */
export class Smtp {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";

  constructor(private conn: Duplex) {
    this.reader = conn.readable.getReader();
    this.writer = conn.writable.getWriter();
  }

  private async line(): Promise<string> {
    for (;;) {
      const i = this.buffer.indexOf("\r\n");
      if (i >= 0) {
        const l = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 2);
        return l;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("smtp: connection closed");
      this.buffer += dec.decode(value, { stream: true });
    }
  }

  /** Reads one reply and checks its code. */
  async expect(code: number): Promise<string> {
    let text = "";
    for (;;) {
      const l = await this.line();
      text += `${l}\n`;
      if (l.length < 4 || l[3] !== "-") {
        if (Number(l.slice(0, 3)) !== code) throw new Error(`smtp: expected ${code}, got ${text.trim().slice(0, 200)}`);
        return text;
      }
    }
  }

  async send(command: string, code: number): Promise<string> {
    await this.writer.write(enc.encode(`${command}\r\n`));
    return this.expect(code);
  }

  /** Greeting, EHLO and AUTH LOGIN. */
  async open(host: string, user: string, pass: string) {
    await this.expect(220);
    await this.send(`EHLO ${host}`, 250);
    await this.send("AUTH LOGIN", 334);
    await this.send(b64(user), 334);
    await this.send(b64(pass), 235);
  }

  async mail(m: Message) {
    await this.send(`MAIL FROM:<${addressOf(m.from)}>`, 250);
    await this.send(`RCPT TO:<${addressOf(m.to)}>`, 250);
    await this.send("DATA", 354);
    await this.send(`${formatMessage(m)}\r\n.`, 250);
  }

  /** After a failed message, so the next one starts clean. */
  async reset() {
    await this.send("RSET", 250);
  }

  async quit() {
    try {
      await this.send("QUIT", 221);
    } catch {
      // Closing anyway.
    }
    this.conn.close();
  }
}
