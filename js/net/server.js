import { Emitter } from "./transport.js";
/**
 * Round 22: STUB client for a future authoritative WebSocket server (same interface as p2p.js).
 * Select it with NET.transport = "server" and NET.serverUrl (or ?net=server&srv=wss://host/path).
 * Wire protocol (JSON text frames), matching docs/server-reference.mjs:
 *   client → server  {op:"join", room, app}  {op:"msg", ch, m, to?}  {op:"ping", id}  {op:"leave"}
 *   server → client  {op:"welcome", self, peers:[id]}  {op:"peer", ev:"join"|"leave", id}
 *                    {op:"msg", ch, m, from}  {op:"pong", id}  {op:"error", reason}
 * A real server should validate/clamp state, own the world seed and authoritative data (trades,
 * settlements), and only forward state to players in each other's area of interest. Voice over a
 * server needs an SFU (e.g. LiveKit / mediasoup); until then caps.voice is false here.
 */
export class ServerTransport extends Emitter {
  constructor(cfg) { super(); this.cfg = cfg; this.selfId = ""; this.caps = { voice: false, kind: "server" }; this._ids = new Set(); this._pings = new Map(); }
  join(code) {
    if (!this.cfg.serverUrl) { this.status = "error"; return Promise.reject(new Error("No server URL configured (NET.serverUrl)")); }
    this.status = "joining";
    return new Promise((res, rej) => {
      const ws = (this.ws = new WebSocket(this.cfg.serverUrl));
      ws.onopen = () => ws.send(JSON.stringify({ op: "join", room: code, app: this.cfg.appId }));
      ws.onerror = () => { this.status = "error"; rej(new Error("server unreachable")); };
      ws.onclose = () => { for (const id of this._ids) this._peer("leave", id); this._ids.clear(); if (this.status === "live") this.status = "error"; };
      ws.onmessage = (e) => {
        let d; try { d = JSON.parse(e.data); } catch { return; }
        if (d.op === "welcome") { this.selfId = d.self; this.status = "live"; for (const id of d.peers || []) { this._ids.add(id); this._peer("join", id); } res(); }
        else if (d.op === "peer") { if (d.ev === "join") this._ids.add(d.id); else this._ids.delete(d.id); this._peer(d.ev, d.id); }
        else if (d.op === "msg") this._emit(d.ch, d.m, d.from);
        else if (d.op === "pong") { const r = this._pings.get(d.id); if (r) { this._pings.delete(d.id); r(); } }
        else if (d.op === "error") { this.status = "error"; rej(new Error(d.reason)); }
      };
    });
  }
  send(ch, m, to) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: "msg", ch, m, to })); }
  peers() { return [...this._ids]; }
  ping() { const t0 = performance.now(), id = Math.random().toString(36).slice(2); return new Promise((res) => { this._pings.set(id, () => res(performance.now() - t0)); this.send0({ op: "ping", id }); setTimeout(() => { if (this._pings.delete(id)) res(null); }, 3000); }); }
  send0(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  addStream() {} removeStream() {}
  leave() { this.send0({ op: "leave" }); this.ws?.close(); this.ws = null; for (const id of this._ids) this._peer("leave", id); this._ids.clear(); this.status = "idle"; }
}
