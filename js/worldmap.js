/**
 * Round 16: the full-screen map (tap the minimap or 🗺, M on desktop). Pan with a finger / mouse,
 * pinch or wheel to zoom, ✕ to close.
 *  - Overworld: the terrain under a fog of war that lifts where Kra has been, the trail he walked,
 *    towns, discovered cave mouths, people with quests, the tracked quest target and Kra's arrow.
 *  - In a cave: the passages explored so far, the way out and Kra.
 * Fog + trail persist in localStorage per world (and per story / free play). Cheap: the terrain
 * image (160 x 160 cells of 16 m) is built once, the fog is a 160 x 160 alpha image scaled up.
 */
import { mapFilters as F } from "./mapfilters.js";
const N = 256, CELL = 25, HALF = (N * CELL) / 2; // covers +-3200 m (round 18: the bigger world)
const TRAIL_STEP = 8, TRAIL_MAX = 4000;

export class WorldMap {
  constructor(root, { touch = false } = {}) {
    this.touch = touch;
    const el = (this.el = document.createElement("div"));
    el.className = "wmap hidden";
    el.innerHTML = `<canvas></canvas><div class="wm-top"><b class="wm-title">Map</b><span class="wm-btns"><button class="wm-find" type="button" aria-label="Find">🔍 Find</button><button class="wm-hint" type="button" aria-label="Hint">💡 Hint</button><button class="wm-f" type="button" aria-label="Map filters">⚙</button><button class="wm-x" type="button" aria-label="Close map">✕</button></span></div>
      <div class="wm-ctl"><button data-z="1" type="button" aria-label="Zoom in">+</button><button data-z="-1" type="button" aria-label="Zoom out">−</button><button data-z="0" type="button" aria-label="Centre on Kra">◎</button></div>
      <div class="wm-legend"></div>`;
    root.appendChild(el);
    this.cv = el.querySelector("canvas"); this.ctx = this.cv.getContext("2d");
    this.fog = new Uint8Array(N * N); this.trail = []; this.key = null; this.dirty = false; this.saveT = 0;
    this.view = { cx: 0, cz: 0, s: 1 }; this.isOpen = false; this.state = null;
    for (const e of ["pointerdown", "click", "pointerup", "touchstart", "wheel"]) el.addEventListener(e, (ev) => ev.stopPropagation(), { passive: e !== "wheel" });
    el.querySelector(".wm-x").addEventListener("click", () => this.close());
    el.querySelector(".wm-f").addEventListener("click", () => this.onFilters?.());
    el.querySelector(".wm-hint").addEventListener("click", () => this.onHint?.());
    el.querySelector(".wm-find").addEventListener("click", () => this.onFind?.()); // round 24b
    el.querySelectorAll(".wm-ctl button").forEach((b) => b.addEventListener("click", () => {
      const z = +b.dataset.z;
      if (!z) this.center(); else this.zoomAt(this.cv.clientWidth / 2, this.cv.clientHeight / 2, z > 0 ? 1.6 : 1 / 1.6);
      this.draw();
    }));
    // pan / pinch
    const pts = new Map(); let last = null;
    let tap = null; // round 23: a tap (not a drag / pinch) opens the beacon / fast-travel menu
    this.cv.addEventListener("pointerdown", (e) => { this.cv.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); last = null; tap = pts.size === 1 ? { x: e.offsetX, y: e.offsetY, t: performance.now(), id: e.pointerId } : null; });
    this.cv.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const a = [...pts.values()];
      if (a.length === 1) {
        if (last && last.n === 1) { this.view.cx -= (a[0].x - last.x) / this.view.s; this.view.cz -= (a[0].y - last.y) / this.view.s; this.draw(); }
        last = { n: 1, x: a[0].x, y: a[0].y };
      } else {
        const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2, d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (last && last.n === 2) {
          this.view.cx -= (mx - last.x) / this.view.s; this.view.cz -= (my - last.y) / this.view.s;
          if (last.d > 5) this.zoomAt(mx, my, d / last.d);
          this.draw();
        }
        last = { n: 2, x: mx, y: my, d };
      }
    });
    const up = (e) => {
      if (e.type === "pointerup" && tap && tap.id === e.pointerId && pts.size === 1 && Math.hypot(e.offsetX - tap.x, e.offsetY - tap.y) < 9 && performance.now() - tap.t < 600) this._tap(tap.x, tap.y);
      else if (tap && (pts.size > 1 || Math.hypot(e.offsetX - tap.x, e.offsetY - tap.y) >= 9)) this._closePop();
      tap = null; pts.delete(e.pointerId); last = null;
    };
    this.cv.addEventListener("pointerup", up); this.cv.addEventListener("pointercancel", up);
    this.cv.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8); this.draw(); }, { passive: false });
  }

  // ---------------- round 23: tap menu (beacon / fast travel) ----------------
  /** Screen point (CSS px in the canvas) -> world x, z. */
  toWorld(px, py) { const v = this.view; return { x: v.cx + (px - this.cv.clientWidth / 2) / v.s, z: v.cz + (py - this.cv.clientHeight / 2) / v.s }; }
  _tap(px, py) {
    const s = this.state?.(); if (!s || !this.onTap) return;
    const w = this.toWorld(px, py), items = this.onTap({ ...w, px, py, scale: this.view.s, mode: s.mode }) || [];
    this._closePop(); if (!items.length) return;
    this.sel = w;
    const pop = (this._pop = document.createElement("div")); pop.className = "wm-pop";
    for (const it of items) {
      const b = document.createElement(it.note ? "div" : "button");
      if (it.note) { b.className = "wm-note"; b.textContent = it.label; } else { b.type = "button"; b.textContent = it.label; if (it.cls) b.className = it.cls; if (it.disabled) { b.disabled = true; b.title = it.why || ""; } b.addEventListener("click", (e) => { e.stopPropagation(); this._closePop(); it.act?.(); this.draw(); }); }
      pop.appendChild(b);
    }
    this.el.appendChild(pop);
    const W = this.el.clientWidth, H = this.el.clientHeight, r = pop.getBoundingClientRect(), cr = this.cv.getBoundingClientRect(), er = this.el.getBoundingClientRect();
    let x = px + (cr.left - er.left) + 12, y = py + (cr.top - er.top) - r.height / 2;
    if (x + r.width > W - 6) x = px + (cr.left - er.left) - r.width - 12;
    pop.style.left = Math.max(6, x) + "px"; pop.style.top = Math.max(50, Math.min(H - r.height - 8, y)) + "px";
    this.draw();
  }
  _closePop() { if (this._pop) { this._pop.remove(); this._pop = null; } if (this.sel) { this.sel = null; this.draw(); } }

  // ---------------- exploration record ----------------
  setWorld(terrain, key) {
    if (this.terrain === terrain && this.key === key) return;
    this.flush();
    this.terrain = terrain; this.key = key; this.bg = null;
    this.fog.fill(0); this.trail = []; this._fogImg = null;
    try {
      const o = JSON.parse(localStorage.getItem(key) || "null");
      if (o?.f && o.n === N) { const b = atob(o.f); for (let i = 0; i < Math.min(b.length, N * N); i++) this.fog[i] = b.charCodeAt(i); }
      if (o?.t) for (let i = 0; i + 1 < o.t.length; i += 2) this.trail.push([o.t[i], o.t[i + 1]]);
    } catch {}
  }
  clear(key) { try { localStorage.removeItem(key); } catch {} if (this.key === key) { this.fog.fill(0); this.trail = []; this._fogImg = null; } }
  flush() {
    if (!this.key || !this.dirty) return;
    this.dirty = false;
    let s = ""; for (let i = 0; i < this.fog.length; i += 4096) s += String.fromCharCode.apply(null, this.fog.subarray(i, i + 4096));
    try { localStorage.setItem(this.key, JSON.stringify({ n: N, f: btoa(s), t: this.trail.flat() })); } catch {}
  }
  /** Overworld: reveal around (x, z) and extend the trail. Call every frame (cheap). */
  record(x, z, dt, reach = 1) {
    const lp = this._lp;
    if (!lp || Math.hypot(x - lp.x, z - lp.z) > 4) {
      this._lp = { x, z };
      const R = 70 * reach, ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL), k = Math.ceil(R / CELL);
      for (let j = cj - k; j <= cj + k; j++) for (let i = ci - k; i <= ci + k; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const d = Math.hypot((i + 0.5) * CELL - HALF - x, (j + 0.5) * CELL - HALF - z);
        if (d < R && !this.fog[j * N + i]) { this.fog[j * N + i] = 1; this.dirty = true; this._fogImg = null; }
      }
      const t = this.trail[this.trail.length - 1];
      if (!t || Math.hypot(t[0] - x, t[1] - z) > TRAIL_STEP) { this.trail.push([Math.round(x), Math.round(z)]); if (this.trail.length > TRAIL_MAX) this.trail.shift(); this.dirty = true; }
    }
    if ((this.saveT += dt) > 10) { this.saveT = 0; this.flush(); }
  }
  /** Round 23 (Scouting): reveal a disc of radius R around (x, z). */
  revealAt(x, z, R) {
    const ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL), k = Math.ceil(R / CELL); let n = 0;
    for (let j = cj - k; j <= cj + k; j++) for (let i = ci - k; i <= ci + k; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if (Math.hypot((i + 0.5) * CELL - HALF - x, (j + 0.5) * CELL - HALF - z) < R && !this.fog[j * N + i]) { this.fog[j * N + i] = 1; n++; }
    }
    if (n) { this.dirty = true; this._fogImg = null; this.flush(); }
    return n;
  }
  seen(x, z) { const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL); return i >= 0 && j >= 0 && i < N && j < N && !!this.fog[j * N + i]; }
  revealedCount() { let n = 0; for (const v of this.fog) n += v; return n; }

  // ---------------- open / close ----------------
  open(state, focus = null) {
    this.state = state; this.isOpen = true;
    this.el.classList.remove("hidden");
    const s = state();
    this.resize(); this.center(s);
    if (focus) { this.view.cx = (focus.x + s.player.x) / 2; this.view.cz = (focus.z + s.player.z) / 2; }
    this.view.s = s.mode === "overworld" ? Math.min(this.cv.clientWidth, this.cv.clientHeight) / 500 : Math.min(this.cv.clientWidth, this.cv.clientHeight) / 90;
    if (focus) { const span = Math.max(Math.abs(focus.x - s.player.x), Math.abs(focus.z - s.player.z)) * 2 + (s.mode === "overworld" ? 80 : 16); this.view.s = Math.max(0.05, Math.min(this.view.s * 3, Math.min(this.cv.clientWidth, this.cv.clientHeight - 120) / span)); }
    this.draw();
    clearInterval(this._iv); this._iv = setInterval(() => this.draw(), 90);
  }
  close() { this._closePop(); this.isOpen = false; this.el.classList.add("hidden"); clearInterval(this._iv); this.onClose?.(); }
  toggle(state) { if (this.isOpen) this.close(); else this.open(state); }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = this.cv.clientWidth || window.innerWidth, h = this.cv.clientHeight || window.innerHeight;
    if (this.cv.width !== Math.round(w * dpr)) { this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
    this.dpr = dpr;
  }
  center(s = this.state?.()) { if (s?.player) { this.view.cx = s.player.x; this.view.cz = s.player.z; } }
  zoomAt(px, py, f) {
    const v = this.view, ns = Math.max(0.05, Math.min(12, v.s * f));
    const wx = v.cx + (px - this.cv.clientWidth / 2) / v.s, wz = v.cz + (py - this.cv.clientHeight / 2) / v.s;
    v.s = ns; v.cx = wx - (px - this.cv.clientWidth / 2) / ns; v.cz = wz - (py - this.cv.clientHeight / 2) / ns;
  }

  _bg() {
    if (this.bg || !this.terrain) return this.bg;
    const c = document.createElement("canvas"); c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N), H = new Float32Array(N * N), t = this.terrain;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = t.height((i + 0.5) * CELL - HALF, (j + 0.5) * CELL - HALF);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = H[j * N + i], hx = H[j * N + Math.min(N - 1, i + 1)] - h, hz = H[Math.min(N - 1, j + 1) * N + i] - h;
      const shade = 1 + Math.max(-0.35, Math.min(0.35, (-hx - hz) * 0.03)), k = (j * N + i) * 4;
      // round 18: region colours (red rock, salt, marsh, snow, ice) and water
      const [r, g2, b] = t.bio ? t.bio.mapRGB((i + 0.5) * CELL - HALF, (j + 0.5) * CELL - HALF, h, Math.hypot(hx, hz) / CELL) : [0.3, 0.35, 0.28];
      img.data[k] = Math.min(255, r * 235 * shade); img.data[k + 1] = Math.min(255, g2 * 235 * shade); img.data[k + 2] = Math.min(255, b * 235 * shade); img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (this.bg = c);
  }
  _fogCanvas() {
    if (this._fogImg) return this._fogImg;
    const c = this._fogC || (this._fogC = document.createElement("canvas")); c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const k = i * 4; img.data[k] = 12; img.data[k + 1] = 10; img.data[k + 2] = 8; img.data[k + 3] = this.fog[i] ? 0 : 238; }
    g.putImageData(img, 0, 0);
    return (this._fogImg = c);
  }

  draw() {
    if (!this.isOpen) return;
    const s = this.state?.(); if (!s) return;
    this.resize();
    const ctx = this.ctx, dpr = this.dpr, W = this.cv.clientWidth, Hh = this.cv.clientHeight, v = this.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0c0a08"; ctx.fillRect(0, 0, W, Hh);
    const X = (x) => W / 2 + (x - v.cx) * v.s, Y = (z) => Hh / 2 + (z - v.cz) * v.s;
    const label = (txt, x, y, col = "#f6e2b0", size = 13) => {
      ctx.font = `${size}px Georgia, serif`; ctx.textAlign = "left";
      const w = ctx.measureText(txt).width; let tx = x + 8; if (tx + w > W - 6) tx = x - 8 - w;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.strokeText(txt, tx, y + 4); ctx.fillStyle = col; ctx.fillText(txt, tx, y + 4);
    };
    const title = this.el.querySelector(".wm-title"), legend = this.el.querySelector(".wm-legend");
    if (s.mode === "overworld") {
      title.textContent = s.title || "The Hills";
      const bg = this._bg();
      ctx.imageSmoothingEnabled = true;
      if (bg) ctx.drawImage(bg, X(-HALF), Y(-HALF), N * CELL * v.s, N * CELL * v.s);
      ctx.drawImage(this._fogCanvas(), X(-HALF), Y(-HALF), N * CELL * v.s, N * CELL * v.s);
      if (F.water && this.terrain?.bio) { // round 18: rivers
        ctx.strokeStyle = "rgba(110,190,230,0.85)"; ctx.lineWidth = Math.max(1.5, 5 * v.s);
        for (const r of this.terrain.bio.rivers) { ctx.lineWidth = Math.max(r.creek ? 1 : 1.5, (r.creek ? 2.5 : 5) * v.s); ctx.beginPath(); let on = false; for (const p of r.pts) { if (!this.seen(p.x, p.z)) { on = false; continue; } on ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)); on = true; } ctx.stroke(); } // only what you've explored
      }
      if (s.stream && F.water) { ctx.strokeStyle = "rgba(110,190,220,0.8)"; ctx.lineWidth = 2; ctx.beginPath(); s.stream.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)))); ctx.stroke(); }
      // trail
      if (this.trail.length > 1 && F.trail) {
        ctx.strokeStyle = "rgba(255, 214, 140, 0.75)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath();
        let prev = null;
        for (const p of this.trail) { const x = X(p[0]), y = Y(p[1]); if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 60) ctx.lineTo(x, y); else ctx.moveTo(x, y); prev = p; }
        ctx.stroke(); ctx.setLineDash([]);
      }
      for (const t of F.towns ? s.towns || [] : []) {
        if (!this.seen(t.x, t.z) && !t.known) continue;
        ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(X(t.x), Y(t.z), t.kind === "city" ? 7 : t.kind === "village" ? 5.5 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 1.5; ctx.stroke();
        if (F.labels) label(t.name, X(t.x), Y(t.z), "#ffe3a8", t.kind === "city" ? 14 : 12);
      }
      for (const e of F.caves ? s.entrances || [] : []) {
        ctx.fillStyle = e.cave === "carlsbad" ? "#ffcf6a" : "#e8e0d0";
        ctx.beginPath(); ctx.arc(X(e.x), Y(e.z), 5, Math.PI, 0); ctx.closePath(); ctx.fill();
        if (F.labels) label(e.name, X(e.x), Y(e.z), "#e8e0d0", 11);
      }
      for (const m of F.places ? s.marks || [] : []) { ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(X(m.x), Y(m.z), 4.5, 0, Math.PI * 2); ctx.fill(); if (m.label) label(m.label, X(m.x), Y(m.z), m.color, 12); }
      for (const b of s.boats || []) { // round 19: boats you've seen (yours always)
        if (!b.mine && (!F.boats || !this.seen(b.x, b.z))) continue;
        const x = X(b.x), y = Y(b.z), L = b.kind === "umiak" ? 7 : b.kind === "raft" ? 4.5 : 5.5;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-b.yaw);
        ctx.fillStyle = b.mine ? "#ffe0a0" : "#c8955a"; ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(0, 0, b.kind === "raft" ? 3.2 : 2.4, L, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        if (b.mine && !b.riding && F.labels) label("Your boat", x, y, "#ffe0a0", 11);
      }
      if (s.beacon) { // round 23: your beacon
        const x = X(s.beacon.x), y = Y(s.beacon.z);
        ctx.strokeStyle = "#7ff6ff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22); ctx.stroke();
        ctx.fillStyle = "#7ff6ff"; ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x + 6, y - 22); ctx.lineTo(x, y - 14); ctx.lineTo(x - 6, y - 22); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        label(`Beacon · ${s.beacon.dist}`, x, y - 22, "#aaf8ff", 12);
      }
      if (s.find) { // round 24b: the Find target (green), clamped to the edge when off the view
        const fx = X(s.find.x), fy = Y(s.find.z), inV = fx > 10 && fy > 60 && fx < W - 10 && fy < Hh - 40;
        const x = Math.max(16, Math.min(W - 16, fx)), y = Math.max(70, Math.min(Hh - 50, fy)), k = (performance.now() / 1100) % 1;
        ctx.strokeStyle = `rgba(182, 255, 90, ${1 - k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 7 + k * 22, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#b6ff5a"; ctx.strokeStyle = "#0e1a04"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        label(`🔍 ${s.find.label} · ${s.find.dist}${inV ? "" : " ➚"}`, x, y - 16, "#d4ff9a", 12);
      }
      if (this.sel) { const x = X(this.sel.x), y = Y(this.sel.z); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.moveTo(x - 14, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 14); ctx.stroke(); }
      for (const n of F.people ? s.npcs || [] : []) { if (!n.mark) continue; ctx.font = "bold 16px Georgia, serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(n.mark, X(n.x), Y(n.z) - 6); ctx.fillStyle = n.mark === "?" ? "#9fe3a8" : "#ffd36a"; ctx.fillText(n.mark, X(n.x), Y(n.z) - 6); }
      legend.innerHTML = `<span class="lg-t">┄ your trail</span><span>● town</span><span>◓ cave</span><span style="color:#c8955a">⬮ boat</span><span style="color:#ffd36a">! quest</span><span style="color:#ff9a5a">◆ tracked</span><span style="color:#7ff6ff">◆ beacon</span><span style="color:#b6ff5a">● find</span><span class="lg-tip">Tap the map: set a beacon / fast travel</span>`;
    } else {
      title.textContent = s.title || "Cave";
      ctx.strokeStyle = "rgba(196,174,140,0.75)"; ctx.lineCap = "round";
      for (const l of s.legs || []) { ctx.lineWidth = Math.max(2, l.w * v.s); ctx.beginPath(); ctx.moveTo(X(l.ax), Y(l.az)); ctx.lineTo(X(l.bx), Y(l.bz)); ctx.stroke(); }
      if (s.entrance) { ctx.fillStyle = "#8fd0a8"; ctx.beginPath(); ctx.arc(X(s.entrance.x), Y(s.entrance.z), 6, 0, Math.PI * 2); ctx.fill(); label("Way out", X(s.entrance.x), Y(s.entrance.z), "#8fd0a8"); }
      legend.innerHTML = `<span>Explored passages only</span><span style="color:#8fd0a8">● way out</span>`;
    }
    if (s.hint) { // round 17: pulsing hint marker
      const x = X(s.hint.x), y = Y(s.hint.z), k = (performance.now() / 900) % 1;
      ctx.strokeStyle = `rgba(255, 227, 106, ${1 - k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 8 + k * 30, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ffe36a"; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#1a0e04"; ctx.lineWidth = 2; ctx.stroke();
      label("💡 " + s.hint.label, x, y - 18, "#ffe36a", 14);
    }
    if (s.target && F.quest && !(s.hint && Math.hypot(s.hint.x - s.target.x, s.hint.z - s.target.z) < 3)) {
      const x = X(s.target.x), y = Y(s.target.z), inV = x > 8 && y > 50 && x < W - 8 && y < Hh - 30;
      const cx2 = Math.max(14, Math.min(W - 14, x)), cy2 = Math.max(60, Math.min(Hh - 40, y));
      ctx.fillStyle = "#ff9a5a"; ctx.strokeStyle = "#1a0e04"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx2, cy2 - 9); ctx.lineTo(cx2 + 7, cy2); ctx.lineTo(cx2, cy2 + 9); ctx.lineTo(cx2 - 7, cy2); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (inV) label(s.target.label, x, y - 16, "#ffb07a", 12);
    }
    if (s.player) {
      ctx.save(); ctx.translate(X(s.player.x), Y(s.player.z)); ctx.rotate(-s.player.yaw);
      ctx.fillStyle = "#9fe3a8"; ctx.strokeStyle = "#0a1a0c"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // scale bar
    const m = [10, 25, 50, 100, 250, 500, 1000].find((q) => q * v.s > 60) || 1000;
    ctx.fillStyle = "#f6e2b0"; ctx.fillRect(14, Hh - 58, m * v.s, 3); ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.fillText(m >= 1000 ? "1 km" : m + " m", 14, Hh - 64);
  }
}
