import { TownMusic } from "./townmusic.js"; // round 24b
import { CinematicScore } from "./music.js";
/**
 * Procedural cave ambience (drips, flow, echo) plus a generated creepy score:
 * detuned low drones, slow dissonant pads, distant bell tones, creaks, whispers
 * and sub thumps. Everything is synthesised with Web Audio; no audio files.
 * The score's density and loudness follow setMood(movement, depth).
 * Starts after a user gesture.
 */

// Round 23: mixer. Percent sliders (master 0-300, the rest 0-200), saved.
const VOL_KEY = "fota-audio-v1";
export const VOL_DEFAULTS = { master: 150, music: 100, effects: 100, voices: 100, ambience: 100 };
// overall gains per bus at 100% (music / effects louder than before round 23)
const BASE = { music: 1.35, effects: 1.4, ambience: 1.15, voices: 1.6 };

export class CaveAudio {
  constructor() {
    this.vol = { ...VOL_DEFAULTS };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem(VOL_KEY) || "{}")); } catch {}
    this.duck = 1;
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
    this.speech = false;
  }

  /** Round 25: while any story voice speaks, effects go silent (and none start), music and ambience
   *  dip to ~18%; everything comes back over ~0.5 s when the line ends, is cancelled or fails. */
  duckMusic(on) { this.music?.duckVoice?.(on); }
  /** Round 25b: hardened. Never ducks unless the AudioContext is actually running, never longer than
   *  maxMs (default 20 s), and `noSpeechDuck` turns it off for good (speech failed on this device). */
  setSpeech(on, maxMs = 20000) {
    on = !!on && !this.noSpeechDuck && this.ctx?.state === "running";
    clearTimeout(this._speechMax);
    if (on) { this._speechAt = performance.now(); this._speechMax = setTimeout(() => this.setSpeech(false), Math.max(1500, Math.min(60000, maxMs))); }
    if (on === this.speech) return;
    this.speech = on; this.applyVol(on ? 0.06 : 0.15);
    if (!on) this.unlock();
  }
  /** Round 25b: iOS can leave the context "suspended" / "interrupted" (e.g. after speech): resume it. */
  unlock() { try { if (this.ctx && this.ctx.state !== "running" && this.ctx.state !== "closed") this.ctx.resume().catch(() => {}); } catch {} }

  /** Round 24b: null | "friendly" | "hostile": crossfade the town theme in / out over the score. */
  setTown(mode) {
    this._townWant = mode; this.town = mode;
    if (!this.townMusic || !this.ctx) return;
    this.townMusic.set(mode);
    this.scoreBus?.gain.setTargetAtTime(mode ? 0.12 : 1, this.ctx.currentTime, mode ? 0.8 : 1.4);
  }
  /** Round 24b: war horn (Call to Arms), weapon strike, spear whoosh, town alarm. */
  fight(kind) {
    if (!this.ctx || this.muted || this.speech) return; // round 25: no new SFX while someone speaks
    const ctx = this.ctx, t = ctx.currentTime;
    const tone = (type, f0, f1, dur, amp, lp, at = 0) => { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = type; o.frequency.setValueAtTime(f0, t + at); o.frequency.linearRampToValueAtTime(f1, t + at + dur * 0.8); f.type = "lowpass"; f.frequency.value = lp; g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(amp, t + at + Math.min(0.12, dur * 0.2)); g.gain.setValueAtTime(amp, t + at + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur); o.connect(f); f.connect(g); g.connect(this.master); o.start(t + at); o.stop(t + at + dur + 0.05); };
    const noise = (dur, f0, amp, type = "bandpass") => { const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = f0; const g = ctx.createGain(); g.gain.value = amp; s.connect(f); f.connect(g); g.connect(this.master); s.start(t); };
    if (kind === "horn") { tone("sawtooth", 98, 110, 1.6, 0.32, 700); tone("sawtooth", 147, 165, 1.3, 0.18, 900, 0.9); tone("sawtooth", 98, 98, 1.8, 0.28, 650, 1.5); }
    else if (kind === "aggro") { tone("sawtooth", 82, 92, 1.0, 0.25, 500); noise(0.6, 600, 0.3); }
    else if (kind === "throw") noise(0.3, 900, 0.25);
    else if (kind === "strike") { noise(0.12, 1400, 0.4); tone("sine", 140, 70, 0.15, 0.3, 800); }
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    try { localStorage.setItem("cavern-music", this.musicOn ? "1" : "0"); } catch {}
    if (this.music) this.music.setOn(this.musicOn);
    this.townMusic?.setOn(this.musicOn);
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
    this.applyVol();
  }

  /** Round 23: set one slider (percent) and save. */
  setVol(k, v) {
    if (!(k in VOL_DEFAULTS)) return;
    this.vol[k] = Math.max(0, Math.min(k === "master" ? 300 : 200, Math.round(+v || 0)));
    try { localStorage.setItem(VOL_KEY, JSON.stringify(this.vol)); } catch {}
    this.applyVol();
  }
  resetVol() { this.vol = { ...VOL_DEFAULTS }; try { localStorage.removeItem(VOL_KEY); } catch {} this.applyVol(); }
  /** Trip ducking etc. (0..1 on everything but the trip music). */
  setDuck(k) { this.duck = k; this.applyVol(); }
  /** speechSynthesis volume (0..1): follows Voices x Master, capped at 1. */
  get speechVol() { return this.muted ? 0 : Math.min(1, (this.vol.voices / 100) * Math.min(1, this.vol.master / 100)); }
  /** Gain multiplier for player voice chat (Voices slider). */
  get voiceGain() { return (this.vol.voices / 100) * BASE.voices; }
  applyVol(tau = 0.03) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, set = (n, v, k = 0.03) => { if (n) n.gain.setTargetAtTime(v, t, k); }; // round 25b: plain targets (no cancel / value snapshots: Safari reads stale values)
    const sp = this.speech ? 0.18 : 1; // round 25: speech ducking
    set(this.out, this.muted ? 0 : this.vol.master / 100);
    set(this.master, (this.vol.effects / 100) * BASE.effects * this.duck * (this.speech ? 0 : 1), tau);
    set(this.musicBus, (this.vol.music / 100) * BASE.music * this.duck * sp, tau);
    set(this.tripBus, (this.vol.music / 100) * BASE.music * sp, tau);
    set(this.ambBus, (this.vol.ambience / 100) * BASE.ambience * this.duck * sp, tau);
    set(this.voiceBus, this.voiceGain);
  }

  toggle() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  async resume() {
    if (this.started) {
      if (this.ctx && this.ctx.state !== "running" && this.ctx.state !== "closed") await this.ctx.resume().catch(() => {}); // round 25b: iOS "interrupted" too
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // Round 23 master bus: pre-mix (cave low-pass + echo) -> master gain (0-300%) -> compressor ->
    // make-up gain -> brick-wall limiter -> speakers. Loud without clipping.
    const ctx = this.ctx;
    this.pre = ctx.createGain(); this.pre.gain.value = 0.7;
    this.out = ctx.createGain();
    const comp = (this.comp = ctx.createDynamicsCompressor());
    comp.threshold.value = -22; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
    const makeup = ctx.createGain(); makeup.gain.value = 2.2;
    const lim = (this.limiter = ctx.createDynamicsCompressor());
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.out.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(ctx.destination);
    // buses
    this.master = ctx.createGain(); this.master.connect(this.pre); // sound effects (kept as "master" for old callers)
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.pre);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.pre);
    this.tripBus = ctx.createGain(); this.tripBus.connect(this.out);
    this.voiceBus = ctx.createGain(); this.voiceBus.connect(this.out);
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
    this.pre.connect(filt);
    filt.connect(this.out);
    filt.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.out);
    this.echoWet = wet;
    this.echoFb = fb;
    // Outdoor night ambience bus (wind gusts, crickets, an owl); silent underground.
    this.outGain = this.ctx.createGain();
    this.outGain.gain.value = this.outdoor ? 1 : 0;
    this.outGain.connect(this.ambBus);
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
    this.flowGain.connect(this.ambBus);
    this._noiseDrone(this.flowGain, 400, 0.35);

    this.fallGain = this.ctx.createGain();
    this.fallGain.gain.value = 0.0;
    this.fallGain.connect(this.ambBus);
    this._noiseDrone(this.fallGain, 1200, 0.7);

    this.started = true;
    this.applyVol();
    this._scheduleDrips();
    if (this.outdoor) this.setOutdoor(true);
    // round 24b: the open-world score plays through its own sub-bus so town themes can duck it
    this.scoreBus = this.ctx.createGain(); this.scoreBus.connect(this.musicBus);
    try { this.music = new CinematicScore(this.ctx, this.scoreBus, this.musicOn); } catch (err) { console.warn("music failed", err); }
    try { this.townMusic = new TownMusic(this.ctx, this.musicBus); this.townMusic.setOn(this.musicOn); if (this._townWant) this.setTown(this._townWant); } catch (err) { console.warn("town music failed", err); }
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
    if (!this.ctx || this.muted || this.speech) return; // round 25: no new SFX while someone speaks
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
    g.connect(this.ambBus); // round 23: ambience slider
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
    return () => { try { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0, n, 0.05); src.stop(n + 0.3); noise.stop(n + 0.3); } catch {} };
  }

  splash() {
    if (!this.ctx || this.muted || this.speech) return; // round 25: no new SFX while someone speaks
    const ctx = this.ctx, t = ctx.currentTime;
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.12));
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.4;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }

  /** Round 19: a paddle stroke: a soft watery swish (stronger at speed). */
  paddle(amp = 0.5) {
    if (!this.ctx || this.muted || !this.started || this.speech) return; // round 25: no new SFX while someone speaks
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this._padBuf) {
      const n = Math.floor(ctx.sampleRate * 0.35); this._padBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this._padBuf.getChannelData(0);
      for (let i = 0; i < n; i++) { const u = i / n; d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, u * 4)) * Math.exp(-u * 4); }
    }
    const s = ctx.createBufferSource(); s.buffer = this._padBuf; s.playbackRate.value = 0.8 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 700 + amp * 600 + Math.random() * 200; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0.08 + amp * 0.12;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
    s.onended = () => { try { g.disconnect(); } catch (_) {} };
  }

  /** Bow release: a short plucked twang plus a breathy whoosh. */
  bowShot() {
    if (!this.ctx || this.muted || this.speech) return; // round 25: no new SFX while someone speaks
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.25);
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.07));
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 0.8;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    s.connect(f); f.connect(g2); g2.connect(this.master); s.start(t);
  }

  /** Arrow impact: a meaty thud on a creature, a dry crack on rock / ground. */
  arrowHit(flesh = false) {
    if (!this.ctx || this.muted || this.speech) return; // round 25: no new SFX while someone speaks
    const ctx = this.ctx, t = ctx.currentTime;
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * (flesh ? 0.05 : 0.018)));
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = flesh ? "lowpass" : "bandpass"; f.frequency.value = flesh ? 500 : 1800; f.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = flesh ? 0.7 : 0.35;
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
    g.connect(this.ambBus); // round 23: ambience slider
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** Cheap footstep: a shared gritty noise buffer through one bandpass; louder/brighter when running. */
  step(amp = 0.5, stance = "stand") {
    if (!this.started || this.muted || !this.ctx || this.speech) return; // round 25: no new SFX while someone speaks
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

  /** Round 12: hoofbeat on turf (low thump + a short dull click); a gallop fires these in pairs. */
  hoof(amp = 0.6) {
    if (!this.started || this.muted || !this.ctx || this.speech) return; // round 25: no new SFX while someone speaks
    const ctx = this.ctx, t0 = ctx.currentTime;
    if (!this._stepBuf) this.step(0, "stand");
    const beats = amp > 0.6 ? [0, 0.07] : [0];
    for (const off of beats) {
      const t = t0 + off + Math.random() * 0.012;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(95 + Math.random() * 20, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 + amp * 0.22, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.18);
      o.onended = () => { try { g.disconnect(); } catch (_) {} };
      if (this._stepBuf) {
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g2 = ctx.createGain();
        src.buffer = this._stepBuf; src.playbackRate.value = 0.5 + Math.random() * 0.15;
        f.type = "lowpass"; f.frequency.value = 520 + amp * 300;
        g2.gain.value = 0.12 + amp * 0.18;
        src.connect(f); f.connect(g2); g2.connect(this.master); src.start(t);
        src.onended = () => { try { g2.disconnect(); } catch (_) {} };
      }
    }
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
