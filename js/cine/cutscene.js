/**
 * Round 24: the in-engine cutscene player (the intro and the "Memories"). Real time, no video
 * files: each scene is either a camera move in the live world (the game drives the camera through
 * hooks.cam) or an animated cave-painting panel (paintings.js), with title cards, narration
 * (Web Speech, through the mixer's Voices level) and subtitles, a Web Audio score and fades.
 * Tap / click / Space moves to the next line; Skip (or Esc) ends it.
 *
 * script: { id, title, mood, scenes: [{ panel?, at?, cam?, time?, card?: [title, sub], lines: [text | {who, text}], hold? }] }
 * hooks:  { prepare(scene, i) -> Promise, cam(scene, t, dt), done(skipped) }
 */
import { drawPanel } from "./paintings.js";
import { CineScore } from "./score.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cutscene {
  constructor({ root, audio, voice, touch }) {
    this.audio = audio; this.voice = voice; this.touch = touch; this.on = false; this.score = new CineScore(audio);
    const el = (this.el = document.createElement("div")); el.id = "cine"; el.className = "hidden";
    el.innerHTML = `<canvas class="cn-cv"></canvas><div class="cn-bar top"></div><div class="cn-bar bot"></div><div class="cn-fade"></div>
      <div class="cn-card hidden"><h2></h2><p></p></div><div class="cn-sub"><b></b><span></span></div>
      <button class="cn-skip" type="button">Skip ⏭</button><div class="cn-tip">${touch ? "Tap" : "Click / Space"} for the next line</div>`;
    root.appendChild(el);
    this.cv = el.querySelector(".cn-cv"); this.g = this.cv.getContext("2d");
    this.fadeEl = el.querySelector(".cn-fade"); this.card = el.querySelector(".cn-card"); this.sub = el.querySelector(".cn-sub");
    for (const e of ["pointerdown", "pointerup", "touchstart", "wheel", "mousedown"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
    el.querySelector(".cn-skip").addEventListener("click", (e) => { e.stopPropagation(); this.skip(); });
    el.addEventListener("click", (e) => { e.stopPropagation(); this.next(); });
    this._key = (e) => { if (!this.on) return; if (e.code === "Escape") { e.preventDefault(); e.stopPropagation(); this.skip(); } else if (e.code === "Space" || e.code === "Enter" || e.code === "KeyE") { e.preventDefault(); e.stopPropagation(); this.next(); } };
    window.addEventListener("keydown", this._key, true);
    this.log = [];
  }
  get line() { return this._line || null; }
  /** Play a script. Resolves with skipped (bool). */
  async play(script, hooks = {}) {
    if (this.on) return false;
    this.on = true; this.script = script; this.hooks = hooks; this.skipped = false; this._adv = null; this.t = 0; this.scene = null; this.sceneI = -1;
    this.el.classList.remove("hidden"); this.el.classList.add("cn-dark"); this._fade(1, 0);
    this.audio.music?.setOn?.(false);
    this.score.start(script.mood || "dread");
    this.log.push({ e: "start", id: script.id });
    try {
      for (let i = 0; i < script.scenes.length && !this.skipped; i++) await this._scene(script.scenes[i], i);
    } catch (err) { console.warn("cutscene", err); }
    return this._end();
  }
  async _scene(sc, i) {
    this._fade(1, 0.6); await this._wait(650, true);
    if (this.skipped) return;
    this.scene = sc; this.sceneI = i; this.sceneT = 0; this.sceneDur = 0;
    this.el.classList.toggle("cn-panel", !!sc.panel);
    if (!sc.panel) await (this.hooks.prepare?.(sc, i) || null);
    if (this.skipped) return;
    this.el.classList.remove("cn-dark");
    this._fade(0, 1.1);
    if (sc.accent) this.score.accent();
    if (sc.card) await this._card(sc.card);
    const lines = sc.lines || [];
    this.sceneDur = lines.reduce((a, l) => a + this._lineMs(l) / 1000, 0) + (sc.hold || 1.2);
    for (const l of lines) { if (this.skipped) return; await this._say(l); await this._wait(380); }
    if (sc.hold) await this._wait(sc.hold * 1000, true);
  }
  _lineMs(l) { const t = typeof l === "string" ? l : l.text; return 1300 + t.split(/\s+/).length * 360; }
  async _card([title, sub]) {
    this.card.querySelector("h2").textContent = title; this.card.querySelector("p").textContent = sub || "";
    this.card.classList.remove("hidden", "out"); void this.card.offsetWidth; this.card.classList.add("in");
    this.log.push({ e: "card", title });
    await this._wait(3200, true);
    this.card.classList.add("out"); await this._wait(700, true); this.card.classList.add("hidden"); this.card.classList.remove("in", "out");
  }
  async _say(l) {
    const who = typeof l === "string" ? "" : l.who || "", text = typeof l === "string" ? l : l.text;
    this._line = { who, text, scene: this.sceneI };
    this.sub.querySelector("b").textContent = who ? who + ": " : ""; this.sub.querySelector("span").textContent = text;
    this.sub.classList.add("on");
    this.log.push({ e: "line", who, text: text.slice(0, 60) });
    const fallback = this._lineMs(l);
    let spoke = false, ended = false;
    const done = new Promise((res) => {
      spoke = !!this.voice?.speak?.(text, who === "Kra" ? "Kra" : who === "Old Lume" ? "Old Lume" : "", () => { ended = true; res(); });
      if (!spoke) setTimeout(res, fallback);
      else setTimeout(res, fallback * 2.2 + 3000); // never hang on a speech engine that doesn't call back
    });
    await Promise.race([done, new Promise((r) => (this._adv = r))]);
    this._adv = null;
    if (spoke && !ended) this.voice?.stop?.(false);
    this.sub.classList.remove("on");
  }
  _wait(ms, skippable = false) { return new Promise((r) => { const id = setTimeout(r, ms); if (skippable) this._wr = () => { clearTimeout(id); r(); }; }); }
  _fade(to, s) { this.fadeEl.style.transition = `opacity ${s}s ease`; this.fadeEl.style.opacity = to; }
  next() { if (!this.on) return; if (this._adv) this._adv(); else this._wr?.(); }
  skip() { if (!this.on || this.skipped) return; this.skipped = true; this.log.push({ e: "skip" }); this._adv?.(); this._wr?.(); this.voice?.stop?.(false); }
  async _end() {
    this._fade(1, 0.5); await sleep(520);
    this.score.stop(1.2);
    this.audio.music?.setOn?.(this.audio.musicOn);
    this.scene = null; this._line = null; this.sub.classList.remove("on"); this.card.classList.add("hidden");
    const sk = this.skipped;
    this.hooks.done?.(sk);
    this._fade(0, 0.6); await sleep(620);
    this.el.classList.add("hidden"); this.el.classList.remove("cn-panel", "cn-dark");
    this.on = false; this.log.push({ e: "end", skipped: sk });
    return sk;
  }
  /** Per frame from the game loop. */
  update(dt) {
    if (!this.on) return;
    this.t += dt; if (this.scene) this.sceneT += dt;
    const sc = this.scene;
    if (sc?.panel) {
      const W = this.el.clientWidth, H = this.el.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.cv.width !== Math.round(W * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = this.sceneDur ? Math.min(1, this.sceneT / this.sceneDur) : 0;
      drawPanel(this.g, sc.panel, this.sceneT, W, H, k);
      this.g.setTransform(1, 0, 0, 1, 0, 0);
    } else if (sc) this.hooks.cam?.(sc, this.sceneT, dt, this.sceneDur);
  }
}
