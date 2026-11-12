/**
 * Round 24: animated cave-painting panels for the cutscenes (2D canvas, real time).
 * Ochre, charcoal and blood on a lumpy rock wall; figures drawn with a shaky hand that come
 * alive (running hunters, animals, a mouth that opens, faces that appear one by one), on
 * parallax layers that drift, under a flickering torch that wanders over the wall.
 */
import { mulberry32 } from "../rng.js";

const OCHRE = "#b4541f", RED = "#8c1a10", BLOOD = "#a3120c", CHAR = "#241710", WHITE = "#e9dcc0";
let rock = null, rockW = 0, rockH = 0;

/** A rock-wall texture: warm limestone with blotches, cracks and grain (made once per size). */
function rockTex(W, H) {
  if (rock && rockW === W && rockH === H) return rock;
  const c = document.createElement("canvas"); c.width = Math.ceil(W * 1.2); c.height = Math.ceil(H * 1.2);
  const g = c.getContext("2d"), r = mulberry32(77);
  const grd = g.createLinearGradient(0, 0, c.width, c.height); grd.addColorStop(0, "#c9a678"); grd.addColorStop(0.5, "#b8915f"); grd.addColorStop(1, "#9c7748");
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 260; i++) { // blotches
    const x = r() * c.width, y = r() * c.height, rad = 20 + r() * 140, a = 0.04 + r() * 0.08;
    const gg = g.createRadialGradient(x, y, 0, x, y, rad); const dark = r() < 0.55;
    gg.addColorStop(0, dark ? `rgba(70,45,25,${a})` : `rgba(240,220,180,${a})`); gg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.strokeStyle = "rgba(50,32,18,0.35)"; g.lineWidth = 1.2; // cracks
  for (let i = 0; i < 26; i++) { let x = r() * c.width, y = r() * c.height; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (r() - 0.5) * 60; y += (r() - 0.3) * 40; g.lineTo(x, y); } g.stroke(); }
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data; // grain
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
  g.putImageData(img, 0, 0);
  rock = c; rockW = W; rockH = H; return c;
}

// --- shaky-hand drawing helpers (s = scale, px per unit) ---
function wob(t, k) { return Math.sin(t * 1.7 + k * 3.1) * 0.6 + Math.sin(t * 2.9 + k) * 0.4; }
function stroke(g, pts, col, w, alpha = 0.9) { g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.globalAlpha = 1; }
function blob(g, x, y, rx, ry, col, alpha = 0.85, rot = 0) { g.globalAlpha = alpha; g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }

/** A running stick hunter (facing dir) with a spear; phase drives the legs. */
function hunter(g, x, y, s, ph, dir = 1, col = CHAR, spear = true) {
  const L = Math.sin(ph) * 0.55, L2 = Math.sin(ph + Math.PI) * 0.55, bob = Math.abs(Math.sin(ph)) * 0.08 * s;
  y -= bob;
  blob(g, x + 0.05 * s * dir, y - 1.55 * s, 0.17 * s, 0.19 * s, col);
  stroke(g, [[x, y - 1.35 * s], [x + 0.12 * s * dir, y - 0.7 * s]], col, 0.13 * s);
  stroke(g, [[x + 0.12 * s * dir, y - 0.7 * s], [x + (0.12 + Math.sin(L) * 0.5) * s * dir, y - 0.32 * s], [x + (0.1 + Math.sin(L) * 0.75) * s * dir, y]], col, 0.11 * s);
  stroke(g, [[x + 0.12 * s * dir, y - 0.7 * s], [x + (0.12 + Math.sin(L2) * 0.5) * s * dir, y - 0.32 * s], [x + (0.1 + Math.sin(L2) * 0.75) * s * dir, y]], col, 0.11 * s);
  stroke(g, [[x + 0.02 * s * dir, y - 1.2 * s], [x + 0.45 * s * dir, y - 1.05 * s + Math.sin(ph) * 0.06 * s]], col, 0.09 * s);
  if (spear) stroke(g, [[x - 0.4 * s * dir, y - 1.35 * s], [x + 1.05 * s * dir, y - 1.0 * s]], col, 0.05 * s);
}
/** A bison / deer / horse in profile, legs galloping. */
function beast(g, x, y, s, ph, dir = -1, kind = "bison", col = RED, alpha = 0.85) {
  const hump = kind === "bison" ? 0.45 : 0.15, len = kind === "deer" ? 1.5 : 1.9;
  g.globalAlpha = alpha; g.fillStyle = col; g.beginPath();
  g.moveTo(x - len * 0.5 * s * dir, y - 0.7 * s);
  g.quadraticCurveTo(x - len * 0.2 * s * dir, y - (1.25 + hump) * s, x + len * 0.35 * s * dir, y - 1.1 * s);
  g.quadraticCurveTo(x + len * 0.62 * s * dir, y - 1.05 * s, x + len * 0.72 * s * dir, y - 0.62 * s); // head
  g.lineTo(x + len * 0.5 * s * dir, y - 0.5 * s);
  g.quadraticCurveTo(x, y - 0.25 * s, x - len * 0.5 * s * dir, y - 0.45 * s);
  g.closePath(); g.fill(); g.globalAlpha = 1;
  for (let k = 0; k < 4; k++) { const lx = x + (k < 2 ? 0.35 : -0.4) * len * s * dir + (k % 2) * 0.12 * s, sw = Math.sin(ph + k * 1.6) * 0.32; stroke(g, [[lx, y - 0.5 * s], [lx + sw * s * dir, y - 0.22 * s], [lx + sw * 1.4 * s * dir, y + 0.02 * s]], col, 0.1 * s, alpha); }
  if (kind === "deer") for (const o of [0, 0.12]) stroke(g, [[x + (len * 0.62 + o) * s * dir, y - 1.1 * s], [x + (len * 0.55 + o) * s * dir, y - 1.6 * s], [x + (len * 0.7 + o) * s * dir, y - 1.85 * s]], CHAR, 0.05 * s, alpha);
  if (kind === "bison") stroke(g, [[x + len * 0.6 * s * dir, y - 1.05 * s], [x + len * 0.72 * s * dir, y - 1.32 * s]], WHITE, 0.05 * s, alpha);
}
function hand(g, x, y, s, col = RED, alpha = 0.6, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); blob(g, 0, 0, 0.33 * s, 0.4 * s, col, alpha);
  for (let k = 0; k < 5; k++) { const a = -1.1 + k * 0.5; g.save(); g.rotate(a); blob(g, 0, -0.62 * s, 0.08 * s, 0.26 * s, col, alpha); g.restore(); }
  g.restore();
}
function spiral(g, x, y, s, upto, col = BLOOD, w = 0.12) {
  const pts = []; const n = Math.floor(120 * Math.max(0, Math.min(1, upto)));
  for (let i = 0; i <= n; i++) { const a = i * 0.16, r = (0.05 + i * 0.012) * s; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  if (pts.length > 1) stroke(g, pts, col, w * s, 0.85);
}
function face(g, x, y, s, a = 1, scream = 0.5) {
  blob(g, x, y, 0.42 * s, 0.52 * s, "#caa27a", 0.9 * a); stroke(g, [[x - 0.42 * s, y], [x - 0.5 * s, y + 0.05 * s]], CHAR, 0.04 * s, a);
  blob(g, x - 0.15 * s, y - 0.12 * s, 0.07 * s, 0.05 * s, CHAR, a); blob(g, x + 0.15 * s, y - 0.12 * s, 0.07 * s, 0.05 * s, CHAR, a);
  blob(g, x, y + 0.22 * s, 0.1 * s, (0.06 + scream * 0.12) * s, CHAR, a);
  for (let k = -3; k <= 3; k++) stroke(g, [[x + k * 0.12 * s, y + 0.5 * s], [x + k * 0.12 * s + 0.03 * s, y + 0.58 * s]], CHAR, 0.02 * s, a * 0.8); // stitches
}
function hut(g, x, y, s, col = OCHRE) { stroke(g, [[x - 0.8 * s, y], [x, y - 1.4 * s], [x + 0.8 * s, y]], col, 0.12 * s); stroke(g, [[x - 0.2 * s, y - 1.6 * s], [x, y - 1.35 * s], [x + 0.2 * s, y - 1.6 * s]], col, 0.08 * s); }
function fire(g, x, y, s, t) { for (let k = 0; k < 4; k++) { const h = (0.6 + 0.3 * Math.sin(t * 9 + k * 2)) * s; blob(g, x + (k - 1.5) * 0.12 * s, y - h * 0.5, 0.12 * s, h * 0.5, k % 2 ? "#e08a2a" : "#c4381a", 0.8); } }

/** Draw panel `kind` at time t (s) into g (W x H CSS px). k: 0..1 progress through the scene. */
export function drawPanel(g, kind, t, W, H, k = 0) {
  const R = rockTex(W, H), U = Math.min(W, H) / 7; // one "unit" ~ a man's height / 1.8
  const pan = Math.sin(t * 0.12) * 0.04 * W, panY = Math.cos(t * 0.09) * 0.02 * H;
  g.save(); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.drawImage(R, -0.1 * W + pan * 0.4, -0.1 * H + panY * 0.4, R.width, R.height);
  // layers: back (x0.5 parallax, faded), mid (x1), front (x1.6)
  const T0 = g.getTransform(), sx = T0.a, sy = T0.d; // keep the device-pixel scale the player set
  const base = () => g.setTransform(sx, 0, 0, sy, T0.e, T0.f);
  const L = (m) => { g.setTransform(sx, 0, 0, sy, T0.e + pan * m * sx, T0.f + panY * m * sy); };
  const cx = W / 2, gy = H * 0.68;
  if (kind === "hunt") {
    L(0.5); for (let i = 0; i < 5; i++) beast(g, ((i * 0.27 * W - t * 18) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2, gy - U * 1.8 - (i % 2) * U * 0.5, U * 0.55, t * 6 + i, -1, i % 2 ? "deer" : "bison", OCHRE, 0.35);
    L(1); for (let i = 0; i < 3; i++) beast(g, W * (0.15 + i * 0.22) - ((t * 34) % (W * 0.4)) + W * 0.1, gy - (i % 2) * U * 0.25, U * 0.9, t * 9 + i * 2, -1, i === 1 ? "deer" : "bison", RED);
    for (let i = 0; i < 4; i++) hunter(g, W * (0.62 + i * 0.09) - ((t * 34) % (W * 0.4)) + W * 0.1, gy + U * 0.15 + (i % 2) * U * 0.1, U * 0.8, t * 10 + i * 1.3, -1);
    L(1.6); hand(g, W * 0.1, H * 0.2, U * 0.7, RED, 0.45, -0.2); hand(g, W * 0.88, H * 0.26, U * 0.6, OCHRE, 0.4, 0.3);
  } else if (kind === "mouth" || kind === "throat") {
    const open = kind === "throat" ? 0.7 + 0.3 * Math.sin(t * 0.7) : Math.min(1, 0.15 + k * 1.1), mx = cx, my = H * 0.42, mw = W * 0.42, mh = H * 0.3 * open;
    L(0.6);
    g.globalAlpha = 0.95; g.fillStyle = "#120806"; g.beginPath(); g.ellipse(mx, my, mw, Math.max(4, mh), 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    stroke(g, Array.from({ length: 64 }, (_, i) => { const a = (i / 63) * Math.PI * 2; return [mx + Math.cos(a) * (mw + 6), my + Math.sin(a) * (Math.max(4, mh) + 6)]; }), RED, U * 0.12);
    for (let i = 0; i < 26; i++) { // teeth
      const a = (i / 26) * Math.PI * 2, tx = mx + Math.cos(a) * mw, ty = my + Math.sin(a) * Math.max(4, mh), inx = mx + Math.cos(a) * mw * 0.82, iny = my + Math.sin(a) * Math.max(3, mh) * 0.72;
      g.fillStyle = WHITE; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(tx + Math.sin(a) * 9, ty - Math.cos(a) * 9); g.lineTo(inx, iny); g.lineTo(tx - Math.sin(a) * 9, ty + Math.cos(a) * 9); g.fill(); g.globalAlpha = 1;
    }
    if (kind === "throat") for (let r = 1; r < 6; r++) { const q = ((t * 0.25 + r / 6) % 1); stroke(g, Array.from({ length: 40 }, (_, i) => { const a = (i / 39) * Math.PI * 2; return [mx + Math.cos(a) * mw * q, my + Math.sin(a) * mh * q]; }), "#3a0d08", 3, 0.7); }
    L(1); for (let i = 0; i < 6; i++) { const q = ((t * 0.08 + i / 6) % 1); hunter(g, mx + (i - 2.5) * W * 0.12 * (1 - q), my + mh * 0.2 + (1 - q) * H * 0.25, U * 0.5 * (1 - q * 0.8), t * 3 + i, i % 2 ? 1 : -1, CHAR, false); } // pulled in
    L(1.8); // Kra in the foreground, torch raised
    const kx = W * 0.2, ky = H * 0.98; g.fillStyle = "#050302"; g.beginPath(); g.ellipse(kx, ky - U * 1.4, U * 0.55, U * 1.3, 0, 0, Math.PI * 2); g.fill(); blob(g, kx + U * 0.05, ky - U * 2.85, U * 0.3, U * 0.34, "#050302", 1);
    stroke(g, [[kx + U * 0.35, ky - U * 2.1], [kx + U * 0.75, ky - U * 3.0]], "#050302", U * 0.16, 1); fire(g, kx + U * 0.8, ky - U * 3.05, U * 0.5, t);
  } else if (kind === "faces") {
    L(0.7); const n = Math.min(9, Math.floor(1 + k * 10)), bx = cx, by = H * 0.6;
    g.fillStyle = CHAR; g.globalAlpha = 0.8; g.beginPath(); g.ellipse(bx, by, U * 1.0, U * 1.9, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; blob(g, bx, by - U * 2.2, U * 0.45, U * 0.5, CHAR, 0.85);
    for (let i = 0; i < n; i++) { const a = i * 2.4, rr = U * (0.4 + (i % 3) * 0.45); face(g, bx + Math.cos(a) * rr * 0.9, by + Math.sin(a) * rr * 1.3 - U * 0.3, U * 0.55, i === n - 1 ? Math.min(1, (k * 10) % 1 + 0.3) : 1, 0.4 + 0.4 * Math.sin(t * 2 + i)); }
    L(1.5); hand(g, W * 0.12, H * 0.3, U * 0.6, BLOOD, 0.5); hand(g, W * 0.85, H * 0.7, U * 0.6, BLOOD, 0.45, 0.6);
  } else if (kind === "blood" || kind === "glyph") {
    L(0.8); spiral(g, cx, H * 0.45, U * 2.8, k * 1.3); for (let i = 0; i < 7; i++) { const dx = cx + (i - 3) * U * 0.35, len = Math.min(1, Math.max(0, k * 2 - i * 0.1)) * U * 1.4; stroke(g, [[dx, H * 0.45 + U * 1.4], [dx + 2, H * 0.45 + U * 1.4 + len]], BLOOD, U * 0.06, 0.7); }
    L(1.3); for (let i = 0; i < 8; i++) if (k * 9 > i) hand(g, W * (0.1 + (i % 4) * 0.27), H * (i < 4 ? 0.2 : 0.8), U * 0.6, i % 3 ? BLOOD : RED, 0.55, (i - 4) * 0.2);
  } else if (kind === "kill") {
    const q = Math.min(1, k * 1.6), fall = Math.max(0, (k - 0.55) / 0.45);
    L(1); g.save(); g.translate(W * 0.62, gy); g.rotate(fall * 1.2); beast(g, 0, 0, U * 1.1, fall > 0 ? 0 : t * 8, -1, "deer", RED); g.restore();
    hunter(g, W * 0.3, gy + U * 0.1, U * 0.95, fall > 0 ? 0 : t * 6, 1, CHAR, q < 0.5);
    if (q >= 0.5) { const sx = W * 0.32 + (W * 0.28) * Math.min(1, (q - 0.5) * 4); stroke(g, [[sx - U, gy - U * 1.2], [sx, gy - U * 0.95]], CHAR, U * 0.06); }
    if (fall > 0) for (let i = 0; i < 6; i++) blob(g, W * 0.62 + (i - 3) * U * 0.2, gy + U * 0.1 + fall * U * 0.2, U * 0.12 * fall, U * 0.05, BLOOD, 0.7);
    L(1.5); spiral(g, W * 0.15, H * 0.25, U * 0.9, 1, OCHRE, 0.09);
  } else if (kind === "people" || kind === "town") {
    L(0.5); for (let i = 0; i < 6; i++) hut(g, W * (0.1 + i * 0.16), gy - U * 0.9, U * 0.7, OCHRE);
    L(1); fire(g, cx, gy, U * 0.8, t); for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + t * 0.25; hunter(g, cx + Math.cos(a) * U * 2.4, gy + Math.sin(a) * U * 0.5 + U * 0.3, U * 0.7, t * 4 + i, Math.cos(a) > 0 ? -1 : 1, CHAR, false); }
    for (let i = 0; i < 5; i++) { const sy = ((t * 18 + i * 40) % (H * 0.5)); blob(g, cx + Math.sin(t + i) * 10, gy - U - sy, U * 0.2 + sy * 0.05, U * 0.12 + sy * 0.03, "#6b5a48", 0.25); }
  } else if (kind === "age") {
    L(1); const n = 5, shown = Math.min(n, Math.floor(1 + k * n));
    const icons = [(x, y) => hut(g, x, y, U * 0.7, OCHRE), (x, y) => { for (let j = 0; j < 3; j++) stroke(g, [[x - U * 0.6, y - j * U * 0.3], [x + U * 0.6, y - j * U * 0.3 - U * 0.1]], "#7a4a22", U * 0.18); }, (x, y) => { blob(g, x, y - U * 0.4, U * 0.6, U * 0.4, "#8a8070"); blob(g, x - U * 0.2, y - U * 0.9, U * 0.4, U * 0.3, "#9a9080"); },
      (x, y) => { blob(g, x, y - U * 0.5, U * 0.25, U * 0.55, "#c07a30"); stroke(g, [[x, y - U * 1.1], [x, y - U * 1.6]], "#c07a30", U * 0.1); }, (x, y) => { stroke(g, [[x - U * 0.1, y], [x + U * 0.1, y - U * 1.4]], "#4a4a50", U * 0.14); stroke(g, [[x - U * 0.4, y - U * 0.35], [x + U * 0.4, y - U * 0.45]], "#4a4a50", U * 0.1); }];
    for (let i = 0; i < shown; i++) { const x = W * (0.14 + i * 0.18), y = gy + Math.sin(t * 1.5 + i) * 2; icons[i](x, y); if (i < shown - 1) stroke(g, [[x + U * 0.7, y - U * 0.5], [x + W * 0.18 - U * 0.7, y - U * 0.5]], CHAR, U * 0.05, 0.6); }
    L(1.6); hunter(g, W * 0.14 + (W * 0.18) * Math.min(n - 1, k * n - 0.5), gy + U * 0.6, U * 0.6, t * 6, 1, CHAR, false);
  } else if (kind === "trip") {
    base();
    for (let r = 0; r < 9; r++) { const hue = (t * 40 + r * 40) % 360; spiral(g, cx + Math.sin(t * 0.5 + r) * 20, H * 0.45 + Math.cos(t * 0.4 + r) * 14, U * (1.2 + r * 0.5), 1, `hsl(${hue},70%,45%)`, 0.05); }
    L(1.4); for (let i = 0; i < 5; i++) { const x = W * (0.12 + i * 0.19), y = H * 0.86; stroke(g, [[x, y], [x, y - U * 0.5]], WHITE, U * 0.08); blob(g, x, y - U * 0.55, U * 0.28, U * 0.16, `hsl(${(t * 60 + i * 70) % 360},80%,55%)`, 0.9); }
  } else if (kind === "river") {
    L(0.6); for (let j = 0; j < 6; j++) stroke(g, Array.from({ length: 40 }, (_, i) => [i * W / 39, H * (0.45 + j * 0.07) + Math.sin(i * 0.5 + t * 1.5 + j) * 8]), j % 2 ? "#3f5a6a" : CHAR, 3, 0.55);
    L(1); for (let i = 0; i < 3; i++) hunter(g, ((W * 0.2 + i * W * 0.15 + t * 22) % (W * 1.2)) - W * 0.1, H * 0.42, U * 0.7, t * 7 + i, 1);
    L(1.4); hut(g, W * 0.85, H * 0.42, U * 0.9, OCHRE); for (let i = 0; i < 3; i++) { const sy = ((t * 16 + i * 50) % (H * 0.35)); blob(g, W * 0.85, H * 0.28 - sy, U * 0.2 + sy * 0.05, U * 0.1 + sy * 0.03, "#6b5a48", 0.3); }
  }
  // torchlight: a warm pool that wanders and flickers, the rest falls into black
  base();
  const fl = 0.88 + 0.07 * Math.sin(t * 13) + 0.05 * Math.sin(t * 23.7), lx = cx + Math.sin(t * 0.31) * W * 0.18, ly = H * 0.45 + Math.cos(t * 0.23) * H * 0.08;
  const reveal = kind === "mouth" ? Math.min(1, 0.25 + k * 1.2) : Math.min(1, 0.5 + t * 0.25);
  const rad = Math.max(W, H) * 0.62 * fl * reveal;
  const vg = g.createRadialGradient(lx, ly, rad * 0.15, lx, ly, rad);
  vg.addColorStop(0, "rgba(255,170,80,0.10)"); vg.addColorStop(0.55, "rgba(30,12,4,0.25)"); vg.addColorStop(1, "rgba(0,0,0,0.96)");
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.restore();
}
export const PANELS = ["hunt", "mouth", "throat", "faces", "blood", "glyph", "kill", "people", "town", "age", "trip", "river"];
