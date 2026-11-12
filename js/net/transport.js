import { NET } from "./config.js";
/**
 * Round 22: the one network interface the game uses. Every transport (p2p.js, local.js, server.js)
 * implements exactly this shape:
 *
 *   t.selfId                         this client's id (string)
 *   t.status                         "idle" | "joining" | "live" | "error"
 *   await t.join(room)               enter a room (5-letter code)
 *   t.leave()                        leave the room
 *   t.send(ch, msg, to?)             JSON-able msg on a short channel name, to one peer id or everyone
 *   t.on(ch, cb(msg, from))          receive
 *   t.onPeer(cb("join"|"leave", id)) membership changes
 *   t.peers()                        array of peer ids currently connected
 *   await t.ping(id)                 round-trip ms
 *   t.addStream(stream) / t.removeStream(stream) / t.onStream(cb(stream, id))   voice (optional)
 *   t.caps                           { voice: bool, kind: string }
 */
export async function makeTransport(kind = NET.transport) {
  if (kind === "local") return new (await import("./local.js")).LocalTransport(NET);
  if (kind === "server") return new (await import("./server.js")).ServerTransport(NET);
  return new (await import("./p2p.js")).P2PTransport(NET);
}

/** Shared listener plumbing for the transports. */
export class Emitter {
  constructor() { this._h = new Map(); this._peerCbs = []; this._streamCbs = []; this.status = "idle"; }
  on(ch, cb) { if (!this._h.has(ch)) this._h.set(ch, []); this._h.get(ch).push(cb); }
  onPeer(cb) { this._peerCbs.push(cb); }
  onStream(cb) { this._streamCbs.push(cb); }
  _emit(ch, msg, from) { for (const cb of this._h.get(ch) || []) { try { cb(msg, from); } catch (e) { console.warn("net handler", ch, e); } } }
  _peer(ev, id) { for (const cb of this._peerCbs) cb(ev, id); }
  _stream(s, id) { for (const cb of this._streamCbs) cb(s, id); }
}
export const randomId = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]).join("");
