import { CinematicScore } from "./music.js";
/**
 * Procedural cave ambience (drips, flow, echo) plus a generated creepy score:
 * detuned low drones, slow dissonant pads, distant bell tones, creaks, whispers
 * and sub thumps. Everything is synthesised with Web Audio; no audio files.
 * The score's density and loudness follow setMood(movement, depth).
 * Starts after a user gesture.
 */

export class CaveAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem("cavern-muted") === "1"; } catch {}
    this.started = false;
    this.flowGain = null;
    this.fallGain = null;
    this.master = null;
    this._dripTimer = 0;
    this.musicOn = true;
    try { this.musicOn = localStorage.getItem("cavern-music") !== "0"; } catch {}
    this.music = null;
    this.moodMove = 0;
    this.moodDepth = 0;
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    try { localStorage.setItem("cavern-music", this.musicOn ? "1" : "0"); } catch {}
    if (this.music) this.music.setOn(this.musicOn);
    return this.musicOn;
  }

  get intensity() {
    return this.music ? this.music.tension : 0;
  }

  /** Scene info from the game: zone, move 0..1, running, depth 0..1, tight, dark 0..1, dt. */
  setScene(sc) {
    this.moodMove = sc.move || 0;
    this.moodDepth = sc.depth || 0;
    this.zone = sc.zone;
    if (this.music) this.music.update(sc);
  }

  /** Back-compat wrapper. */
  setMood(movement, depth) {
    this.setScene({ move: movement, depth, zone: null, dark: 1, tight: false, running: false });
  }

  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem("cavern-muted", this.muted ? "1" : "0"); } catch {}
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
  }

  toggle() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  async resume() {
    if (this.started) {
      if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    // Simple echo / cave-like delay.
    const delay = this.ctx.createDelay(1.2);
    delay.delayTime.value = 0.28;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.22;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 2400;
    this.master.connect(filt);
    filt.connect(this.ctx.destination);
    filt.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.ctx.destination);
    this.echoWet = wet;
    this.echoFb = fb;
    // Outdoor night ambience bus (wind gusts, crickets, an owl); silent underground.
    this.outGain = this.ctx.createGain();
    this.outGain.gain.value = this.outdoor ? 1 : 0;
    this.outGain.connect(this.master);
    {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380; lp.Q.value = 0.6;
      const gust = ctx.createOscillator(); gust.frequency.value = 0.09;
      const gg = ctx.createGain(); gg.gain.value = 220; gust.connect(gg); gg.connect(lp.frequency);
      const wg = ctx.createGain(); wg.gain.value = 0.22;
      const amp = ctx.createOscillator(); amp.frequency.value = 0.053;
      const ag = ctx.createGain(); ag.gain.value = 0.12; amp.connect(ag); ag.connect(wg.gain);
      src.connect(lp); lp.connect(wg); wg.connect(this.outGain);
      src.start(); gust.start(); amp.start();
      this.windGain = wg;
      // rain: a hiss (high band) + a soft roar (low band), level set by setAmbience
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0; this.rainGain.connect(this.outGain);
      const hi = ctx.createBiquadFilter(); hi.type = "bandpass"; hi.frequency.value = 3200; hi.Q.value = 0.5;
      const lo = ctx.createBiquadFilter(); lo.type = "lowpass"; lo.frequency.value = 700;
      const lg = ctx.createGain(); lg.gain.value = 0.6;
      src.connect(hi); hi.connect(this.rainGain); src.connect(lo); lo.connect(lg); lg.connect(this.rainGain);
      // waterfall / stream outdoors
      this.waterOut = ctx.createGain(); this.waterOut.gain.value = 0; this.waterOut.connect(this.outGain);
      const wb = ctx.createBiquadFilter(); wb.type = "bandpass"; wb.frequency.value = 900; wb.Q.value = 0.4;
      src.connect(wb); wb.connect(this.waterOut);
    }

    this.flowGain = this.ctx.createGain();
    this.flowGain.gain.value = 0.0;
    this.flowGain.connect(this.master);
    this._noiseDrone(this.flowGain, 400, 0.35);

    this.fallGain = this.ctx.createGain();
    this.fallGain.gain.value = 0.0;
    this.fallGain.connect(this.master);
    this._noiseDrone(this.fallGain, 1200, 0.7);

    this.started = true;
    this._scheduleDrips();
    if (this.outdoor) this.setOutdoor(true);
    try { this.music = new CinematicScore(this.ctx, this.master, this.musicOn); } catch (err) { console.warn("music failed", err); }
  }

  _noiseDrone(dest, cutoff, q = 0.4) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.04;
      data[i] = last;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = cutoff;
    bp.Q.value = q;
    src.connect(bp);
    bp.connect(dest);
    src.start();
  }

  /** Outdoors: wind + insects, no drips, almost no cave echo. */
  setOutdoor(on) {
    this.outdoor = !!on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.outGain.gain.setTargetAtTime(on ? 1 : 0, t, 0.6);
    if (on) { this.flowGain?.gain.setTargetAtTime(0, t, 0.3); this.fallGain?.gain.setTargetAtTime(0, t, 0.3); }
    this.echoWet.gain.setTargetAtTime(on ? 0.03 : 0.22, t, 0.4);
    this.echoFb.gain.setTargetAtTime(on ? 0.1 : 0.28, t, 0.4);
    if (on && !this._nightTimer) {
      const night = () => {
        this._nightTimer = setTimeout(night, 260 + Math.random() * 900);
        if (!this.outdoor || this.muted || !this.started) return;
        const a = this.amb || { night: 1, dawn: 0, day: 0, rain: 0 };
        const dry = 1 - Math.min(1, a.rain);
        const pN = a.night * 0.9 * dry, pB = (a.dawn * 1.6 + a.day * 0.45) * dry, r = Math.random() * Math.max(1, pN + pB);
        if (r < pN) { if (Math.random() < 0.012) this._owl(); else this._cricket(); }
        else if (r < pN + pB) this._bird(a.dawn > 0.3 && Math.random() < 0.3);
      };
      night();
    }
  }

  _cricket() {
    const ctx = this.ctx, t = ctx.currentTime;
    const f = 4200 + Math.random() * 900, n = 2 + Math.floor(Math.random() * 3), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain(); g.gain.value = 0;
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    o.connect(g);
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan); pan.connect(this.outGain); } else g.connect(this.outGain);
    const a = 0.012 + Math.random() * 0.02;
    for (let i = 0; i < n; i++) { const s = t + i * 0.07; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(a, s + 0.012); g.gain.linearRampToValueAtTime(0, s + 0.045); }
    o.start(t); o.stop(t + n * 0.07 + 0.05);
  }

  /** Outdoor ambience levels from time of day / weather: { night, dawn, day, rain, wind, storm, water }. */
  setAmbience(a) {
    this.amb = a;
    if (!this.ctx || !this.windGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.12 + a.wind * 0.3 + a.storm * 0.15, t, 1.5);
    this.rainGain.gain.setTargetAtTime(Math.min(1.6, a.rain) * 0.32, t, 1.2);
    this.waterOut.gain.setTargetAtTime(Math.min(1, a.water || 0) * 0.5, t, 0.5);
  }

  _bird(song = false) {
    const ctx = this.ctx, t = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain(); g.gain.value = 0;
    const o = ctx.createOscillator(); o.type = "sine";
    o.connect(g);
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan); pan.connect(this.outGain); } else g.connect(this.outGain);
    const base = 2200 + Math.random() * 1800, n = song ? 6 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 3);
    const a = 0.02 + Math.random() * 0.025;
    let s = t;
    for (let i = 0; i < n; i++) {
      const len = song ? 0.06 + Math.random() * 0.05 : 0.08 + Math.random() * 0.06;
      const f0 = base * (song ? 1 + Math.sin(i * 1.7) * 0.25 : 1), f1 = f0 * (0.7 + Math.random() * 0.7);
      o.frequency.setValueAtTime(f0, s); o.frequency.exponentialRampToValueAtTime(f1, s + len);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(a, s + 0.01); g.gain.linearRampToValueAtTime(0, s + len);
      s += len + (song ? 0.02 : 0.05 + Math.random() * 0.08);
    }
    o.start(t); o.stop(s + 0.05);
  }

  /** Thunder `dist` (0.3 near .. 3 far) seconds of delay-ish; amp 0..1.2. */
  thunder(dist = 1, amp = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + dist * 1.2;
    const len = 3.5 + Math.random() * 2;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 6; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = dist < 1 ? 900 : 350;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * amp, t + 0.05 + dist * 0.15);
    for (let k = 1; k < 5; k++) g.gain.setTargetAtTime(0.9 * amp * (0.35 + Math.random() * 0.5) / k, t + k * 0.45, 0.2);
    g.gain.setTargetAtTime(0, t + 2.2, 0.8);
    src.connect(lp); lp.connect(g); g.connect(this.outGain);
    src.start(t); src.stop(t + len);
  }

  /** Old Lume's dying murmur: breathy low syllables through vowel formants (not real words). */
  murmur(dur = 3) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const V = [[700, 1100], [400, 1700], [300, 2300], [500, 900], [600, 1000]];
    const src = ctx.createOscillator(); src.type = "sawtooth"; src.frequency.value = 96;
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const ng = ctx.createGain(); ng.gain.value = 0.25; noise.connect(ng);
    const g = ctx.createGain(); g.gain.value = 0;
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.Q.value = 8;
    const sum = ctx.createGain(); sum.gain.value = 1.4;
    src.connect(f1); src.connect(f2); ng.connect(f1); ng.connect(f2); f1.connect(sum); f2.connect(sum); sum.connect(g);
    g.connect(this.master);
    let t = t0;
    while (t < t0 + dur) {
      const v = V[Math.floor(Math.random() * V.length)], len = 0.14 + Math.random() * 0.2;
      f1.frequency.setTargetAtTime(v[0], t, 0.03); f2.frequency.setTargetAtTime(v[1], t, 0.03);
      src.frequency.setTargetAtTime(88 + Math.random() * 22 - (t - t0) * 2, t, 0.05);
      g.gain.setTargetAtTime(0.16 + Math.random() * 0.08, t, 0.03);
      g.gain.setTargetAtTime(0.02, t + len * 0.75, 0.04);
      t += len + (Math.random() < 0.2 ? 0.25 : 0.03);
    }
    g.gain.setTargetAtTime(0, t, 0.1);
    src.start(t0); noise.start(t0); src.stop(t + 0.5); noise.stop(t + 0.5);
  }

  splash() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.12));
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.4;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }

  _owl() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [d, f, len] of [[0, 420, 0.32], [0.55, 390, 0.6]]) {
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(f, t + d); o.frequency.linearRampToValueAtTime(f * 0.86, t + d + len);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.05, t + d + 0.06); g.gain.linearRampToValueAtTime(0, t + d + len);
      o.connect(g); g.connect(this.outGain); o.start(t + d); o.stop(t + d + len + 0.05);
    }
  }

  _scheduleDrips() {
    const drip = () => {
      if (!this.ctx) return;
      if (!this.muted && this.started && !this.outdoor) this._playDrip();
      const next = 400 + Math.random() * 1800;
      this._dripTimer = setTimeout(drip, next);
    };
    drip();
  }

  _playDrip() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    const freq = 1400 + Math.random() * 1600;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.12);
    f.frequency.value = freq;
    f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** Cheap footstep: a shared gritty noise buffer through one bandpass; louder/brighter when running. */
  step(amp = 0.5, stance = "stand") {
    if (!this.started || this.muted || !this.ctx) return;
    const ctx = this.ctx;
    if (!this._stepBuf) {
      const n = Math.floor(ctx.sampleRate * 0.12);
      this._stepBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this._stepBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) * (Math.random() < 0.08 ? 2.2 : 1);
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._stepBuf;
    src.playbackRate.value = 0.75 + Math.random() * 0.3 + amp * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = (stance === "crawl" ? 500 : 750) + amp * 900 + Math.random() * 200;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = (stance === "stand" ? 0.1 : 0.06) + amp * 0.16;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.onended = () => { try { g.disconnect(); } catch (_) {} };
  }

  /** Listener position + facing for positional sounds (the monster). */
  setEars(pos, yaw) {
    if (!this.started || !this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.03); L.positionY.setTargetAtTime(pos.y, t, 0.03); L.positionZ.setTargetAtTime(pos.z, t, 0.03);
      L.forwardX.setTargetAtTime(fx, t, 0.03); L.forwardY.setTargetAtTime(0, t, 0.03); L.forwardZ.setTargetAtTime(fz, t, 0.03);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  setListener(camPos, features) {
    if (!this.started || !this.flowGain) return;
    const dist = (f) => {
      if (!f) return 80;
      return Math.hypot(camPos.x - f.x, camPos.y - (f.y || camPos.y), camPos.z - f.z);
    };
    const ds = dist(features && features.stream);
    const df = dist(features && features.waterfall);
    const dp = dist(features && features.pool);
    const flow = Math.max(0, 0.22 * Math.exp(-ds / 14), 0.1 * Math.exp(-dp / 16));
    const fall = Math.max(0, 0.45 * Math.exp(-df / 10));
    const now = this.ctx.currentTime;
    this.flowGain.gain.linearRampToValueAtTime(flow, now + 0.1);
    this.fallGain.gain.linearRampToValueAtTime(fall, now + 0.1);
  }
}
