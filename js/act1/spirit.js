/**
 * Round 23: the spirit-vision cinematic as a mushroom vision fades. Letterbox, drifting light motes,
 * a slow camera (driven by main.js while `on`), Kra's inner voice and the Ancestor's answer spoken
 * with Web Speech and subtitled, Skip at any time, then the Insight card (one idea, or a choice of
 * two). The same player replays journal entries (no insight then).
 */
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

export class SpiritVision {
  constructor({ root, voice, touch }) {
    this.voice = voice; this.touch = touch; this.on = false; this.t = 0;
    const o = (this.el = el("div", "hidden")); o.id = "spirit";
    o.innerHTML = `<div class="sp-bar top"></div><div class="sp-bar bot"></div><div class="sp-motes">${Array.from({ length: 22 }, (_, i) => `<i style="left:${(i * 47) % 100}%;animation-delay:${-(i * 1.7) % 14}s;animation-duration:${11 + (i % 5) * 2.5}s"></i>`).join("")}</div>
      <div class="sp-title"><small></small><b></b></div>
      <div class="sp-sub"><span class="who"></span><span class="line"></span></div>
      <button type="button" class="sp-skip">Skip ⏭</button>
      <div class="sp-card hidden"></div>`;
    for (const ev of ["pointerdown", "touchstart", "mousedown"]) o.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    o.querySelector(".sp-skip").addEventListener("click", (e) => { e.stopPropagation(); this.skip(); });
    o.querySelector(".sp-sub").addEventListener("click", (e) => { e.stopPropagation(); this._next(true); });
    window.addEventListener("keydown", (e) => { if (this.on && e.code === "Escape") this.skip(); });
    root.appendChild(o);
  }
  /** lines [{who, text}]; opts { n, title, choices: [{id, name, icon, idea, desc}] | null, onPick(id), onDone(skipped) } */
  run(lines, opts) {
    this.lines = lines.slice(); this.opts = opts; this.i = -1; this.on = true; this.t = 0; this.skipped = false; this.done = false;
    const o = this.el; o.classList.remove("hidden", "out"); o.classList.add("in");
    o.querySelector(".sp-title small").textContent = opts.replay ? `Vision ${ROMAN[opts.n - 1] || opts.n} · remembered` : `Vision ${ROMAN[opts.n - 1] || opts.n}`;
    o.querySelector(".sp-title b").textContent = opts.title;
    o.querySelector(".sp-title").classList.add("show");
    o.querySelector(".sp-card").classList.add("hidden");
    o.querySelector(".sp-sub").classList.remove("show");
    o.querySelector(".sp-skip").classList.remove("hidden");
    clearTimeout(this._tm); this._tm = setTimeout(() => { o.querySelector(".sp-title").classList.remove("show"); this._next(); }, 3200);
  }
  _next(user = false) {
    if (!this.on || this.done) return;
    if (user && performance.now() - (this._at || 0) < 400) return;
    clearTimeout(this._tm); this.voice?.stop?.(false);
    this.i++;
    const L = this.lines[this.i], sub = this.el.querySelector(".sp-sub");
    if (!L) return this._end();
    sub.classList.remove("show"); void sub.offsetWidth;
    sub.querySelector(".who").textContent = L.who === "Kra" ? "Kra (within)" : L.who;
    sub.querySelector(".line").textContent = L.text;
    sub.classList.toggle("anc", L.who !== "Kra"); sub.classList.add("show");
    this._at = performance.now();
    this.current = L;
    const id = this.i;
    const spoken = this.voice?.speak?.(L.text, L.who, () => { if (this.i === id) this._tm = setTimeout(() => this._next(), 900); });
    if (!spoken) this._tm = setTimeout(() => this._next(), Math.max(3200, L.text.length * 62));
  }
  skip() { if (!this.on) return; this.skipped = true; this.voice?.stop?.(false); clearTimeout(this._tm); this.i = this.lines.length; this._end(); }
  _end() {
    if (this.done) return; this.done = true;
    const o = this.el; o.querySelector(".sp-sub").classList.remove("show"); o.querySelector(".sp-skip").classList.add("hidden");
    const ch = this.opts.choices;
    if (!ch?.length) return this._close();
    const card = o.querySelector(".sp-card");
    card.innerHTML = `<h3>${ch.length > 1 ? "Two ideas take shape. Keep one." : "An idea takes shape"}</h3>` + ch.map((c) => `<button type="button" class="sp-ins" data-id="${c.id}"><span class="ic">${c.icon}</span><b>${esc(c.name)}${c.policy ? " <em>policy</em>" : ""}</b><i>“${esc(c.idea)}”</i><small>${esc(c.desc)}</small></button>`).join("");
    card.classList.remove("hidden");
    card.querySelectorAll(".sp-ins").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); this.opts.onPick?.(b.dataset.id); this._close(); }, { once: true }));
  }
  _close() {
    const o = this.el; o.classList.remove("in"); o.classList.add("out");
    setTimeout(() => { if (o.classList.contains("out")) o.classList.add("hidden"); }, 1300);
    this.on = false; this.opts.onDone?.(this.skipped);
  }
  update(dt) { if (this.on) this.t += dt; }
}
