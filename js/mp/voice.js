/**
 * Round 22: proximity voice chat. Your mic goes out as a WebRTC audio track (push-to-talk mutes the
 * track, so nothing is sent while silent); each player's audio runs through WebAudio gain + stereo
 * pan by distance / direction, and an analyser lights their name tag while they speak.
 */
export class Voice {
  constructor(mp) {
    this.mp = mp; this.stream = null; this.track = null; this.on = false; this.peers = new Map();
    this.roomWide = localStorage.getItem("fota-mp-voice-room") === "1";
    this.toggleMode = localStorage.getItem("fota-mp-ptt-toggle") === "1";
    this.muteAll = false; this.level = 0; this.selfSpeaking = false; this._buf = new Float32Array(512);
  }
  ctx() { return this.mp.env.audioCtx(); }
  get micReady() { return !!this.track && this.track.readyState === "live"; }
  async enableMic() {
    if (this.micReady) return true;
    if (this._asking) return this._asking;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { this.mp.toast("This browser can't share a microphone here (needs https)."); return false; }
    this._asking = (async () => {
      try {
        this.stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        this.track = this.stream.getAudioTracks()[0]; this.track.enabled = false;
        this.track.onended = () => { this.track = null; this.mp.refresh(); };
        this.mp.t?.caps.voice && this.mp.t.addStream(this.stream);
        const ctx = this.ctx();
        if (ctx) { this.selfAn = ctx.createAnalyser(); this.selfAn.fftSize = 512; ctx.createMediaStreamSource(this.stream).connect(this.selfAn); }
        return true;
      } catch (e) {
        const n = e?.name || "";
        this.mp.toast(n === "NotAllowedError" ? (this.mp.env.isIOS ? "Microphone blocked. iPhone: Settings › Safari › Microphone › Allow, then tap 🎙 again." : "Microphone blocked: allow it in the address bar, then tap 🎙 again.")
          : n === "NotFoundError" ? "No microphone found." : "Microphone unavailable: " + (e?.message || n));
        return false;
      } finally { this._asking = null; }
    })();
    return this._asking;
  }
  async talk(on) {
    if (on && !(await this.enableMic())) return;
    this.on = !!on && this.micReady;
    if (this.track) this.track.enabled = this.on;
    this.mp.send("vo", { on: this.on ? 1 : 0 });
    this.mp.refresh();
  }
  /** Re-send our mic to a peer who joined after we enabled it (Trystero only streams to current peers). */
  peerJoined() { if (this.stream && this.mp.t?.caps.voice) { try { this.mp.t.addStream(this.stream); } catch {} } }
  addRemote(stream, id) {
    this.removeRemote(id);
    const ctx = this.ctx(); const el = new Audio(); el.autoplay = true; el.playsInline = true; el.srcObject = stream;
    const p = { stream, el, id };
    if (ctx) {
      el.muted = true; // Chrome only feeds WebAudio from a remote stream that is attached to a media element
      p.src = ctx.createMediaStreamSource(stream); p.an = ctx.createAnalyser(); p.an.fftSize = 512;
      p.gain = ctx.createGain(); p.gain.gain.value = 0; p.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      p.src.connect(p.an); p.src.connect(p.gain);
      if (p.pan) { p.gain.connect(p.pan); p.pan.connect(ctx.destination); } else p.gain.connect(ctx.destination);
    }
    el.play?.().catch(() => {});
    this.peers.set(id, p);
    this.mp.refresh();
  }
  removeRemote(id) { const p = this.peers.get(id); if (!p) return; try { p.src?.disconnect(); p.gain?.disconnect(); p.pan?.disconnect(); } catch {} p.el.srcObject = null; this.peers.delete(id); }
  _rms(an) { if (!an) return 0; an.getFloatTimeDomainData(this._buf); let s = 0; for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i]; return Math.sqrt(s / this._buf.length); }
  update(dt, me, yaw) {
    // own level (mic button glow)
    this.level = this.on ? this._rms(this.selfAn) : 0;
    const now = performance.now();
    if (this.on && this.level > 0.006) this._selfLoud = now;
    this.selfSpeaking = this.on && now - (this._selfLoud || 0) < 350; // hold briefly between syllables
    for (const [id, p] of this.peers) {
      const P = this.mp.players.get(id), av = P?.av;
      let g = 1, pan = 0;
      if (av && av.s !== null && me) {
        const dx = av.pos.x - me.x, dz = av.pos.z - me.z, d = Math.hypot(dx, dz);
        if (!this.roomWide) g = d < 6 ? 1 : Math.max(0, 1 - (d - 6) / 54) ** 1.4;
        if (P.area !== this.mp.area && !this.roomWide) g = 0;
        const rx = dx * Math.cos(yaw) - dz * Math.sin(yaw); // listener-relative right
        pan = d > 0.5 ? Math.max(-0.85, Math.min(0.85, rx / d)) : 0;
      }
      if (this.muteAll || P?.muted || P?.blocked) g = 0;
      if (p.gain) { p.gain.gain.setTargetAtTime(g, p.gain.context.currentTime, 0.08); p.pan && p.pan.pan.setTargetAtTime(pan, p.pan.context.currentTime, 0.08); }
      else { p.el.muted = g === 0; p.el.volume = Math.min(1, g); }
      const lvl = this._rms(p.an);
      if (lvl > 0.006) p.loud = now;
      p.speaking = now - (p.loud || 0) < 350;
    }
  }
  speaking(id) { const p = this.peers.get(id); return !!p?.speaking; }
  stop() { for (const id of [...this.peers.keys()]) this.removeRemote(id); if (this.stream) { try { this.mp.t?.removeStream(this.stream); } catch {} for (const t of this.stream.getTracks()) t.stop(); } this.stream = null; this.track = null; this.on = false; }
}
