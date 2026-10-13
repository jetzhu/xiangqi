// Sends a game's reports to the server's queue in order, without ever holding up play: a report
// that fails stays first in line and is tried again, so a server outage only delays the record
// (docs/v0.3-online-design.md, "If the server goes offline mid-game"). Kept in sessionStorage,
// so a reload mid-game doesn't lose what was waiting.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Report } from "@xq/online";
import { reportGame } from "./api.js";

const key = (game: string) => `xq-reports:${game}`;

export class Reporter {
  private queue: Report[];
  private busy = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: () => Promise<SupabaseClient>,
    private readonly game: string,
  ) {
    let saved: Report[] = [];
    try {
      saved = JSON.parse(sessionStorage.getItem(key(game)) ?? "[]") as Report[];
    } catch {
      // No storage: keep the queue in memory only.
    }
    this.queue = saved;
    if (saved.length) void this.flush();
  }

  report(r: Report) {
    this.queue.push(r);
    this.save();
    void this.flush();
  }

  /** Waits until everything queued has been sent (or `ms` passes). */
  async drained(ms = 10_000): Promise<boolean> {
    const until = Date.now() + ms;
    while (this.queue.length && Date.now() < until) {
      await this.flush();
      if (this.queue.length) await new Promise((r) => setTimeout(r, 300));
    }
    return this.queue.length === 0;
  }

  private save() {
    try {
      if (this.queue.length) sessionStorage.setItem(key(this.game), JSON.stringify(this.queue));
      else sessionStorage.removeItem(key(this.game));
    } catch {
      // Storage full or blocked: the queue still lives in memory.
    }
  }

  private async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      const sb = await this.client();
      while (this.queue.length) {
        await reportGame(sb, this.game, this.queue[0]!);
        this.queue.shift();
        this.save();
      }
    } catch (e) {
      // A report the server will never take is dropped; anything else is tried again.
      if (e instanceof Error && /not your game|bad report/.test(e.message)) {
        this.queue.shift();
        this.save();
      }
      if (!this.retry) this.retry = setTimeout(() => ((this.retry = null), void this.flush()), 3_000);
    } finally {
      this.busy = false;
    }
  }
}
