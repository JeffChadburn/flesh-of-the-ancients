import { Emitter, randomId } from "./transport.js";
/**
 * Round 22: same-browser transport over BroadcastChannel (tabs / windows of one browser). Used by
 * the automated tests and for trying multiplayer offline; no network at all. No voice streams.
 */
export class LocalTransport extends Emitter {
  constructor(cfg) { super(); this.cfg = cfg; this.selfId = randomId(); this.caps = { voice: false, kind: "local" }; this._seen = new Map(); this._pings = new Map(); }
  async join(code) {
    this.status = "joining";
    this.bc = new BroadcastChannel("fota-mp-" + code);
    this.bc.onmessage = (e) => this._rx(e.data);
    this._post({ k: "hi" });
    this._hb = setInterval(() => { this._post({ k: "hb" }); this._reap(); }, 1000);
    this.status = "live";
  }
  _post(o) { this.bc?.postMessage({ ...o, from: this.selfId }); }
  _rx(d) {
    if (!d || d.from === this.selfId || (d.to && d.to !== this.selfId)) return;
    const known = this._seen.has(d.from);
    if (d.k === "bye") { if (known) { this._seen.delete(d.from); this._peer("leave", d.from); } return; }
    if (!known && this._seen.size >= this.cfg.maxPlayers - 1) return;
    this._seen.set(d.from, performance.now());
    if (!known) { this._peer("join", d.from); if (d.k !== "hi") return this._post({ k: "hi", to: d.from }); this._post({ k: "hb", to: d.from }); }
    if (d.k === "msg") this._emit(d.ch, d.m, d.from);
    else if (d.k === "ping") this._post({ k: "pong", id: d.id, to: d.from });
    else if (d.k === "pong") { const r = this._pings.get(d.id); if (r) { this._pings.delete(d.id); r(); } }
  }
  _reap() { const now = performance.now(); for (const [id, t] of this._seen) if (now - t > 12000) { this._seen.delete(id); this._peer("leave", id); } }
  send(ch, m, to) { this._post({ k: "msg", ch, m, to }); }
  peers() { return [...this._seen.keys()]; }
  ping(id) {
    const t0 = performance.now(), pid = randomId(6);
    return new Promise((res) => { this._pings.set(pid, () => res(performance.now() - t0)); this._post({ k: "ping", id: pid, to: id }); setTimeout(() => { if (this._pings.delete(pid)) res(null); }, 3000); });
  }
  addStream() {} removeStream() {}
  leave() { this._post({ k: "bye" }); clearInterval(this._hb); this.bc?.close(); this.bc = null; for (const id of this._seen.keys()) this._peer("leave", id); this._seen.clear(); this.status = "idle"; }
}
