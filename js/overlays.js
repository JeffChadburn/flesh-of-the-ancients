/**
 * Round 24c: one way out of every overlay.
 *  - A big ✕ (48 px) pinned to the top-right corner of the *visible* screen (inside the iPhone safe
 *    area, following pinch-zoom via visualViewport), above everything, shown whenever any overlay
 *    is open: it closes the topmost one.
 *  - A small "Close all" pill beside it: the failsafe that shuts every overlay at once.
 *  - Esc closes the topmost overlay; so does the browser / swipe "back" gesture (a history entry
 *    is pushed while something is open).
 * Overlays register as { name, open: () => bool, close: () => void }, topmost first.
 */
export class Overlays {
  constructor(list = []) {
    this.list = list; this.n = 0; this.log = [];
    const x = (this.x = document.createElement("button"));
    x.id = "ov-x"; x.type = "button"; x.className = "hidden"; x.textContent = "✕"; x.setAttribute("aria-label", "Close");
    const all = (this.all = document.createElement("button"));
    all.id = "ov-all"; all.type = "button"; all.className = "hidden"; all.textContent = "Close all"; all.setAttribute("aria-label", "Close everything");
    for (const b of [x, all]) {
      for (const e of ["pointerdown", "touchstart", "mousedown"]) b.addEventListener(e, (ev) => ev.stopPropagation(), { passive: true });
      document.body.appendChild(b);
    }
    x.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); this.closeTop("button"); });
    all.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); this.closeAll("button"); });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Escape" || !this.top() || this.top().ownEsc?.()) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.closeTop("esc");
    }, true);
    window.addEventListener("popstate", () => {
      if (this._ignorePop) { this._ignorePop = false; return; }
      this._pushed = false;
      if (this.top()) { this.closeTop("back"); this.refresh(); }
    });
    // iOS Safari ignores user-scalable=no: block its pinch gesture events so the page itself can't be
    // zoomed until the controls slide off-screen, and keep the ✕ on the visible part if it was.
    for (const e of ["gesturestart", "gesturechange"]) document.addEventListener(e, (ev) => ev.preventDefault(), { passive: false });
    const vv = window.visualViewport;
    if (vv) { const f = () => this._place(); vv.addEventListener("resize", f); vv.addEventListener("scroll", f); }
    this._iv = setInterval(() => this.refresh(), 150);
  }
  add(o) { this.list.push(o); return this; }
  openList() { const out = []; for (const o of this.list) { try { if (o.open()) out.push(o); } catch {} } return out; }
  top() { return this.openList()[0] || null; }
  closeTop(how = "") {
    const o = this.top(); if (!o) return null;
    try { o.close(); } catch (err) { console.warn("overlay close failed", o.name, err); }
    this.log.push({ e: "close", name: o.name, how }); this.refresh(); return o.name;
  }
  closeAll(how = "") {
    const names = [];
    for (let i = 0; i < 12; i++) { const o = this.top(); if (!o) break; try { o.close(); } catch {} names.push(o.name); if (o.open?.()) o.force?.(); }
    this.log.push({ e: "closeAll", names, how }); this.refresh(); return names;
  }
  /** Tapping the dimmed backdrop (the overlay element itself, outside its box) closes it. */
  _backdrops() {
    for (const o of this.list) {
      if (!o.bd || o._bdOn) continue;
      let el = null; try { el = o.bd(); } catch {}
      if (!el) continue;
      o._bdOn = true;
      el.addEventListener("click", (e) => { if (e.target === el && o.open()) { o.close(); this.log.push({ e: "close", name: o.name, how: "backdrop" }); this.refresh(); } });
    }
  }
  refresh() {
    this._backdrops();
    const open = this.openList(), n = open.length;
    this.x.classList.toggle("hidden", !n); this.all.classList.toggle("hidden", !n);
    if (n) this.x.title = `Close ${open[0].label || open[0].name}${open[0].key ? "" : " (Esc)"}`;
    if (n && !this._pushed) { try { history.pushState({ fotaOverlay: 1 }, ""); this._pushed = true; } catch {} }
    if (!n && this._pushed) { this._pushed = false; if (history.state?.fotaOverlay) { this._ignorePop = true; try { history.back(); } catch { this._ignorePop = false; } } }
    if (n !== this.n) { this.n = n; this._place(); }
  }
  _place() {
    const vv = window.visualViewport;
    if (!vv || Math.abs(vv.scale - 1) < 0.01) { this.x.style.transform = this.all.style.transform = ""; return; }
    // zoomed in: pin to the visible corner at a constant on-screen size
    const k = 1 / vv.scale, dx = vv.offsetLeft + vv.width - window.innerWidth, dy = vv.offsetTop;
    for (const b of [this.x, this.all]) { b.style.transformOrigin = "top right"; b.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`; }
  }
  state() { return { open: this.openList().map((o) => o.name), x: !this.x.classList.contains("hidden"), log: this.log.slice(-20) }; }
}
