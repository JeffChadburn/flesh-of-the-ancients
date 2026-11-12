/**
 * Round 24b: town themes, synthesized like the rest of the score.
 *  friendly: frame drum + shaker, a warm drone and a pentatonic wooden flute (D major pentatonic, 92 bpm)
 *  hostile:  taiko-like war drums, a dark minor-second drone and a breathy bone flute (D phrygian, 76 bpm)
 * Both play into the music bus (so the Music slider / mute apply); set(mode) crossfades between
 * them and the open-world score (main ducks the score's own bus while a town theme plays).
 */
const FRIENDLY = { bpm: 92, root: 62, scale: [0, 2, 4, 7, 9, 12, 14], drone: [38, 45] };
const HOSTILE = { bpm: 76, root: 62, scale: [0, 1, 3, 7, 8, 12, 13], drone: [26, 27] };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class TownMusic {
  constructor(ctx, dest) {
    this.ctx = ctx; this.mode = null; this.on = true;
    this.out = ctx.createGain(); this.out.gain.value = 0.9; this.out.connect(dest);
    this.layers = {};
    for (const k of ["friendly", "hostile"]) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.out); this.layers[k] = { g, next: 0, step: 0, live: false, drones: null, phrase: [] }; }
    const n = ctx.sampleRate; this.noise = ctx.createBuffer(1, n, n); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._iv = setInterval(() => this._tick(), 90);
  }
  setOn(on) { this.on = on; this.out.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.3); }
  /** null | "friendly" | "hostile": crossfade over ~2.5 s. */
  set(mode) {
    if (mode === this.mode) return;
    this.mode = mode; const t = this.ctx.currentTime;
    for (const k in this.layers) {
      const L = this.layers[k], on = k === mode;
      L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(on ? (k === "hostile" ? 0.85 : 0.75) : 0, t, on ? 0.9 : 0.8);
      if (on && !L.live) { L.live = true; L.next = t + 0.1; L.step = 0; this._drone(k, true); }
      if (!on) L.offAt = t + 5;
    }
  }
  get level() { return this.mode ? 1 : 0; }
  _tick() {
    const ctx = this.ctx, t = ctx.currentTime;
    if (ctx.state !== "running") return;
    for (const k in this.layers) {
      const L = this.layers[k];
      if (!L.live) continue;
      if (k !== this.mode && L.offAt && t > L.offAt) { L.live = false; this._drone(k, false); continue; }
      const P = k === "hostile" ? HOSTILE : FRIENDLY, e8 = 60 / P.bpm / 2;
      while (L.next < t + 0.35) { this._step(k, P, L, L.step, L.next, e8); L.step++; L.next += e8; }
    }
  }
  _drone(k, on) {
    const L = this.layers[k], ctx = this.ctx, t = ctx.currentTime;
    if (on && !L.drones) {
      const P = k === "hostile" ? HOSTILE : FRIENDLY, lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = k === "hostile" ? 260 : 420;
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(k === "hostile" ? 0.16 : 0.08, t, 1.5); lp.connect(g); g.connect(L.g);
      const oscs = P.drone.map((m, i) => { const o = ctx.createOscillator(); o.type = k === "hostile" ? "sawtooth" : "triangle"; o.frequency.value = mtof(m); o.detune.value = i ? 5 : -4; o.connect(lp); o.start(t); return o; });
      L.drones = { g, oscs };
    } else if (!on && L.drones) { const D = L.drones; D.g.gain.setTargetAtTime(0, t, 0.4); for (const o of D.oscs) o.stop(t + 2); L.drones = null; }
  }
  _step(k, P, L, i, t, e8) {
    const bar = i % 16, r = Math.random;
    if (k === "friendly") {
      if (bar % 4 === 0) this._drum(t, 92, 52, 0.55, 0.32);
      if (bar === 6 || bar === 14) this._drum(t, 120, 70, 0.3, 0.2);
      if (bar % 2 === 1) this._shaker(t, 0.08 + (bar % 4 === 3 ? 0.05 : 0));
      // flute: a phrase every 2 bars, notes on 8ths with rests
      if (bar === 0 && (i / 16) % 2 === 0) L.phrase = this._phrase(P, 8, 0.62);
      const ph = L.phrase[(i % 32) / 2 | 0];
      if (i % 2 === 0 && ph != null) this._flute(t, mtof(P.root + ph.n), e8 * 2 * ph.len * 0.95, 0.16, false);
    } else {
      const pat = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0];
      if (pat[bar]) this._drum(t, 70, 38, bar === 0 ? 0.95 : 0.6, 0.55, true);
      if (bar === 4 || bar === 12) this._clack(t);
      if (bar === 0 && (i / 16) % 2 === 1) L.phrase = this._phrase(P, 6, 0.45);
      const ph = L.phrase[(i % 32) / 2 | 0];
      if (i % 2 === 0 && ph != null && i % 32 >= 16) this._flute(t, mtof(P.root + ph.n - 12 + (r() < 0.2 ? 12 : 0)), e8 * 2 * ph.len, 0.14, true);
    }
  }
  _phrase(P, n, p) { const out = []; let j = 2 + (Math.random() * 3 | 0); for (let i = 0; i < 16; i++) { if (Math.random() < p && i < n * 2) { j = Math.max(0, Math.min(P.scale.length - 1, j + ((Math.random() * 5 | 0) - 2))); out[i] = { n: P.scale[j], len: 1 + (Math.random() < 0.3 ? 1 : 0) }; } } return out; }
  _drum(t, f0, f1, amp, dec, deep = false) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), dst = this.layers[deep ? "hostile" : "friendly"].g;
    o.type = "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(dst); o.start(t); o.stop(t + dec + 0.05);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = deep ? 900 : 1500;
    ng.gain.setValueAtTime(amp * (deep ? 0.35 : 0.2), t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s.connect(f); f.connect(ng); ng.connect(dst); s.start(t, Math.random() * 0.5, 0.08);
  }
  _shaker(t, amp) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 5200;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09); s.connect(f); f.connect(g); g.connect(this.layers.friendly.g); s.start(t, Math.random() * 0.5, 0.12);
  }
  _clack(t) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 6;
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); s.connect(f); f.connect(g); g.connect(this.layers.hostile.g); s.start(t, Math.random() * 0.5, 0.1);
  }
  _flute(t, hz, dur, amp, bone) {
    const ctx = this.ctx, dst = this.layers[bone ? "hostile" : "friendly"].g;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = bone ? "square" : "sine"; o2.type = "triangle"; o.frequency.value = hz; o2.frequency.value = hz * 2; lfo.frequency.value = 5.2; lg.gain.value = hz * 0.006;
    lfo.connect(lg); lg.connect(o.frequency); f.type = "lowpass"; f.frequency.value = bone ? hz * 2.2 : hz * 4;
    const g2 = ctx.createGain(); g2.gain.value = 0.18; o2.connect(g2); g2.connect(f); o.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.07); g.gain.setValueAtTime(amp * 0.85, t + Math.max(0.08, dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    g.connect(dst); for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.2); }
    const s = ctx.createBufferSource(), bf = ctx.createBiquadFilter(), bg = ctx.createGain(); s.buffer = this.noise; bf.type = "bandpass"; bf.frequency.value = hz * 1.5; bf.Q.value = 1.2;
    bg.gain.setValueAtTime(0.0001, t); bg.gain.exponentialRampToValueAtTime(amp * (bone ? 0.5 : 0.25), t + 0.04); bg.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(bf); bf.connect(bg); bg.connect(dst); s.start(t, Math.random() * 0.5, dur + 0.1);
  }
  dispose() { clearInterval(this._iv); }
}
