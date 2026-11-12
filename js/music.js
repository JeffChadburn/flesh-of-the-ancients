/**
 * Procedural cinematic cave score (Web Audio only, original material, no samples or files).
 * Big-film-trailer style: low brass "braams", sustained low string pads moving slowly through a
 * minor progression (i - VI - III - VII in D minor, darkening to i - bII - VII - i), a ticking
 * clock motif, string-like spiccato ostinato that speeds up with tension, taiko-style low drums,
 * Shepard-tone risers, sub drops and organ swells in the big rooms.
 *
 * Zones (crossfaded): entrance (airy high strings + wind), corridor (low strings, clock, ostinato),
 * squeeze (muffled, semitone cluster, heartbeat), hall (organ swells, full pads, distant braams).
 * Tension 0..1: calm awe -> creepy (clock) -> tense (spiccato 8ths/16ths, drums) -> blood-pumping
 * (16ths, double drums, risers, braams every couple of bars). Tempo 60 -> 140 bpm.
 *
 * CPU: ~20 persistent oscillators reused across chord changes (glides), one shared convolver,
 * one shared braam distortion chain, short-lived voices only for notes / hits (capped).
 */

const ZONES = ["entrance", "corridor", "squeeze", "hall", "outdoor", "camp", "dawn"];
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Chords: bass root + four pad tones (voice-led, common tones kept).
const CH = {
  i:   { name: "Dm", root: 38, tones: [50, 53, 57, 62] },
  VI:  { name: "Bb", root: 34, tones: [50, 53, 58, 62] },
  III: { name: "F",  root: 41, tones: [48, 53, 57, 60] },
  VII: { name: "C",  root: 36, tones: [48, 52, 55, 60] },
  bII: { name: "Eb", root: 39, tones: [51, 55, 58, 63] },
  iv:  { name: "Gm", root: 43, tones: [50, 55, 58, 62] },
};
const PROG_AWE = ["i", "VI", "III", "VII"];
const PROG_DREAD = ["i", "bII", "VII", "i", "VI", "bII", "iv", "VII"];
const OSTINATO = [0, 2, 1, 2, 0, 3, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2];

export class CinematicScore {
  constructor(ctx, dest, on = true) {
    this.ctx = ctx;
    this.on = on;
    this.tension = 0.1;
    this.zone = "corridor";
    this.moveSustain = 0;
    this.boost = 0;
    this.nearCount = 0;
    this.braamCount = 0;
    this.riserCount = 0;
    this.nextNear = ctx.currentTime + 60 + Math.random() * 60;
    this.lastRiser = -100;
    this.lastBraam = -100;
    this.duckUntil = 0;
    this.step = 0; // 16th-note counter
    this.nextStepTime = ctx.currentTime + 0.3;
    this.chordIdx = 0;
    this.chordKey = "i";
    this.dread = false;
    this.barsLeft = 4;
    this.liveVoices = 0;
    this.scene = { move: 0, depth: 0, running: false, tight: false, dark: 1, runFrac: 0 };

    // --- Graph: layers -> mix -> duck -> tone (muffle) -> comp -> level -> out; reverb send.
    this.out = ctx.createGain();
    this.out.gain.value = on ? 1 : 0;
    this.out.connect(dest);
    this.level = ctx.createGain();
    this.level.gain.value = 0.55;
    this.level.connect(this.out);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.4;
    this.comp.connect(this.level);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 9000;
    this.tone.connect(this.comp);
    this.duck = ctx.createGain();
    this.duck.connect(this.tone);
    this.mix = ctx.createGain();
    this.mix.connect(this.duck);
    // One shared convolver for everything. Its return bypasses the duck so tails (and the braam)
    // ring on naturally through the scripted silence.
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(6);
    this.verb.connect(this.tone);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.9;
    this.verbSend.connect(this.verb);
    this.duck.connect(this.verbSend);
    // Rhythm bus (drier, punchier) and a post-duck FX bus (braams that must ring through silence).
    this.beatBus = ctx.createGain();
    this.beatBus.gain.value = 0.9;
    this.beatBus.connect(this.duck);
    this.fx = ctx.createGain();
    this.fx.connect(this.tone);
    this.fxSend = ctx.createGain();
    this.fxSend.gain.value = 0.9;
    this.fx.connect(this.fxSend);
    this.fxSend.connect(this.verb);

    this.noise = this._noiseBuf(2);
    this._buildBraamChain();

    this.zoneGain = {};
    for (const z of ZONES) {
      const g = ctx.createGain();
      g.gain.value = z === this.zone ? 1 : 0;
      g.connect(this.mix);
      this.zoneGain[z] = g;
    }
    this._buildStrings();
    this._buildBass();
    this._buildWind();
    this._buildOutdoor();
    this._buildCamp();
    this._buildCluster();
    this._buildOrgan();
    this._applyChord(ctx.currentTime, 0.1);
    this._timer = setInterval(() => this._tick(), 50);
  }

  get bpm() { return Math.round(60 + this.tension * 80); }
  get chord() { return CH[this.chordKey].name; }

  setOn(on) {
    this.on = on;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(on ? (this.ducked ? 0.22 : 1) : 0, t, 0.35);
  }
  /** Round 13: dip the score while a character speaks. */
  duckVoice(on) { // (was duck(): shadowed by the this.duck gain node, so it threw)
    this.ducked = !!on;
    if (this.on) { const t = this.ctx.currentTime; this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(on ? 0.22 : 1, t, on ? 0.15 : 0.6); }
  }

  // ---------- helpers ----------
  _noiseBuf(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - i / len, 2.2) * (i < 1200 ? i / 1200 : 1);
      }
    }
    return b;
  }
  _osc(type, f, det = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = det;
    o.start();
    return o;
  }
  _env(param, t, peak, a, d) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _voice(dur) {
    // Cap short-lived voices so busy passages stay cheap on phones.
    if (this.liveVoices > 28) return false;
    this.liveVoices++;
    setTimeout(() => { this.liveVoices--; }, (dur + 0.2) * 1000);
    return true;
  }

  // ---------- persistent layers (oscillators reused; chords glide) ----------
  _buildStrings() {
    // Low string pad: 4 voices x 2 detuned saws, one shared lowpass ("bowed" swell via LFO on gain).
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 0.7;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.mix);
    this.padVoices = [];
    for (let i = 0; i < 4; i++) {
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const a = this._osc("sawtooth", 110, -7);
      const b = this._osc("sawtooth", 110, 7);
      a.connect(g); b.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = [-0.6, 0.6, -0.25, 0.3][i];
        g.connect(p); p.connect(this.padFilter);
      } else g.connect(this.padFilter);
      this.padVoices.push({ a, b, g });
    }
    // Slow bow swell.
    const lfo = this._osc("sine", 0.07);
    const lg = ctx.createGain();
    lg.gain.value = 140;
    lfo.connect(lg); lg.connect(this.padFilter.frequency);
  }
  _buildBass() {
    const ctx = this.ctx;
    this.bassGain = ctx.createGain();
    this.bassGain.gain.value = 0.0;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 220;
    this.bassA = this._osc("sawtooth", 73.4);
    this.bassSub = this._osc("sine", 36.7);
    const sg = ctx.createGain();
    sg.gain.value = 1.4;
    this.bassA.connect(f); this.bassSub.connect(sg); sg.connect(this.bassGain);
    f.connect(this.bassGain);
    this.bassGain.connect(this.mix);
  }
  _buildOutdoor() {
    // Outdoors at night: a hollow low fifth drone that swells and fades, plus a thin high
    // "glass" tone a tritone up. Sparse on purpose; the hits come from the beat engine.
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
    for (const [fr, det] of [[55, -4], [82.4, 5], [110, 0]]) { const o = this._osc("sawtooth", fr, det); o.connect(f); }
    const swell = this._osc("sine", 0.031);
    const sg = ctx.createGain(); sg.gain.value = 0.035;
    swell.connect(sg); sg.connect(g.gain);
    f.connect(g); g.connect(this.zoneGain.outdoor);
    const hg = ctx.createGain(); hg.gain.value = 0.008;
    const hi = this._osc("sine", 1244.5, 3); hi.connect(hg);
    const trem = this._osc("sine", 0.07); const tg = ctx.createGain(); tg.gain.value = 0.007; trem.connect(tg); tg.connect(hg.gain);
    hg.connect(this.zoneGain.outdoor);
  }
  _buildCamp() {
    // Camp / dawn: a soft open drone (D + A, sines) under the sparse lament melody from _step.
    const ctx = this.ctx;
    for (const z of ["camp", "dawn"]) {
      const g = ctx.createGain(); g.gain.value = z === "camp" ? 0.035 : 0.03;
      for (const [fr, det] of z === "camp" ? [[73.4, -3], [110, 2], [146.8, 0]] : [[110, -2], [164.8, 3], [220, 0]]) { const o = this._osc("sine", fr, det); o.connect(g); }
      const sw = this._osc("sine", 0.04); const sg = ctx.createGain(); sg.gain.value = 0.015; sw.connect(sg); sg.connect(g.gain);
      g.connect(this.zoneGain[z]);
    }
  }
  /** A slow, breathy flute-like note for the camp lament / dawn theme. */
  _lament(t, freq, dur, amp) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2.001;
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6; const vg = ctx.createGain(); vg.gain.value = freq * 0.008; vib.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.zoneGain[this.zone] || this.mix);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + Math.min(0.6, dur * 0.35)); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.25);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(t + dur * 1.6 + 0.2); }
    this.lamentCount = (this.lamentCount || 0) + 1;
  }
  _buildWind() {
    // Entrance: airy wind + high string harmonics.
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.start();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 0.8;
    const lfo = this._osc("sine", 0.05);
    const lg = ctx.createGain(); lg.gain.value = 400;
    lfo.connect(lg); lg.connect(bp.frequency);
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(bp); bp.connect(g); g.connect(this.zoneGain.entrance);
    this.highVoices = [];
    const hg = ctx.createGain(); hg.gain.value = 0.018;
    for (let i = 0; i < 2; i++) {
      const o = this._osc("triangle", 880, i ? 5 : -5);
      o.connect(hg);
      this.highVoices.push(o);
    }
    const trem = this._osc("sine", 0.23);
    const tg = ctx.createGain(); tg.gain.value = 0.01;
    trem.connect(tg); tg.connect(hg.gain);
    hg.connect(this.zoneGain.entrance);
  }
  _buildCluster() {
    // Squeeze: semitone cluster beating above the pad + slow heartbeat comes from the beat engine.
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.03;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400;
    this.clusterA = this._osc("sawtooth", mtof(62));
    this.clusterB = this._osc("sawtooth", mtof(63));
    this.clusterA.connect(f); this.clusterB.connect(f); f.connect(g); g.connect(this.zoneGain.squeeze);
  }
  _buildOrgan() {
    // Big Room: organ-like swells (8' sine + 4' triangle per chord tone), slow breathing volume.
    const ctx = this.ctx;
    this.organGain = ctx.createGain();
    this.organGain.gain.value = 0.0;
    this.organVoices = [];
    for (let i = 0; i < 4; i++) {
      const a = this._osc("sine", 220);
      const b = this._osc("triangle", 440);
      const bg = ctx.createGain(); bg.gain.value = 0.35;
      a.connect(this.organGain); b.connect(bg); bg.connect(this.organGain);
      this.organVoices.push({ a, b });
    }
    const swell = ctx.createGain(); swell.gain.value = 0.05;
    const lfo = this._osc("sine", 0.045);
    const lg = ctx.createGain(); lg.gain.value = 0.035;
    lfo.connect(lg); lg.connect(swell.gain);
    this.organGain.connect(swell);
    swell.connect(this.zoneGain.hall);
  }
  _buildBraamChain() {
    const ctx = this.ctx;
    this.braamIn = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(3.2 * x) / Math.tanh(3.2); }
    shaper.curve = curve;
    shaper.oversample = "none";
    this.braamFilter = ctx.createBiquadFilter();
    this.braamFilter.type = "lowpass";
    this.braamFilter.frequency.value = 200;
    this.braamFilter.Q.value = 2.2;
    this.braamOut = ctx.createGain();
    this.braamOut.gain.value = 0.0001;
    this.braamIn.connect(shaper); shaper.connect(this.braamFilter); this.braamFilter.connect(this.braamOut);
    this.braamOut.connect(this.fx);
  }

  _applyChord(t, glide = 1.2) {
    const c = CH[this.chordKey];
    c.tones.forEach((m, i) => {
      const f = mtof(m - 12); // low strings (octave 2-3)
      const v = this.padVoices[i];
      v.a.frequency.setTargetAtTime(f, t, glide * 0.3);
      v.b.frequency.setTargetAtTime(f, t, glide * 0.3);
      const o = this.organVoices[i];
      o.a.frequency.setTargetAtTime(mtof(m), t, glide * 0.2);
      o.b.frequency.setTargetAtTime(mtof(m + 12), t, glide * 0.2);
    });
    this.bassA.frequency.setTargetAtTime(mtof(c.root), t, 0.15);
    this.bassSub.frequency.setTargetAtTime(mtof(c.root - 12), t, 0.15);
    this.highVoices[0].frequency.setTargetAtTime(mtof(c.tones[2] + 24), t, 0.8);
    this.highVoices[1].frequency.setTargetAtTime(mtof(c.tones[3] + 24), t, 0.8);
    this.clusterA.frequency.setTargetAtTime(mtof(c.tones[0] + 12), t, 0.5);
    this.clusterB.frequency.setTargetAtTime(mtof(c.tones[0] + 13), t, 0.5);
  }

  // ---------- per-frame scene input ----------
  update(sc) {
    this.scene = { ...this.scene, ...sc };
    const now = this.ctx.currentTime;
    const dt = this._lastUpd ? Math.min(0.5, Math.max(0, now - this._lastUpd)) : (sc.dt || 0.016);
    this._lastUpd = now;
    const moving = sc.move > 0.12;
    const runF = sc.runFrac != null ? sc.runFrac : (sc.running ? 1 : 0);
    this.moveSustain = moving ? Math.min(1, this.moveSustain + dt / 25) : Math.max(0, this.moveSustain - dt / 4);
    this.boost = Math.max(0, this.boost - dt / 14);
    // Walking tops out around "tense"; running is what pushes into blood-pumping.
    let target = 0.06 + sc.depth * 0.2 + this.moveSustain * 0.24 + runF * 0.34 + (sc.tight ? 0.18 : 0) + sc.dark * 0.06 + this.boost;
    if (!moving) target = Math.min(target, 0.1 + sc.depth * 0.12 + (sc.tight ? 0.1 : 0) + this.boost);
    // A real monster: hunting raises the floor, a chase forces max intensity.
    const threat = sc.threat || 0;
    target = Math.min(1, Math.max(target, threat));
    const up = threat > 0.8 ? 1.2 : runF > 0.3 ? 3.5 : 7;
    const rate = target > this.tension ? dt / up : dt / 5;
    this.tension += (target - this.tension) * Math.min(1, rate * 3);
    if (sc.zone && sc.zone !== this.zone) this._setZone(sc.zone);
    if (!sc.monster && this.zone !== "outdoor" && this.zone !== "camp" && this.zone !== "dawn" && moving && sc.depth > 0.12 && now > this.nextNear && now > this.duckUntil) this._somethingNear();
    if (this.tension > 0.62 && (this._prevT || 0) <= 0.62 && now - this.lastRiser > 25) {
      this._shepardRiser(now + 0.05, 5.5, true);
    }
    this._prevT = this.tension;
  }

  _setZone(z) {
    if (!this.zoneGain[z]) return;
    const t = this.ctx.currentTime;
    for (const k of ZONES) {
      const g = this.zoneGain[k].gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(k === z ? 1 : 0, t, 1.0);
    }
    this.zone = z;
  }

  // ---------- scheduler ----------
  _tick() {
    const ctx = this.ctx;
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    const T = this.tension;
    const z = this.zone;

    // Continuous layer targets.
    const out = z === "outdoor" || z === "camp" || z === "dawn";
    const muffle = z === "squeeze" ? 900 + T * 900 : z === "entrance" ? 7000 : out ? 5200 : 9000;
    this.tone.frequency.setTargetAtTime(muffle, now, 0.6);
    const padLv = (z === "entrance" ? 0.35 : z === "squeeze" ? 0.7 : out ? 0.22 : 1) * (0.35 + T * 0.65);
    this.padGain.gain.setTargetAtTime(padLv * 0.55, now, 0.8);
    this.padFilter.frequency.setTargetAtTime(260 + T * 1500 + (z === "hall" ? 300 : 0), now, 0.8);
    this.bassGain.gain.setTargetAtTime((z === "entrance" || out ? 0.04 : 0.12) + T * 0.16, now, 0.8);
    this.organGain.gain.setTargetAtTime(z === "hall" ? 0.9 - T * 0.4 : 0, now, 1.2);
    this.verbSend.gain.setTargetAtTime(z === "hall" ? 1.5 : z === "squeeze" ? 0.4 : out ? 1.3 : 0.9, now, 1);

    if (now < this.duckUntil) { this.nextStepTime = Math.max(this.nextStepTime, this.duckUntil); return; }
    const spb = 60 / this.bpm;
    const s16 = spb / 4;
    while (this.nextStepTime < now + 0.15) {
      this._step(this.nextStepTime, this.step, s16, T);
      this.nextStepTime += s16;
      this.step++;
    }
  }

  _step(t, n, s16, T) {
    const inBeat = n % 4, beat = Math.floor(n / 4) % 4, bar = n % 16 === 0;
    const z = this.zone;
    // Chord changes at bar lines.
    if (bar) {
      this.barsLeft--;
      if (this.barsLeft <= 0) {
        this.dread = T > 0.62 || (z === "hall" && T > 0.45) || z === "squeeze";
        const prog = this.dread ? PROG_DREAD : PROG_AWE;
        this.chordIdx = (this.chordIdx + 1) % prog.length;
        this.chordKey = prog[this.chordIdx];
        this.barsLeft = T < 0.3 ? 2 : T < 0.6 ? 2 : 1;
        this._applyChord(t, T > 0.6 ? 0.5 : 1.5);
        // Braam on chord change once things get tense.
        const cd = T > 0.8 ? 6 : 12;
        if (T > 0.5 && t - this.lastBraam > cd) this.braam(t, CH[this.chordKey].root, 0.6 + T * 0.4);
        else if (z === "hall" && T > 0.25 && t - this.lastBraam > 22) this.braam(t, CH[this.chordKey].root, 0.32, true);
        if (T > 0.55 && this.chordIdx % 4 === 0) this._subDrop(t, 0.6);
      }
      if (T > 0.82 && t - this.lastRiser > 14 && Math.random() < 0.5) this._shepardRiser(t, 6.5, true);
    }
    // Camp: a sad, sparse lament (D minor, falling). Dawn: the same voice, rising (D dorian).
    if ((z === "camp" || z === "dawn") && T < 0.55) {
      if (n % 8 === 0) {
        const seq = z === "camp" ? [74, 72, 70, 69, null, 67, 69, 62, null, null, 65, 64, 62, null, null, null] : [62, 69, 71, 72, 71, 69, 74, null, 72, 69, null, 67, 69, null, null, null];
        const k = Math.floor(n / 8) % seq.length, m = seq[k];
        if (m != null) this._lament(t, mtof(m), s16 * 8 * 1.3, z === "camp" ? 0.05 : 0.04);
      }
      return;
    }
    // Outdoors: sparse. A distant braam every so often, no clock / ostinato until things get tense.
    if (z === "outdoor" && T < 0.5) {
      if (bar && Math.random() < 0.12 && t - this.lastBraam > 28) this.braam(t, CH[this.chordKey].root - 12, 0.28, true);
      return;
    }
    // Clock: tick-tock on each beat from "creepy" up; louder when tense.
    if (inBeat === 0 && T > 0.16) this._tick2(t, beat % 2 === 0, 0.04 + T * 0.08);
    // Heartbeat in squeezes (or when very tense).
    if (inBeat === 0 && beat % 2 === 0 && (z === "squeeze" || T > 0.7)) this._heart(t, 0.5 + T * 0.4, s16 * 4);
    // Spiccato ostinato: 8ths from 0.3, 16ths from 0.55.
    if (T > 0.3 && (T > 0.55 || n % 2 === 0)) {
      const c = CH[this.chordKey];
      const pick = OSTINATO[n % 16];
      const m = pick === 0 ? c.root + 12 : c.tones[pick] - (z === "squeeze" ? 12 : 0);
      const acc = inBeat === 0 ? 1 : 0.6;
      this._spiccato(t, mtof(m), (0.05 + T * 0.07) * acc, s16 * 0.9);
    }
    // Drums.
    if (T > 0.6) {
      if (n % 16 === 0 || (T > 0.75 && n % 16 === 8)) this._taiko(t, 0.7 + T * 0.3, 1);
      if (T > 0.85 && (n % 16 === 14 || n % 16 === 15)) this._taiko(t, 0.45, 1.5);
      if (T > 0.9 && n % 2 === 1) this._taiko(t, 0.18, 2.2);
    }
  }

  // ---------- voices ----------
  braam(t, rootMidi = 38, amp = 1, distant = false) {
    // Low brass hit: detuned saw/square stack an octave apart -> distortion -> lowpass sweep -> huge verb.
    const ctx = this.ctx;
    if (t - this.lastBraam < 3) return;
    this.lastBraam = t;
    this.braamCount++;
    const f0 = mtof(rootMidi - (rootMidi > 40 ? 12 : 0));
    const dur = distant ? 3.2 : 3.8;
    const voices = [[f0, "sawtooth", -9], [f0, "sawtooth", 9], [f0 * 2, "sawtooth", -5], [f0 * 2, "square", 6], [f0 * 1.5, "sawtooth", 0], [f0 / 2, "square", 0]];
    for (const [f, type, det] of voices) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      // Slight pitch scoop like a brass section digging in.
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.18);
      o.connect(this.braamIn);
      o.start(t); o.stop(t + dur + 0.3);
    }
    const fq = this.braamFilter.frequency;
    fq.cancelScheduledValues(t);
    fq.setValueAtTime(120, t);
    fq.exponentialRampToValueAtTime(distant ? 500 : 1500, t + 0.35);
    fq.exponentialRampToValueAtTime(distant ? 200 : 380, t + 2.2);
    fq.exponentialRampToValueAtTime(120, t + dur);
    const g = this.braamOut.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(0.11 * amp, t + 0.09);
    g.setTargetAtTime(0.07 * amp, t + 0.4, 0.6);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
    if (!distant) this._subDrop(t, 0.5 * amp);
  }

  _subDrop(t, amp) {
    if (!this._voice(2)) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "sine";
    const g = ctx.createGain();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.6);
    this._env(g.gain, t, 0.5 * amp, 0.02, 1.7);
    o.connect(g); g.connect(this.fx);
    o.start(t); o.stop(t + 1.8);
  }

  _shepardRiser(t, dur, endHit) {
    // Endless-rise illusion: octave-spaced sines all gliding up an octave, loud in the middle of the
    // range and silent at the ends, plus a rising noise sweep. Ends on a braam.
    const ctx = this.ctx;
    this.lastRiser = t;
    this.riserCount++;
    const N = 6, base = 55;
    const curveN = 32;
    for (let i = 0; i < N; i++) {
      const o = ctx.createOscillator(); o.type = "sine";
      const g = ctx.createGain();
      o.frequency.setValueAtTime(base * Math.pow(2, i), t);
      o.frequency.exponentialRampToValueAtTime(base * Math.pow(2, i + 1), t + dur);
      const curve = new Float32Array(curveN);
      for (let k = 0; k < curveN; k++) {
        const p = (i + k / (curveN - 1)) / N;
        const env = Math.min(1, (k / (curveN - 1)) * 4) * Math.pow(Math.sin(Math.PI * p), 2);
        curve[k] = 0.0001 + 0.035 * env * (0.4 + 0.6 * k / (curveN - 1));
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setValueCurveAtTime(curve, t + 0.001, dur);
      o.connect(g); g.connect(this.mix);
      o.start(t); o.stop(t + dur + 0.1);
    }
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.95);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(bp); bp.connect(ng); ng.connect(this.mix);
    src.start(t); src.stop(t + dur + 0.1);
    if (endHit) setTimeout(() => this.braam(this.ctx.currentTime + 0.02, CH[this.chordKey].root, 1), Math.max(0, (t + dur - ctx.currentTime) * 1000));
  }

  _spiccato(t, f, amp, len) {
    if (!this._voice(len + 0.2)) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 2.2; bp.Q.value = 1.1;
    const g = ctx.createGain();
    this._env(g.gain, t, amp, 0.004, Math.max(0.06, len));
    o.connect(bp); bp.connect(g); g.connect(this.beatBus);
    o.start(t); o.stop(t + len + 0.15);
  }

  _tick2(t, tick, amp) {
    if (!this._voice(0.1)) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = tick ? 2300 : 1750;
    const g = ctx.createGain();
    this._env(g.gain, t, amp, 0.001, 0.035);
    o.connect(g); g.connect(this.beatBus);
    o.start(t); o.stop(t + 0.06);
  }

  _heart(t, amp, spb) {
    for (const [dt, k] of [[0, 1], [Math.min(0.26, spb * 0.3), 0.65]]) {
      if (!this._voice(0.4)) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = "sine";
      const g = ctx.createGain();
      o.frequency.setValueAtTime(62, t + dt);
      o.frequency.exponentialRampToValueAtTime(36, t + dt + 0.22);
      this._env(g.gain, t + dt, 0.35 * amp * k, 0.012, 0.28);
      o.connect(g); g.connect(this.beatBus);
      o.start(t + dt); o.stop(t + dt + 0.35);
    }
  }

  _taiko(t, amp, pitch = 1) {
    if (!this._voice(0.7)) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "sine";
    const g = ctx.createGain();
    o.frequency.setValueAtTime(95 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.28);
    this._env(g.gain, t, 0.55 * amp, 0.004, 0.6);
    o.connect(g); g.connect(this.beatBus);
    o.start(t); o.stop(t + 0.7);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900 * pitch;
    const ng = ctx.createGain();
    this._env(ng.gain, t, 0.25 * amp, 0.002, 0.14);
    n.connect(lp); lp.connect(ng); ng.connect(this.beatBus);
    n.start(t, Math.random()); n.stop(t + 0.2);
  }

  /** Duck the music briefly (monster scream cutting through). Rhythm keeps its place. */
  duckFor(sec = 1.6, level = 0.2) {
    const t = this.ctx.currentTime;
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t);
    d.linearRampToValueAtTime(level, t + 0.06);
    d.setValueAtTime(level, t + sec);
    d.linearRampToValueAtTime(1, t + sec + 1.2);
  }

  /** Scripted scare: one huge braam, then near-total silence, a lone clock tick, then the pulse returns. */
  _somethingNear() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    this.nearCount++;
    this.nextNear = t + 70 + Math.random() * 90;
    this.lastBraam = -100;
    this.braam(t, 38, 1.25);
    const silence = 2.6;
    this.duckUntil = t + 0.25 + silence;
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t);
    d.linearRampToValueAtTime(0.0, t + 0.25);
    d.setValueAtTime(0.0, t + 0.25 + silence);
    d.linearRampToValueAtTime(1, t + 0.25 + silence + 2.5);
    // Lone tick in the silence (post-duck bus).
    setTimeout(() => {
      const tt = this.ctx.currentTime;
      const o = this.ctx.createOscillator(); o.type = "sine"; o.frequency.value = 2300;
      const g = this.ctx.createGain();
      this._env(g.gain, tt, 0.12, 0.001, 0.05);
      o.connect(g); g.connect(this.fx); o.start(tt); o.stop(tt + 0.08);
    }, (0.25 + silence * 0.7) * 1000);
    this.boost = 0.55;
  }
}

// Back-compat name.
export { CinematicScore as CreepyScore };
