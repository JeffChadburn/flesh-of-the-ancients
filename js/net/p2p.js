import { Emitter } from "./transport.js";
/**
 * Round 22: peer-to-peer WebRTC transport (Trystero 0.27, MIT, vendored). Signaling goes over free
 * public Nostr relays (no account, nothing stored by us); media/data go directly between players
 * (mesh: every player connects to every other, fine up to ~8). Public STUN only, so a few strict
 * networks (symmetric NAT / some carriers / corporate Wi-Fi) will need a TURN relay to connect.
 */
let lib = null;
export class P2PTransport extends Emitter {
  constructor(cfg) { super(); this.cfg = cfg; this.room = null; this.selfId = ""; this.caps = { voice: true, kind: "p2p" }; this._acts = new Map(); this._ids = new Set(); }
  async join(code) {
    this.status = "joining";
    lib = lib || (await import("../../vendor/trystero-nostr.min.js"));
    const rtcConfig = { iceServers: [...this.cfg.iceServers, ...this.cfg.turn] };
    this.room = lib.joinRoom({ appId: this.cfg.appId, password: "fota:" + code, maxUsers: this.cfg.maxPlayers, rtcConfig, identity: "none" }, code);
    this.selfId = this.selfId || lib.selfId || ("me-" + Math.random().toString(36).slice(2, 8));
    this.room.onPeerJoin(({ peerId }) => { this._ids.add(peerId); this._peer("join", peerId); });
    this.room.onPeerLeave(({ peerId }) => { this._ids.delete(peerId); this._peer("leave", peerId); });
    this.room.onPeerStream?.((stream, { peerId }) => this._stream(stream, peerId));
    this.connectFails = 0;
    this.room.onError?.((e) => { this.lastError = e; if (/connect/.test(e?.code || e?.type || String(e))) this.connectFails++; console.info("p2p:", e?.code || e?.message || e); });
    for (const ch of this._h.keys()) this._act(ch);
    this.status = "live";
  }
  _act(ch) {
    if (!this.room) return null;
    if (!this._acts.has(ch)) {
      const a = this.room.makeAction(ch);
      a.onMessage((msg, meta) => this._emit(ch, msg, meta.peerId));
      this._acts.set(ch, a);
    }
    return this._acts.get(ch);
  }
  on(ch, cb) { super.on(ch, cb); this._act(ch); }
  send(ch, msg, to) { const a = this._act(ch); if (!a) return; a.send(msg, to ? { target: to } : undefined)?.catch?.(() => {}); }
  peers() { return [...this._ids]; }
  async ping(id) { try { return await this.room.ping(id); } catch { return null; } }
  addStream(s) { this._streams = [...(this._streams || []), s]; this.room?.addStream(s); }
  removeStream(s) { this._streams = (this._streams || []).filter((x) => x !== s); try { this.room?.removeStream(s); } catch {} }
  leave() { try { this.room?.leave(); } catch {} this.room = null; this._acts.clear(); for (const id of this._ids) this._peer("leave", id); this._ids.clear(); this.status = "idle"; }
}
