/**
 * Procedural, positional monster voice (Web Audio only, no files):
 *  - scream():  piercing shriek when it spots you (detuned saw stack through vowel formants,
 *               noise burst, violent pitch bend, distortion, ~1.5 s). Ducks the music.
 *  - growl():   guttural growl / death-rattle when close.
 *  - clicks():  wet echolocation clicks while hunting.
 *  - wail():    distant echoing wail while roaming (heavy reverb).
 *  - pain():    short pained screech when stabbed.
 *  - death():   long descending death howl with a gurgle.
 * Everything goes through one PannerNode at the monster's position plus a shared reverb.
 */
export class MonsterVoice {
  constructor(audio) {
    this.audio = audio;
    this.ready = false;
    this.cool = { scream: 0, growl: 0, clicks: 0, wail: 0, pain: 0 };
    this.log = [];
  }

  _init() {
    const a = this.audio;
    if (this.ready || !a.started || !a.ctx) return this.ready;
    const ctx = (this.ctx = a.ctx);
    this.panner = ctx.createPanner();
    this.panner.panningModel = "equalpower";
    this.panner.distanceModel = "inverse";
    this.panner.refDistance = 2.5;
    this.panner.rolloffFactor = 1.1;
    this.panner.maxDistance = 120;
    this.out = ctx.createGain();
    this.out.gain.value = 1.0;
    this.panner.connect(this.out);
    this.out.connect(a.master);
    // Shared reverb for the cave voice (wetter when far).
    this.verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.verb.buffer = b;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.25;
    this.panner.connect(this.wet);
    this.wet.connect(this.verb);
    this.verb.connect(this.out);
    this.input = ctx.createGain();
    this.input.connect(this.panner);
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = n.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = n;
    const shaper = (this.shaper = ctx.createWaveShaper());
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(4 * x); }
    shaper.curve = c;
    shaper.connect(this.input);
    this.ready = true;
    return true;
  }

  /** Called every frame with the monster position and distance to the listener. */
  update(pos, dist, now) {
    if (!this._init()) return;
    const t = this.ctx.currentTime;
    const p = this.panner;
    if (p.positionX) {
      p.positionX.setTargetAtTime(pos.x, t, 0.05);
      p.positionY.setTargetAtTime(pos.y + 0.8, t, 0.05);
      p.positionZ.setTargetAtTime(pos.z, t, 0.05);
    } else p.setPosition(pos.x, pos.y + 0.8, pos.z);
    // Far away = mostly reverb (it sounds like it's somewhere down the passages).
    this.wet.gain.setTargetAtTime(Math.min(1.6, 0.2 + dist / 25), t, 0.3);
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - (now - (this._last || now)));
    this._last = now;
  }

  _ok(kind, cd) {
    if (!this._init() || this.audio.muted) return false;
    if (this.cool[kind] > 0) return false;
    this.cool[kind] = cd;
    this.log.push(kind);
    if (this.log.length > 40) this.log.shift();
    return true;
  }

  _formants(src, t, list, dest) {
    for (const [f, q, g] of list) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
      const gg = this.ctx.createGain(); gg.gain.value = g;
      src.connect(bp); bp.connect(gg); gg.connect(dest);
    }
  }

  _screech(t, dur, f0, bend, amp, formants) {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp, t + 0.03);
    env.gain.setTargetAtTime(amp * 0.7, t + 0.25, 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.shaper);
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    this._formants(mix, t, formants, env);
    const vib = ctx.createOscillator(); vib.frequency.value = 17 + Math.random() * 6;
    const vg = ctx.createGain(); vg.gain.value = f0 * 0.05;
    vib.connect(vg);
    for (const [mul, det, type] of [[1, -32, "sawtooth"], [1, 27, "sawtooth"], [1.5, 9, "square"], [2.02, -12, "sawtooth"], [0.5, 0, "sawtooth"]]) {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = det;
      const f = f0 * mul;
      o.frequency.setValueAtTime(f * bend[0], t);
      o.frequency.exponentialRampToValueAtTime(f * bend[1], t + dur * 0.18);
      o.frequency.exponentialRampToValueAtTime(f * bend[2], t + dur);
      vg.connect(o.frequency);
      o.connect(mix);
      o.start(t); o.stop(t + dur + 0.05);
    }
    vib.start(t); vib.stop(t + dur + 0.05);
    // Noise burst (breath / tearing).
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(amp * 0.9, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.5, dur * 0.4));
    n.connect(hp); hp.connect(ng); ng.connect(this.shaper);
    n.start(t, Math.random() * 0.4); n.stop(t + dur);
  }

  scream() {
    if (!this._ok("scream", 12)) return false;
    const t = this.ctx.currentTime + 0.02;
    this._screech(t, 1.55, 640 + Math.random() * 120, [0.55, 1.35, 0.72], 0.55, [[900, 5, 1], [2400, 7, 1.2], [3600, 9, 0.8], [5200, 10, 0.5]]);
    // Music ducks so the scream cuts through.
    this.audio.music?.duckFor?.(1.7, 0.2);
    return true;
  }

  pain() {
    if (!this._ok("pain", 0.4)) return false;
    const t = this.ctx.currentTime + 0.01;
    this._screech(t, 0.55, 900 + Math.random() * 200, [1.2, 1.6, 0.9], 0.45, [[1200, 6, 1], [3000, 8, 1], [4400, 9, 0.6]]);
    return true;
  }

  death() {
    this.cool.scream = 0;
    if (!this._ok("death", 0)) return false;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    this._screech(t, 2.6, 760, [1.1, 1.3, 0.22], 0.5, [[800, 5, 1], [2100, 6, 1], [3300, 8, 0.6]]);
    // Gurgle: AM-rattled low growl underneath, fading.
    this._growlAt(t + 0.6, 2.2, 0.35, 12);
    this.audio.music?.duckFor?.(2.2, 0.3);
    return true;
  }

  _growlAt(t, dur, amp, rattleHz = 26) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(62 + Math.random() * 18, t);
    o.frequency.linearRampToValueAtTime(48, t + dur);
    const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = 93; o2.detune.value = 30;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 3;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = rattleHz + Math.random() * 6;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(amp, t + 0.15);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(am); am.connect(env); env.connect(this.shaper);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 380; bp.Q.value = 1.5;
    n.connect(bp); bp.connect(am);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.05); }
    n.start(t, Math.random() * 0.3); n.stop(t + dur);
  }

  growl() {
    if (!this._ok("growl", 2.6 + Math.random() * 1.5)) return false;
    this._growlAt(this.ctx.currentTime + 0.02, 1.0 + Math.random() * 0.6, 0.4);
    return true;
  }

  clicks(loud = 1) {
    if (!this._ok("clicks", loud > 0.6 ? 1.6 + Math.random() * 1.4 : 5 + Math.random() * 4)) return false;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.02;
    const n = 4 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1100 + Math.random() * 2600; bp.Q.value = 9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * loud, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(bp); bp.connect(g); g.connect(this.input);
      src.start(t, Math.random() * 0.8); src.stop(t + 0.06);
      t += 0.05 + Math.random() * 0.09;
    }
    return true;
  }

  wail() {
    if (!this._ok("wail", 18 + Math.random() * 16)) return false;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02, dur = 2.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.28, t + 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.input);
    const mix = ctx.createGain(); mix.gain.value = 0.4;
    this._formants(mix, t, [[700, 4, 1], [1150, 5, 0.7]], env);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vg = ctx.createGain(); vg.gain.value = 9;
    vib.connect(vg);
    for (const [det, type] of [[-15, "sawtooth"], [15, "triangle"]]) {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = det;
      o.frequency.setValueAtTime(290, t);
      o.frequency.exponentialRampToValueAtTime(460, t + 0.9);
      o.frequency.exponentialRampToValueAtTime(250, t + dur);
      vg.connect(o.frequency); o.connect(mix);
      o.start(t); o.stop(t + dur + 0.05);
    }
    vib.start(t); vib.stop(t + dur);
    return true;
  }
}
