// The link between the two players' browsers (docs/v0.3-online-design.md, "Architecture"): a
// direct WebRTC data channel, set up over the game's private Realtime channel; or, when a direct
// link can't be made or a player mustn't share their network address, the game relayed over that
// channel. Once the direct link is open the channel is left, so a game holds no Realtime
// connection; it's joined again only to set up a new link.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { type LinkMsg, parseLinkMsg } from "@xq/online";

export type LinkState = "connecting" | "direct" | "relay" | "closed";

/** The set-up channel: Realtime in the site, a BroadcastChannel in the browser tests. */
export interface Signaling {
  send(payload: Signal): void;
  onSignal(cb: (payload: Signal) => void): void;
  /** Whether the other player is on the channel now (Presence), and when that changes. */
  onPeer(cb: (present: boolean) => void): void;
  join(): Promise<void>;
  leave(): Promise<void>;
}

export type Signal =
  | { type: "ready"; from: "red" | "black" }
  | { type: "sdp"; from: "red" | "black"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: "red" | "black"; candidate: RTCIceCandidateInit }
  | { type: "relay"; from: "red" | "black" }
  | { type: "m"; from: "red" | "black"; msg: LinkMsg };

/** Free public STUN servers: they help two browsers find a path through home routers. No TURN (no free one is sure to stay free). */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
/** Give up on a direct link after this long and relay instead. */
export const DIRECT_TIMEOUT_MS = 10_000;

export interface LinkOptions {
  me: "red" | "black";
  /** Relay from the start: a player is under 16 or asked not to share their network address. */
  relay: boolean;
  signaling: Signaling;
  onMessage(msg: LinkMsg): void;
  onState(state: LinkState): void;
  /** Relay only: the opponent is still on the channel (stands in for heartbeats there). */
  onPeerAlive?(): void;
  iceServers?: RTCIceServer[];
}

export class Link {
  state: LinkState = "connecting";
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private joined = false;
  private relaying: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private peerPresent = false;
  private aliveTimer: ReturnType<typeof setInterval> | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private offeredAt = 0;
  private outbox: LinkMsg[] = [];

  constructor(private readonly o: LinkOptions) {
    this.relaying = o.relay;
    o.signaling.onSignal((s) => void this.onSignal(s));
    o.signaling.onPeer((present) => {
      this.peerPresent = present;
      if (present && !this.relaying && this.state !== "direct") this.say({ type: "ready", from: o.me });
    });
  }

  async start() {
    await this.join();
    if (this.relaying) this.setState("relay");
    else this.connect();
  }

  send(msg: LinkMsg) {
    if (msg.t !== "ping" && msg.t !== "pong") this.trace(`send ${msg.t} (${this.state}, dc ${this.dc?.readyState ?? "none"})`);
    if (this.state === "direct" && this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
    else if (this.state === "relay") this.say({ type: "m", from: this.o.me, msg });
    // No link right now: keep it for when there is one (heartbeats aren't worth keeping). The
    // game also catches up with hello/sync, so nothing depends on this queue.
    else if (msg.t !== "ping" && msg.t !== "pong") this.outbox.push(msg);
  }

  private flushOutbox() {
    const out = this.outbox;
    this.outbox = [];
    for (const m of out) this.send(m);
  }

  async close() {
    this.clearTimer();
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    this.dc?.close();
    this.pc?.close();
    this.setState("closed");
    if (this.joined) await this.o.signaling.leave().catch(() => {});
    this.joined = false;
  }

  private async join() {
    if (this.joined) return;
    this.joined = true;
    await this.o.signaling.join();
    if (!this.aliveTimer) {
      // In a relayed game, Presence says the opponent is still there between messages.
      this.aliveTimer = setInterval(() => {
        if (this.state === "relay" && this.peerPresent) this.o.onPeerAlive?.();
      }, 1_500);
    }
  }

  private say(s: Signal) {
    if (this.joined) this.o.signaling.send(s);
  }

  private setState(s: LinkState) {
    if (this.state === s) return;
    this.trace(`state ${this.state} -> ${s}`);
    this.state = s;
    this.o.onState(s);
    if (s === "direct" || s === "relay") this.flushOutbox();
  }

  /** Starts (again) on a direct link: announce, and Red makes the offer when both are there. */
  private connect() {
    this.setState("connecting");
    this.say({ type: "ready", from: this.o.me });
    this.clearTimer();
    this.timer = setTimeout(() => this.fallBack(), DIRECT_TIMEOUT_MS);
  }

  private fallBack() {
    if (this.state === "direct" || this.state === "closed") return;
    this.relaying = true;
    this.say({ type: "relay", from: this.o.me });
    this.pc?.close();
    this.pc = null;
    this.setState("relay");
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private newPeer(): RTCPeerConnection {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers ?? ICE_SERVERS });
    this.pc = pc;
    this.pendingIce = [];
    pc.onicecandidate = (e) => e.candidate && this.say({ type: "ice", from: this.o.me, candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.lost();
    };
    pc.ondatachannel = (e) => this.useChannel(e.channel);
    return pc;
  }

  private useChannel(dc: RTCDataChannel) {
    this.dc = dc;
    const opened = () => {
      if (dc !== this.dc || this.state === "direct") return;
      this.clearTimer();
      this.setState("direct");
      // No Realtime needed while the direct link holds.
      if (this.joined) {
        this.joined = false;
        void this.o.signaling.leave().catch(() => {});
      }
    };
    dc.onopen = opened;
    // The answering side can be handed a channel that's already open, and then no open event comes.
    if (dc.readyState === "open") opened();
    dc.onmessage = (e) => {
      const msg = parseLinkMsg(e.data);
      if (msg && msg.t !== "ping" && msg.t !== "pong") this.trace(`recv ${msg.t}`);
      if (msg) this.o.onMessage(msg);
    };
    dc.onclose = () => {
      this.trace("dc closed");
      if (dc === this.dc) this.lost();
    };
  }

  /** The direct link broke: rejoin the channel and make a new one (or relay, if that fails). */
  private lost() {
    if (this.state === "closed" || this.relaying) return;
    this.dc = null;
    this.offeredAt = 0;
    void this.join().then(() => this.connect());
  }

  /** In the browser tests only: what the link does, in the console. */
  private trace(what: string) {
    if ((globalThis as { __xqTabSignaling?: boolean }).__xqTabSignaling) console.debug(`[link ${this.o.me}] ${what}`);
  }

  private async onSignal(s: Signal) {
    if (s.from === this.o.me || this.state === "closed") return;
    if (s.type !== "m") this.trace(`got ${s.type}${s.type === "sdp" ? ` ${s.sdp.type}` : ""}`);
    switch (s.type) {
      case "m":
        if (this.relaying) {
          const msg = parseLinkMsg(s.msg);
          if (msg) this.o.onMessage(msg);
        }
        return;
      case "relay":
        if (!this.relaying) {
          this.relaying = true;
          this.clearTimer();
          this.pc?.close();
          this.pc = null;
          this.setState("relay");
        }
        return;
      case "ready":
        if (this.relaying) return this.say({ type: "relay", from: this.o.me });
        if (this.o.me === "red") {
          // Red offers: a fresh connection when Black says it's ready, unless one is open or just offered.
          // A connection still being set up gets 8 s before it's replaced.
          const settingUp = this.pc && ["new", "connecting"].includes(this.pc.connectionState);
          if (this.state === "direct" || Date.now() - this.offeredAt < (settingUp ? 8_000 : 3_000)) return;
          this.offeredAt = Date.now();
          const pc = this.newPeer();
          this.useChannel(pc.createDataChannel("game", { ordered: true }));
          await pc.setLocalDescription(await pc.createOffer());
          this.say({ type: "sdp", from: this.o.me, sdp: pc.localDescription!.toJSON() });
        } else if (this.state !== "direct") {
          // Black answers Red's ready with its own, so Red knows to offer.
          this.say({ type: "ready", from: this.o.me });
        }
        return;
      case "sdp": {
        if (this.relaying) return;
        if (s.sdp.type === "offer") {
          const pc = this.newPeer();
          await pc.setRemoteDescription(s.sdp);
          await this.flushIce();
          await pc.setLocalDescription(await pc.createAnswer());
          this.say({ type: "sdp", from: this.o.me, sdp: pc.localDescription!.toJSON() });
        } else if (this.pc) {
          await this.pc.setRemoteDescription(s.sdp);
          await this.flushIce();
        }
        return;
      }
      case "ice":
        if (this.relaying) return;
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(s.candidate).catch(() => {});
        else this.pendingIce.push(s.candidate);
        return;
    }
  }

  private async flushIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }
}

/** The set-up channel over Supabase Realtime: the private channel "game:<id>", with Presence. */
export function realtimeSignaling(client: () => Promise<SupabaseClient>, gameId: string, me: "red" | "black"): Signaling {
  let sb: SupabaseClient | null = null;
  let ch: RealtimeChannel | null = null;
  let onSignal: (s: Signal) => void = () => {};
  let onPeer: (present: boolean) => void = () => {};
  return {
    send: (payload) => void ch?.send({ type: "broadcast", event: "s", payload }),
    onSignal: (cb) => void (onSignal = cb),
    onPeer: (cb) => void (onPeer = cb),
    async join() {
      sb ??= await client();
      await sb.realtime.setAuth();
      const c = sb.channel(`game:${gameId}`, { config: { private: true, broadcast: { self: false }, presence: { key: me } } });
      ch = c;
      c.on("broadcast", { event: "s" }, ({ payload }) => onSignal(payload as Signal));
      c.on("presence", { event: "sync" }, () => onPeer(Object.keys(c.presenceState()).includes(me === "red" ? "black" : "red")));
      await new Promise<void>((resolve, reject) => {
        c.subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            void c.track({ at: Date.now() });
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
        });
      });
    },
    async leave() {
      const c = ch;
      ch = null;
      if (c && sb) await sb.removeChannel(c);
    },
  };
}

/** The set-up channel between two tabs of one browser (the browser tests): a BroadcastChannel. */
export function tabSignaling(gameId: string, me: "red" | "black"): Signaling {
  let bc: BroadcastChannel | null = null;
  let onSignal: (s: Signal) => void = () => {};
  let onPeer: (present: boolean) => void = () => {};
  let beat: ReturnType<typeof setInterval> | null = null;
  let lastPeer = 0;
  return {
    send: (payload) => bc?.postMessage({ kind: "s", payload }),
    onSignal: (cb) => void (onSignal = cb),
    onPeer: (cb) => void (onPeer = cb),
    async join() {
      bc = new BroadcastChannel(`xq-game:${gameId}`);
      bc.onmessage = (e: MessageEvent<{ kind: string; from?: string; payload?: Signal }>) => {
        if (e.data.kind === "s" && e.data.payload) onSignal(e.data.payload);
        if (e.data.kind === "here" && e.data.from !== me) {
          const was = Date.now() - lastPeer < 3_000;
          lastPeer = Date.now();
          if (!was) onPeer(true);
        }
      };
      const here = () => bc?.postMessage({ kind: "here", from: me });
      here();
      beat = setInterval(() => {
        here();
        if (lastPeer && Date.now() - lastPeer > 3_000) {
          lastPeer = 0;
          onPeer(false);
        }
      }, 1_000);
    },
    async leave() {
      if (beat) clearInterval(beat);
      bc?.close();
      bc = null;
    },
  };
}
