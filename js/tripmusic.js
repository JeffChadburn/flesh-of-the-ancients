/**
 * Round 21: trip music, all Web Audio. Drone pad (detuned saws through a breathing low-pass),
 * an arpeggiated synth into a long echo, a gliding, pitch-bending sine melody with vibrato, and at
 * the peak a pulsing kick + hats. Volume follows the trip level; everything stops when it ends.
 */
const CHORDS = [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [43, 50, 55, 58, 62], [45, 52, 57, 61, 64]]; // Dm9, Bbmaj7, Gm, A
const SCALE = [62, 64, 65, 67, 69, 72, 74, 76, 77, 79, 81];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class TripMusic {
  constructor(audio) { this.audio = audio; this.on = false; }
  start() {
    const A = this.audio; if (!A.ctx || this.on) return false;
    const ctx = (this.ctx = A.ctx), t = ctx.currentTime;
    this.on = true; this.nodes = []; this.bpm = 112; this.step = 0; this.next = t + 0.1; this.chord = 0; this.level = 0; this.peak = 0;
    const out = (this.out = ctx.createGain()); out.gain.value = 0; out.connect(ctx.destination);
    // echo bus
    const dl = ctx.createDelay(2), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
    dl.delayTime.value = (60 / this.bpm) * 0.75; fb.gain.value = 0.48; lp.type = "lowpass"; lp.frequency.value = 2600; wet.gain.value = 0.55;
    dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(out);
    this.echo = dl;
    // pad: 3 voices x 2 detuned saws through a slow-moving low-pass
    const padF = (this.padF = ctx.createBiquadFilter()); padF.type = "lowpass"; padF.frequency.value = 700; padF.Q.value = 6;
    const padG = ctx.createGain(); padG.gain.value = 0.09; padF.connect(padG); padG.connect(out); padG.connect(dl);
    this.pad = [];
    for (let i = 0; i < 3; i++) for (const det of [-9, 9]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.detune.value = det; o.frequency.value = hz(CHORDS[0][i + 1] - 12); o.connect(padF); o.start(t); this.pad.push(o); this.nodes.push(o); }
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.09; lfoG.gain.value = 450; lfo.connect(lfoG); lfoG.connect(padF.frequency); lfo.start(t); this.nodes.push(lfo);
    // drone
    const dr = ctx.createOscillator(), drG = ctx.createGain(); dr.type = "sine"; dr.frequency.value = hz(38); drG.gain.value = 0.16; dr.connect(drG); drG.connect(out); dr.start(t); this.nodes.push(dr);
    // melody: one gliding sine with vibrato
    const mel = (this.mel = ctx.createOscillator()), melG = (this.melG = ctx.createGain()), vib = ctx.createOscillator(), vibG = ctx.createGain();
    mel.type = "sine"; mel.frequency.value = hz(69); melG.gain.value = 0; vib.frequency.value = 5.2; vibG.gain.value = 9;
    vib.connect(vibG); vibG.connect(mel.frequency); mel.connect(melG); melG.connect(out); melG.connect(dl);
    mel.start(t); vib.start(t); this.nodes.push(mel, vib);
    // noise for hats
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = nb;
    this.timer = setInterval(() => this._schedule(), 50);
    return true;
  }
  _schedule() {
    if (!this.on) return;
    const ctx = this.ctx, spb = 60 / this.bpm / 2; // 8th notes
    while (this.next < ctx.currentTime + 0.25) {
      const t = this.next, s = this.step++;
      if (s % 32 === 0) { this.chord = (this.chord + 1) % CHORDS.length; const C = CHORDS[this.chord]; this.pad.forEach((o, i) => o.frequency.setTargetAtTime(hz(C[1 + (i >> 1)] - 12), t, 0.6)); }
      const C = CHORDS[this.chord];
      // arpeggio (16 steps up / down over two octaves)
      if (this.level > 0.15) {
        const seq = [0, 1, 2, 3, 4, 3, 2, 1], n = C[seq[s % 8]] + (s % 16 >= 8 ? 12 : 0);
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = s % 2 ? "square" : "triangle"; o.frequency.value = hz(n);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * Math.min(1, this.level * 1.4), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + spb * 1.6);
        o.connect(g); g.connect(this.out); g.connect(this.echo); o.start(t); o.stop(t + spb * 1.7);
      }
      // melody: a new note every 2-3 beats, gliding there, with an occasional big bend
      if (s % 6 === 0 && this.level > 0.3) {
        const n = SCALE[Math.floor(Math.random() * SCALE.length)], f = hz(n);
        this.mel.frequency.setTargetAtTime(f, t, Math.random() < 0.3 ? 0.4 : 0.08);
        if (Math.random() < 0.25) this.mel.frequency.setTargetAtTime(f * (Math.random() < 0.5 ? 0.75 : 1.5), t + spb * 3, 0.3);
      }
      // beat at the peak
      if (this.peak > 0.5) {
        if (s % 2 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); g.gain.setValueAtTime(0.42 * this.peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.32); }
        else { const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = this.noise; f.type = "highpass"; f.frequency.value = 7000; g.gain.setValueAtTime(0.07 * this.peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06); src.connect(f); f.connect(g); g.connect(this.out); src.start(t); src.stop(t + 0.08); }
      }
      this.next += spb;
    }
  }
  /** level 0..1, peak 0..1 (beat), muted */
  update(level, peak, muted) {
    if (!this.on) return;
    this.level = level; this.peak = peak;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(muted ? 0 : 0.55 * level, t, 0.3);
    this.melG.gain.setTargetAtTime(0.06 * Math.max(0, level - 0.25), t, 0.5);
  }
  stop() {
    if (!this.on) return; this.on = false; clearInterval(this.timer);
    const t = this.ctx.currentTime; this.out.gain.setTargetAtTime(0, t, 0.3);
    setTimeout(() => { for (const n of this.nodes) { try { n.stop(); } catch {} } try { this.out.disconnect(); } catch {} }, 1500);
  }
}
