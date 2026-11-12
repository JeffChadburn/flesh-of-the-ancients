/**
 * Round 24: a small Web Audio score for the cutscenes. A low drone, a slow pad that moves through a
 * few chords, a skin drum on the beat changes, and a breathy bone-flute line. mood: dread | calm |
 * wonder | triumph. Goes out through the mixer's Music bus; fades in and out.
 */
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MOODS = {
  dread: { root: 38, chords: [[0, 3, 7], [1, 5, 8], [0, 3, 6], [-2, 1, 5]], bpm: 56, flute: [12, 15, 13, 12, 10], drum: 0.9, bright: 600 },
  calm: { root: 45, chords: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [-5, -1, 2]], bpm: 64, flute: [12, 14, 16, 19, 16], drum: 0.4, bright: 1100 },
  wonder: { root: 43, chords: [[0, 7, 14], [2, 9, 14], [-3, 4, 11], [5, 12, 16]], bpm: 60, flute: [19, 17, 14, 12, 14], drum: 0.3, bright: 1500 },
  triumph: { root: 41, chords: [[0, 4, 7], [-5, -1, 2], [-3, 0, 4], [-7, -3, 0]], bpm: 76, flute: [12, 16, 19, 24, 19], drum: 1.0, bright: 1800 },
};
export class CineScore {
  constructor(audio) { this.audio = audio; this.on = false; }
  start(mood = "dread") {
    const A = this.audio, ctx = A.ctx; if (!ctx) return false;
    this.stop(0.3);
    const M = MOODS[mood] || MOODS.dread, t = ctx.currentTime;
    this.ctx = ctx; this.M = M; this.on = true; this.nodes = [];
    const out = (this.out = ctx.createGain()); out.gain.value = 0; out.gain.linearRampToValueAtTime(0.55, t + 2.5); out.connect(A.musicBus || A.master || ctx.destination);
    const dl = ctx.createDelay(1.5), fb = ctx.createGain(), wet = ctx.createGain(); dl.delayTime.value = 0.42; fb.gain.value = 0.35; wet.gain.value = 0.35; dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(out);
    this.echo = dl;
    // drone
    for (const [m, g0, ty] of [[M.root - 12, 0.22, "sine"], [M.root, 0.08, "sawtooth"], [M.root + 7, 0.05, "sawtooth"]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = ty; o.frequency.value = hz(m); o.detune.value = (Math.random() - 0.5) * 10;
      f.type = "lowpass"; f.frequency.value = 300; g.gain.value = g0; o.connect(f); f.connect(g); g.connect(out); o.start(t); this.nodes.push(o);
    }
    // pad voices (retuned on each chord)
    this.padF = ctx.createBiquadFilter(); this.padF.type = "lowpass"; this.padF.frequency.value = M.bright; this.padF.Q.value = 2;
    const pg = ctx.createGain(); pg.gain.value = 0.07; this.padF.connect(pg); pg.connect(out); pg.connect(dl);
    this.pad = [];
    for (let i = 0; i < 6; i++) { const o = ctx.createOscillator(); o.type = i % 2 ? "triangle" : "sawtooth"; o.detune.value = i % 2 ? 7 : -7; o.connect(this.padF); o.start(t); this.pad.push(o); this.nodes.push(o); }
    this.step = 0; this.next = t + 0.2; this.chord = 0;
    this._iv = setInterval(() => this._tick(), 120);
    this._tick();
    return true;
  }
  _tick() {
    if (!this.on) return;
    const ctx = this.ctx, M = this.M, beat = 60 / M.bpm;
    while (this.next < ctx.currentTime + 0.4) {
      const t = this.next;
      if (this.step % 8 === 0) { // new chord
        const c = M.chords[this.chord++ % M.chords.length];
        this.pad.forEach((o, i) => o.frequency.setTargetAtTime(hz(M.root + 12 + c[i % 3] + (i >= 3 ? 12 : 0)), t, 0.6));
        this._drum(t, 1); 
      } else if (this.step % 4 === 0) this._drum(t, 0.55);
      if (this.step % 2 === 0 && Math.random() < 0.55) this._flute(t, M.root + 12 + M.flute[(this.step / 2) % M.flute.length], beat * 1.8);
      this.step++; this.next += beat;
    }
  }
  _drum(t, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine";
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * v * this.M.drum + 0.0001, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.7);
  }
  _flute(t, m, len) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), v = ctx.createOscillator(), vg = ctx.createGain();
    o.type = "sine"; o.frequency.value = hz(m); v.frequency.value = 5.2; vg.gain.value = 4; v.connect(vg); vg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(this.out); g.connect(this.echo); o.start(t); v.start(t); o.stop(t + len + 0.1); v.stop(t + len + 0.1);
  }
  /** Swell the drums / brightness for a big moment. */
  accent() { if (!this.on) return; this._drum(this.ctx.currentTime + 0.02, 1.4); this.padF?.frequency.setTargetAtTime(this.M.bright * 1.8, this.ctx.currentTime, 0.4); this.padF?.frequency.setTargetAtTime(this.M.bright, this.ctx.currentTime + 2, 1); }
  stop(fade = 1.5) {
    if (!this.on) return; this.on = false; clearInterval(this._iv);
    const ctx = this.ctx, t = ctx.currentTime, out = this.out, nodes = this.nodes;
    out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { for (const o of nodes) try { o.stop(); } catch {} try { out.disconnect(); } catch {} }, fade * 1000 + 200);
  }
}
