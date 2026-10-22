// The mailer's SMTP client against a scripted server, and its templates.
import { describe, expect, it } from "vitest";
import { Smtp, b64, formatMessage } from "../supabase/functions/mailer/smtp.js";
import { render } from "../supabase/functions/mailer/templates.js";

/** A server that answers each command from a script and records what it was sent. */
function server(replies: string[]) {
  const sent: string[] = [];
  const enc = new TextEncoder();
  let push!: (s: string) => void;
  const readable = new ReadableStream<Uint8Array>({ start: (c) => void (push = (s) => c.enqueue(enc.encode(s))) });
  let pending = "";
  const next = () => {
    const r = replies.shift();
    if (r !== undefined) push(r);
  };
  const writable = new WritableStream<Uint8Array>({
    write: (chunk) => {
      pending += new TextDecoder().decode(chunk);
      // A command ends with CRLF; the message body ends with CRLF.CRLF and gets one reply.
      while (pending.includes("\r\n")) {
        if (sent.at(-1) === "DATA" && !pending.includes("\r\n.\r\n")) return;
        const end = sent.at(-1) === "DATA" ? pending.indexOf("\r\n.\r\n") + 5 : pending.indexOf("\r\n") + 2;
        sent.push(pending.slice(0, end - 2));
        pending = pending.slice(end);
        next();
      }
    },
  });
  next(); // the greeting
  return { conn: { readable, writable, close: () => {} }, sent };
}

describe("the mailer's SMTP client", () => {
  it("signs in and sends a UTF-8 message", async () => {
    const s = server(["220 smtp.example ESMTP\r\n", "250-smtp.example\r\n250 AUTH LOGIN\r\n", "334 VXNlcm5hbWU6\r\n", "334 UGFzc3dvcmQ6\r\n", "235 ok\r\n", "250 ok\r\n", "250 ok\r\n", "354 go\r\n", "250 queued\r\n", "221 bye\r\n"]);
    const smtp = new Smtp(s.conn);
    await smtp.open("xiangqi-mailer", "me@gmail.com", "app pass");
    await smtp.mail({ from: "Xiangqi School 象棋学堂 <me@gmail.com>", to: "mum@example.com", subject: "请确认", text: "你好\nHello" });
    await smtp.quit();
    expect(s.sent.slice(0, 7)).toEqual(["EHLO xiangqi-mailer", "AUTH LOGIN", b64("me@gmail.com"), b64("app pass"), "MAIL FROM:<me@gmail.com>", "RCPT TO:<mum@example.com>", "DATA"]);
    const msg = s.sent[7]!;
    expect(msg).toContain(`Subject: =?UTF-8?B?${b64("请确认")}?=`);
    expect(msg).toContain("To: <mum@example.com>");
    expect(Buffer.from(msg.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("你好\nHello");
    expect(s.sent.at(-1)).toBe("QUIT");
  });

  it("fails on an unexpected reply, such as a wrong password", async () => {
    const s = server(["220 hi\r\n", "250 ok\r\n", "334 x\r\n", "334 y\r\n", "535 5.7.8 Username and Password not accepted\r\n"]);
    await expect(new Smtp(s.conn).open("h", "u", "bad")).rejects.toThrow(/expected 235, got 535/);
  });

  it("keeps header lines short and the body in 76-character lines", () => {
    const m = formatMessage({ from: "a@b.c", to: "d@e.f", subject: "x", text: "y".repeat(500) }, new Date("2026-10-21T00:00:00Z"), "id1");
    expect(m).toContain("Message-ID: <id1@b.c>");
    expect(Math.max(...m.split("\r\n").map((l) => l.length))).toBeLessThanOrEqual(78);
  });
});

describe("the mailer's templates", () => {
  it("writes the guardian's email in the child's language first, with the link to the guardian page", () => {
    const zh = render("guardian-confirm", "zh", { student: "kid_wei", coach: "coach_lin", family: false, token: "abc" }, "https://jetzhu.github.io/xiangqi/");
    expect(zh.subject).toBe("请确认：kid_wei 想请 coach_lin 担任象棋教练");
    expect(zh.text.indexOf("您好")).toBeLessThan(zh.text.indexOf("Hello"));
    expect(zh.text).toContain("https://jetzhu.github.io/xiangqi/zh/guardian/?t=abc");
    const en = render("guardian-confirm", "en", { student: "kid_wei", coach: "coach_lin", family: true, token: "abc" }, "https://x.test");
    expect(en.text).toContain("as their parent or guardian");
    expect(() => render("nope", "en", {}, "https://x.test")).toThrow(/no template/);
  });

  it("writes the email-change messages with their links and dates", () => {
    const old = render("email-change-old", "en", { token: "t1", new: "n***@example.com", due: "2026-11-02T10:00:00Z", reminder: true }, "https://x.test");
    expect(old.subject).toBe("Reminder: your Xiangqi School email is about to change");
    expect(old.text).toContain("https://x.test/en/email-change/?t=t1");
    expect(old.text).toContain("November 2, 2026");
    expect(render("email-change-new", "zh", { token: "t2", username: "acc" }, "https://x.test").text).toContain("https://x.test/zh/email-change/?t=t2");
    expect(render("email-changed", "en", { token: "t3", new: "n***@example.com" }, "https://x.test").text).toContain("within 30 days");
    expect(render("email-change-denied", "en", { days: 20 }, "https://x.test").text).toContain("for 20 days");
    expect(render("coach-request", "zh", {}, "https://x.test").text).toContain("https://x.test/zh/coach/");
  });
});
