/**
 * Round 28a: a terrain-map look for the map and minimap (like a printed / Google terrain map):
 * pale elevation tints (green lowlands, tan hills, grey rock, white peaks) with a hint of the
 * region colour, NW hillshade, contour lines (darker index lines), flat light-blue water.
 * Heights are sampled on a coarse grid once and bilinearly upsampled per pixel (fast on phones).
 */
const TINT = [[-30, [196, 222, 186]], [5, [206, 228, 190]], [35, [222, 233, 198]], [70, [236, 232, 204]], [105, [230, 218, 190]], [140, [218, 206, 186]], [175, [210, 206, 200]], [210, [234, 234, 234]], [260, [252, 252, 252]]];
export const WATER = [170, 211, 223];
export const MAPSTYLE = { contour: [110, 92, 70], halo: "rgba(255,255,255,0.92)", text: "#2f2f2f", road: "#ffffff", roadCase: "rgba(150,140,125,0.9)", river: "rgba(120,180,225,0.95)", player: "#4285f4" };
function tint(h, out) {
  if (h <= TINT[0][0]) { out[0] = TINT[0][1][0]; out[1] = TINT[0][1][1]; out[2] = TINT[0][1][2]; return; }
  for (let i = 0; i < TINT.length - 1; i++) {
    const [h0, c0] = TINT[i], [h1, c1] = TINT[i + 1];
    if (h <= h1) { const f = (h - h0) / (h1 - h0); out[0] = c0[0] + (c1[0] - c0[0]) * f; out[1] = c0[1] + (c1[1] - c0[1]) * f; out[2] = c0[2] + (c1[2] - c0[2]) * f; return; }
  }
  const c = TINT[TINT.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

/** Sample the terrain on a gw x gh grid (spacing cell m, starting at x0, z0, cell centres).
 *  Returns { H, Wt (0 land / 1 water), B (biome rgb 0..1, or null) }. */
export function sampleGrid(t, x0, z0, gw, gh, cell, { biome = true } = {}) {
  const n = gw * gh, H = new Float32Array(n), Wt = new Uint8Array(n), B = biome && t.bio ? new Float32Array(n * 3) : null;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, k = j * gw + i, h = (H[k] = t.height(x, z));
    if (t.bio) {
      const w = t.bio.weights(x, z), wa = t.bio.waterAt(x, z, w, h);
      if (wa && wa.kind !== "river" && wa.y > h - 0.1) Wt[k] = 1;
      if (B) { const c = t.bio.mapRGB(x, z, h, 0); B[k * 3] = c[0]; B[k * 3 + 1] = c[1]; B[k * 3 + 2] = c[2]; }
    }
  }
  return { H, Wt, B, gw, gh, cell, x0, z0 };
}

/** Paint a sampled grid into an ImageData of W x Hp pixels. o: { interval, index, exag, fogFn(i, j)->0..1 } */
export function paintGrid(G, W, Hp, o = {}) {
  const { H, Wt, B, gw, gh } = G, I = o.interval || 20, IDX = o.index || 100, ex = o.exag || 1.6;
  const mpp = (gw * G.cell) / W; // metres per pixel
  const px = new Float32Array(W * Hp), wpx = new Float32Array(W * Hp), bpx = B ? new Float32Array(W * Hp * 3) : null;
  for (let y = 0; y < Hp; y++) {
    let gy = ((y + 0.5) / Hp) * gh - 0.5; gy = Math.max(0, Math.min(gh - 1.001, gy)); const j = Math.floor(gy), fy = gy - j;
    for (let x = 0; x < W; x++) {
      let gx = ((x + 0.5) / W) * gw - 0.5; gx = Math.max(0, Math.min(gw - 1.001, gx)); const i = Math.floor(gx), fx = gx - i;
      const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy, k = y * W + x;
      px[k] = H[a] * w00 + H[b] * w10 + H[c] * w01 + H[d] * w11;
      wpx[k] = Wt[a] * w00 + Wt[b] * w10 + Wt[c] * w01 + Wt[d] * w11;
      if (bpx) for (let q = 0; q < 3; q++) bpx[k * 3 + q] = B[a * 3 + q] * w00 + B[b * 3 + q] * w10 + B[c * 3 + q] * w01 + B[d * 3 + q] * w11;
    }
  }
  const img = new ImageData(W, Hp), D = img.data, col = [0, 0, 0];
  const Lx = -0.55, Ly = -0.55, Lz = 0.63, flat = Lz; // light from the north-west
  for (let y = 0; y < Hp; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x, h = px[k];
    const hl = px[y * W + Math.max(0, x - 1)], hr = px[y * W + Math.min(W - 1, x + 1)], hu = px[Math.max(0, y - 1) * W + x], hd = px[Math.min(Hp - 1, y + 1) * W + x];
    const dx = ((hr - hl) / (2 * mpp)) * ex, dy = ((hd - hu) / (2 * mpp)) * ex, nl = Math.hypot(dx, dy, 1);
    const sh = (-dx * Lx - dy * Ly + Lz) / nl;
    let r, g, b;
    if (wpx[k] > 0.5) { r = WATER[0]; g = WATER[1]; b = WATER[2]; }
    else {
      tint(h, col);
      if (bpx) { const m = 0.3; r = col[0] * (1 - m) + (bpx[k * 3] * 150 + 105) * m; g = col[1] * (1 - m) + (bpx[k * 3 + 1] * 150 + 105) * m; b = col[2] * (1 - m) + (bpx[k * 3 + 2] * 150 + 105) * m; }
      else { r = col[0]; g = col[1]; b = col[2]; }
      const kk = Math.max(0.6, Math.min(1.18, 1 + (sh - flat) * 1.25)); r *= kk; g *= kk; b *= kk;
      // contours: the elevation band changes between this pixel and its right / lower neighbour
      const c0 = Math.floor(h / I);
      if (c0 !== Math.floor(hr / I) || c0 !== Math.floor(hd / I)) {
        const idx = Math.floor(h / IDX) !== Math.floor(hr / IDX) || Math.floor(h / IDX) !== Math.floor(hd / IDX);
        const a = idx ? 0.55 : 0.28, C = MAPSTYLE.contour; r = r * (1 - a) + C[0] * a; g = g * (1 - a) + C[1] * a; b = b * (1 - a) + C[2] * a;
      }
      // a soft shore line
      if (wpx[k] > 0.2) { r = r * 0.6 + WATER[0] * 0.4; g = g * 0.6 + WATER[1] * 0.4; b = b * 0.6 + WATER[2] * 0.4; }
    }
    const q = k * 4; D[q] = Math.min(255, r); D[q + 1] = Math.min(255, g); D[q + 2] = Math.min(255, b); D[q + 3] = 255;
  }
  return img;
}
