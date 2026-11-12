/**
 * Round 18: regions. A biome map over the chunk-streamed world (large-scale noise + a north-south
 * climate gradient; north is -z). Southern Utah red rock and salt / sand desert to the south,
 * the familiar temperate forest and grassland around the start and the towns, marsh to the east,
 * alpine peaks and then tundra / taiga with glacier ice to the north (Alaska), and an ocean along
 * the west edge. Rivers run downhill from the high country to lakes or the sea; extra lakes sit in
 * low ground. Everything is a pure function of the seed, so chunks, collision, the maps and the
 * horizon all agree.
 *
 * Boats (round 19 hook): `water.bodies` lists every lake / river / the ocean, and
 * `navigable(x, z)` says whether a boat could float there.
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";

export const BIOMES = ["temperate", "red", "salt", "swamp", "alpine", "tundra"];
export const BIOME_NAMES = { temperate: "Temperate forest", red: "Red-rock canyons", salt: "Salt flats & dunes", swamp: "Marsh", alpine: "Alpine peaks", tundra: "Tundra & taiga", ocean: "Ocean coast" };
export const WORLD_HALF = 3200; // m (was 1400)
export const SEA = 0; // ocean surface height
export const SWAMP_LEVEL = 1.0;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function segInfo(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L));
  return { d: Math.hypot(ax + vx * t - px, az + vz * t - pz), t };
}

/** Mixes biome weights / heights / water into a Terrain (called from its constructor). */
export class Biomes {
  constructor(t, fbm2) {
    this.t = t; this.fbm = fbm2; this.s = t.s;
    this.rivers = []; this.lakes = []; this.grid = new Map(); this.G = 96;
  }

  /** Ocean coastline x at a given z (west edge). */
  coastX(z) { return -2050 + (this.fbm(z / 900, 3.7, 3, this.s + 91) - 0.5) * 700; }

  /** Biome weights (sum 1) + `sea` (0 land .. 1 open water) + `cd` (m east of the coast). */
  weights(x, z) {
    const f = this.fbm, s = this.s;
    const warp = (f(x / 700, z / 700, 2, s + 41) - 0.5) * 520;
    const north = -z + warp, south = z + warp * 0.8;
    const core = smooth(1050, 1400, Math.hypot(x, z)); // the start, the camp and the towns stay familiar
    const cold = smooth(1000, 1450, north) * core, polar = smooth(2000, 2450, north), hot = smooth(1000, 1450, south) * core;
    const redM = smooth(0.38, 0.52, f(x / 650, z / 650, 2, s + 53) + 0.06);
    const mild = (1 - cold) * (1 - hot);
    const swM = smooth(0.52, 0.62, f(x / 420, z / 420, 2, s + 61)) * smooth(950, 1300, x + warp * 0.6) * core;
    const w = {
      temperate: mild * (1 - swM), swamp: mild * swM,
      alpine: cold * (1 - polar), tundra: cold * polar,
      red: hot * redM, salt: hot * (1 - redM),
    };
    const cd = x - this.coastX(z);
    w.cd = cd; w.sea = 1 - smooth(-140, 40, cd);
    return w;
  }

  /** Dominant biome name at a point (ocean when offshore). */
  biomeAt(x, z) {
    const w = this.weights(x, z);
    if (w.sea > 0.6) return "ocean";
    let best = "temperate", bv = -1;
    for (const b of BIOMES) if (w[b] > bv) { bv = w[b]; best = b; }
    return best;
  }

  /** Raw land height for the blended biomes (before rivers / lakes / act 1 / towns). */
  land(x, z, temperateH, w = this.weights(x, z)) {
    const f = this.fbm, s = this.s;
    let h = w.temperate * temperateH;
    if (w.swamp > 0.001) h += w.swamp * (0.35 + (f(x / 45, z / 45, 2, s + 17) - 0.5) * 2.6 + (f(x / 200, z / 200, 2, s + 19) - 0.5) * 3);
    if (w.alpine > 0.001) {
      const r = 1 - Math.abs(f(x / 190, z / 190, 4, s + 23) * 2 - 1), big = f(x / 600, z / 600, 2, s + 29);
      h += w.alpine * (35 + 340 * Math.pow(r, 2.4) * smooth(0.3, 0.7, big) + 70 * r + (f(x / 40, z / 40, 2, s + 31) - 0.5) * 8);
    }
    if (w.tundra > 0.001) {
      const r = 1 - Math.abs(f(x / 260, z / 260, 3, s + 37) * 2 - 1);
      h += w.tundra * (12 + (f(x / 160, z / 160, 3, s + 39) - 0.5) * 40 + 110 * Math.pow(r, 3) + (f(x / 30, z / 30, 2, s + 43) - 0.5) * 3);
    }
    if (w.red > 0.001) h += w.red * this._redrock(x, z);
    if (w.salt > 0.001) {
      const dune = smooth(0.45, 0.6, f(x / 500, z / 500, 2, s + 47));
      const ripple = Math.abs(Math.sin(x / 34 + z / 90 + f(x / 120, z / 120, 2, s + 49) * 7));
      h += w.salt * (3 + (f(x / 300, z / 300, 2, s + 51) - 0.5) * 6 + dune * ripple * 7);
    }
    // the sea floor shelves down past the beach (a rocky shore in the cold north)
    if (w.cd < 260) {
      const beachH = lerp(2.2, 0.8, smooth(160, 0, w.cd));
      const k = smooth(260, 60, w.cd);
      h = lerp(h, Math.min(h, beachH + Math.max(0, w.cd) * 0.03 + (w.tundra + w.alpine) * 6), k);
      if (w.cd < 20) h = lerp(h, SEA - 2 - Math.min(26, -w.cd * 0.12), smooth(20, -40, w.cd));
    }
    return h;
  }

  /** Southern Utah: banded mesas and buttes stepping down into slot canyons. */
  _redrock(x, z) {
    const f = this.fbm, s = this.s;
    const n = f(x / 280, z / 280, 3, s + 61) * 1.2 + f(x / 90, z / 90, 2, s + 63) * 0.15;
    const v = n * 7, fl = Math.floor(v), fr = v - fl;
    const tv = fl + smooth(0.72, 0.93, fr); // flat benches, steep cliff bands
    let h = tv * 13 - 30;
    const c = Math.abs(f(x / 380, z / 380, 3, s + 71) - 0.5);
    h -= 34 * (1 - smooth(0.012, 0.05, c)); // winding canyons
    return h;
  }

  // ---------------------------------------------------------------- water network ----
  /** Plan rivers + lakes. `pre(x, z)` = height without water; `avoid` = [{x, z, r}]. */
  plan(pre, avoid) {
    const rng = mulberry32(this.t.seed ^ 0x51ae);
    const ok = (x, z, m = 0) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r + m);
    // rivers: sources high in the mountains / red rock, traced down the fall line
    const srcs = [];
    for (let k = 0; k < 1400 && srcs.length < 14; k++) {
      const x = (rng() * 2 - 1) * 2600, z = (rng() * 2 - 1) * 3000;
      const w = this.weights(x, z);
      if (w.sea > 0.1 || w.alpine + w.tundra + w.red < 0.6) continue;
      const h = pre(x, z);
      if (h < (w.red > 0.5 ? 25 : 90)) continue;
      if (srcs.some((q) => Math.hypot(q.x - x, q.z - z) < 480)) continue;
      srcs.push({ x, z });
    }
    // Route each river toward the sea (west) or a lower lake, picking the lowest ground in a fan
    // of headings each step (so it follows valleys), with a water level that only ever falls:
    // where the land rises again the channel is cut down through it as a gorge / canyon.
    const pendingLakes = [];
    for (const sp of srcs) {
      const h0 = pre(sp.x, sp.z);
      let T;
      if (sp.x < 900 || rng() < 0.5) { const tz = sp.z * 0.7 + (rng() - 0.5) * 700; T = { x: this.coastX(tz) - 120, z: tz, sea: true }; }
      else { const a = rng() * 6.28, d = 700 + rng() * 900; T = { x: Math.max(-2600, Math.min(2900, sp.x + Math.cos(a) * d)), z: Math.max(-2900, Math.min(2900, sp.z + Math.sin(a) * d)), sea: false }; }
      const pts = []; let x = sp.x, z = sp.z, lvl = h0 - 0.6, end = "pond", hd = Math.atan2(T.z - z, T.x - x);
      for (let i = 0; i < 520; i++) {
        const h = pre(x, z);
        lvl = Math.min(lvl, h - 0.6);
        pts.push({ x, z, y: lvl, w: Math.min(7, 2.4 + i * 0.025) });
        if (!ok(x, z, 40)) { end = "cut"; break; }
        if (this.weights(x, z).cd < -40) { end = "sea"; break; }
        const dT = Math.hypot(T.x - x, T.z - z);
        if (dT < 30) { end = T.sea ? "sea" : "pond"; break; }
        const want = Math.atan2(T.z - z, T.x - x);
        let best = null;
        for (let k = -4; k <= 4; k++) {
          const a = hd + k * 0.22;
          let da = Math.atan2(Math.sin(a - want), Math.cos(a - want));
          if (Math.abs(da) > 1.05) continue; // keep heading roughly toward the goal
          const nx = x + Math.cos(a) * 30, nz = z + Math.sin(a) * 30;
          let sc = pre(nx, nz) + Math.abs(da) * 6 + Math.abs(k) * 0.8;
          if (!ok(nx, nz, 40)) sc += 1e4;
          if (!best || sc < best.sc) best = { sc, a };
        }
        if (!best) { const da = Math.atan2(Math.sin(want - hd), Math.cos(want - hd)); best = { a: hd + Math.sign(da) * 0.3 }; }
        hd = best.a; x += Math.cos(hd) * 10; z += Math.sin(hd) * 10;
        if (Math.abs(x) > WORLD_HALF - 60 || Math.abs(z) > WORLD_HALF - 60) { end = "edge"; break; }
      }
      if (pts.length < 30) continue;
      if (end === "cut") pts.splice(Math.max(0, pts.length - 8));
      if (pts.length < 30) continue;
      // one pass of corner cutting for smooth bends
      const sm = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; sm.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, y: b.y, w: a.w }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, y: b.y, w: b.w }); }
      sm.push(pts[pts.length - 1]);
      const last = sm[sm.length - 1];
      this.rivers.push({ pts: sm, end, id: this.rivers.length });
      if (end !== "sea") pendingLakes.push([last.x, last.z, 30 + rng() * 30, last.y + 0.3]);
    }
    for (const [x, z, r, y] of pendingLakes) if (ok(x, z, r + 30)) this._lake(pre, x, z, r, y);
    // extra lakes in low, gentle ground
    for (let k = 0; k < 500 && this.lakes.length < 16; k++) {
      const x = (rng() * 2 - 1) * 2800, z = (rng() * 2 - 1) * 3000;
      const w = this.weights(x, z);
      if (w.sea > 0.05 || w.cd < 300 || w.salt > 0.5 || w.swamp > 0.4) continue;
      if (Math.hypot(x, z) < 700 || !ok(x, z, 140)) continue;
      if (this.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 260)) continue;
      const r = 30 + rng() * 55, e = 8;
      const m = Math.hypot(pre(x + e, z) - pre(x - e, z), pre(x, z + e) - pre(x, z - e)) / (2 * e);
      if (m > 0.18) continue;
      let rim = Infinity; for (let a = 0; a < 12; a++) rim = Math.min(rim, pre(x + Math.cos(a * 0.52) * r, z + Math.sin(a * 0.52) * r));
      this._lake(pre, x, z, r, rim - 0.4);
    }
    this._creeks(pre, ok);
    // Round 19: shallow fords every ~260 m along each river (wade across instead of swimming)
    for (const r of this.rivers) {
      let d = 0; const P = r.pts, tot = P.reduce((a, p, i) => a + (i ? Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) : 0), 0);
      for (let i = 0; i < P.length; i++) {
        if (i) d += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        const c = 150 + Math.round((d - 150) / 260) * 260;
        P[i].f = d < 100 || d > tot - 160 ? 0 : 1 - smooth(5, 14, Math.abs(d - c));
      }
      r.fords = P.filter((p, i) => p.f > 0.99 && !(P[i - 1]?.f > 0.99)).map((p) => ({ x: p.x, z: p.z }));
    }
    // spatial grid of river segments for quick lookups
    for (const r of this.rivers) for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], pad = 16 + Math.max(a.f || 0, b.f || 0) * 28;
      const x0 = Math.floor((Math.min(a.x, b.x) - pad) / this.G), x1 = Math.floor((Math.max(a.x, b.x) + pad) / this.G);
      const z0 = Math.floor((Math.min(a.z, b.z) - pad) / this.G), z1 = Math.floor((Math.max(a.z, b.z) + pad) / this.G);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k = gx + "," + gz; let L = this.grid.get(k); if (!L) this.grid.set(k, (L = [])); L.push([r, i]); }
    }
    this.bodies = [{ kind: "ocean", coastX: (z) => this.coastX(z), y: SEA }, ...this.lakes.map((l) => ({ kind: "lake", ...l })), ...this.rivers.map((r) => ({ kind: "river", pts: r.pts, end: r.end }))];
  }
  _lake(pre, x, z, r, y) {
    if (this.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 20)) return;
    this.lakes.push({ x, z, r, y, id: this.lakes.length });
  }

  /** Round 23: small creeks (about as many again as the big rivers), springing from hills and
   *  forests and running down to the nearest river or lake (or a little pond of their own).
   *  Narrow and shallow (wadeable); their own RNG so the big rivers / lakes don't move. */
  _creeks(pre, ok) {
    const rng = mulberry32((this.t.seed ^ 0xc7ee6) >>> 0), main = this.rivers.slice(), want = Math.max(10, main.length);
    const samples = []; for (const r of main) for (let i = 0; i < r.pts.length; i += 6) samples.push(r.pts[i]);
    const nearRiver = (x, z) => { let b = null, bd = Infinity; for (const p of samples) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; b = p; } } return b ? { p: b, d: Math.sqrt(bd) } : null; };
    const srcs = [];
    for (let k = 0; k < 4000 && srcs.length < want * 5; k++) { // more springs than we need: keep the first `want` that make a real creek
      const x = (rng() * 2 - 1) * 2600, z = (rng() * 2 - 1) * 2900;
      const w = this.weights(x, z);
      if (w.sea > 0.05 || w.salt > 0.4 || w.red > 0.3 || w.swamp > 0.3 || w.cd < 200) continue;
      if (Math.hypot(x, z) < 650 || !ok(x, z, 90)) continue;
      const nr = nearRiver(x, z); if (nr && (nr.d < 160 || nr.d > 1300)) continue;
      if (srcs.some((q) => Math.hypot(q.x - x, q.z - z) < 300)) continue;
      if (this.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 120)) continue;
      srcs.push({ x, z, to: nr ? nr.p : null });
    }
    for (const sp of srcs) {
      if (this.rivers.length - main.length >= want) break;
      if (this.rivers.some((r) => r.creek && r.pts.some((q, i) => i % 8 === 0 && Math.hypot(q.x - sp.x, q.z - sp.z) < 160))) continue;
      let x = sp.x, z = sp.z, lvl = pre(x, z) - 0.5, end = "pond";
      let T = sp.to; const lk = this.lakes.slice().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      if (lk && (!T || Math.hypot(lk.x - x, lk.z - z) < Math.hypot(T.x - x, T.z - z))) T = lk;
      if (!T) continue;
      let hd = Math.atan2(T.z - z, T.x - x); const pts = [];
      for (let i = 0; i < 170; i++) {
        const hh = pre(x, z);
        if (hh - lvl > 4) { end = "pond"; break; } // creeks don't cut gorges: where the ground rises, it pools instead
        lvl = Math.min(lvl, hh - 0.5);
        pts.push({ x, z, y: lvl, w: Math.min(2.6, 1.5 + i * 0.012) });
        if (!ok(x, z, 30)) { end = "cut"; break; }
        const nr = nearRiver(x, z);
        if (nr && nr.d < (nr.p.w || 4) + 4) { end = "join"; break; }
        if (this.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r * 0.9)) { end = "join"; break; }
        if (this.weights(x, z).cd < -20) { end = "sea"; break; }
        const want2 = Math.atan2(T.z - z, T.x - x);
        let best = null;
        for (let k = -4; k <= 4; k++) { // mostly the fall line, with a gentle pull toward the river / lake
          const a = hd + k * 0.26, da = Math.atan2(Math.sin(a - want2), Math.cos(a - want2));
          if (Math.abs(da) > 1.7) continue;
          const nx = x + Math.cos(a) * 20, nz = z + Math.sin(a) * 20;
          let sc = pre(nx, nz) + Math.abs(da) * 1.5 + Math.abs(k) * 0.3;
          if (!ok(nx, nz, 30)) sc += 1e4;
          if (!best || sc < best.sc) best = { sc, a };
        }
        if (!best) best = { a: want2 };
        hd = best.a; x += Math.cos(hd) * 10; z += Math.sin(hd) * 10;
        if (Math.abs(x) > WORLD_HALF - 80 || Math.abs(z) > WORLD_HALF - 80) { end = "edge"; break; }
      }
      if (end === "cut") pts.splice(Math.max(0, pts.length - 6));
      if (pts.length < 16) continue;
      // a join must not leave a step: drop the creek's last stretch to the river / lake level
      if (end === "join") { const nr = nearRiver(x, z), ly = nr ? nr.p.y : pts[pts.length - 1].y; for (let i = Math.max(0, pts.length - 4); i < pts.length; i++) pts[i].y = Math.min(pts[i].y, ly + 0.05); }
      const sm = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; sm.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, y: b.y, w: a.w }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, y: b.y, w: b.w }); }
      sm.push(pts[pts.length - 1]);
      this.rivers.push({ pts: sm, end, id: this.rivers.length, creek: true });
      const last = sm[sm.length - 1];
      if (end === "pond" && ok(last.x, last.z, 40) && !this.lakes.some((l) => Math.hypot(l.x - last.x, l.z - last.z) < l.r + 60)) this._lake(pre, last.x, last.z, 12 + rng() * 10, last.y + 0.3);
    }
    this.creekCount = this.rivers.length - main.length;
  }

  /** Nearest river sample: { d, y (surface), w (half width), fx, fz (flow) } or null. */
  river(x, z) {
    const L = this.grid.get(Math.floor(x / this.G) + "," + Math.floor(z / this.G));
    if (!L) return null;
    let best = null;
    for (const [r, i] of L) {
      const a = r.pts[i], b = r.pts[i + 1], q = segInfo(x, z, a.x, a.z, b.x, b.z);
      if (!best || q.d < best.d) {
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        best = { d: q.d, y: lerp(a.y, b.y, q.t), w: lerp(a.w, b.w, q.t), fx: (b.x - a.x) / l, fz: (b.z - a.z) / l, f: lerp(a.f || 0, b.f || 0, q.t) };
      }
    }
    return best;
  }
  lake(x, z) {
    for (const l of this.lakes) { const d = Math.hypot(l.x - x, l.z - z); if (d < l.r * 1.45) return { l, d }; }
    return null;
  }

  /** Carve rivers and lake basins into a height. */
  carve(x, z, h) {
    const rv = this.river(x, z);
    if (rv && rv.d < rv.w + 12 + rv.f * 28) {
      const bed = lerp(rv.y - 0.4 - Math.min(1.8, rv.w * 0.25) * (1 - smooth(0, rv.w, rv.d)), rv.y - 0.45, rv.f); // round 19: fords
      const bank = Math.min(h, rv.y - 0.4 + Math.max(0, rv.d - rv.w) * (0.75 - 0.4 * rv.f)); // round 19: no lip at the water's edge; fords get a gentle ramp
      const target = rv.d < rv.w ? bed : bank;
      h = lerp(h, Math.min(h, target), 1 - smooth(rv.w + 4 + rv.f * 14, rv.w + 12 + rv.f * 28, rv.d));
    }
    const lk = this.lake(x, z);
    if (lk) {
      const { l, d } = lk, u = d / l.r;
      const bowl = l.y - 0.3 - 3.2 * Math.max(0, 1 - u * u);
      const shore = Math.min(h, l.y + 0.4 + Math.max(0, d - l.r) * 0.25);
      h = lerp(h, Math.min(h, u < 1 ? bowl : shore), 1 - smooth(1.05, 1.45, u));
    }
    return h;
  }

  /** Water surface at a point: { y, kind, fx, fz } or null (kind: ocean / lake / river / marsh). */
  waterAt(x, z, w = null, ground = null) {
    const lk = this.lake(x, z);
    if (lk && lk.d < lk.l.r * 1.12) return { y: lk.l.y, kind: "lake", fx: 0, fz: 0 };
    const rv = this.river(x, z);
    if (rv && rv.d < rv.w + 3) return { y: rv.y, kind: "river", fx: rv.fx, fz: rv.fz };
    w = w || this.weights(x, z);
    if (w.cd < 120) return { y: SEA, kind: "ocean", fx: 1, fz: 0 };
    if (w.swamp > 0.45) {
      const g = ground ?? this.t.height(x, z);
      if (g < SWAMP_LEVEL + 0.4) return { y: SWAMP_LEVEL, kind: "marsh", fx: 0, fz: 0 };
    }
    return null;
  }

  /** Map / horizon colour [r, g, b] (0..1) for a point: biome palette, water, height shading. */
  mapRGB(x, z, h, m = 0) {
    if (!this._P) {
      const C = (v) => new THREE.Color(v), g0 = C(0x3d5a34), g1 = C(0x7a8a6a), sn = C(0xdde3ea);
      this._P = { tmp: new THREE.Color(), c: new THREE.Color(), mud: C(0x3e3a26), moss: C(0x4a5a2e), alpGrass: C(0x4a5e3a), stone: C(0x75777a), snow: C(0xe6ecf2), tundra: C(0x6e6a48), lichen: C(0x8a8a5e),
        ice: C(0xbcd8e8), redDeep: C(0x9a3e22), redLight: C(0xd27a40), cream: C(0xe2c9a0), sand: C(0xd2b88a), salt: C(0xd6d0c2), shoreRock: C(0x4c4a48),
        temperate: (cc, x, z, y) => cc.copy(g0).lerp(g1, Math.max(0, Math.min(1, (y + 10) / 160))).lerp(sn, Math.max(0, Math.min(1, (y - 135) / 50))) };
    }
    const P = this._P, w = this.weights(x, z), c = this.color(P.c, x, z, h, m, w, P);
    const wa = this.waterAt(x, z, w, h);
    if (wa && wa.y > h - 0.1) c.setRGB(wa.kind === "ocean" ? 0.12 : 0.2, wa.kind === "ocean" ? 0.3 : 0.38, wa.kind === "ocean" ? 0.48 : 0.5);
    return [c.r, c.g, c.b];
  }

  /** Round 19 boats: deep enough to float a boat here. */
  navigable(x, z) { const wa = this.waterAt(x, z); return !!wa && wa.y - this.t.height(x, z) > 0.9; }

  /** Ground colour (THREE.Color) for a vertex: biome palette blended by weight. */
  color(c, x, z, y, m, w, P) {
    const f = this.fbm, s = this.s;
    const tmp = P.tmp;
    c.setRGB(0, 0, 0);
    const add = (col, k) => { if (k > 0.001) { c.r += col.r * k; c.g += col.g * k; c.b += col.b * k; } };
    if (w.temperate > 0.001) { P.temperate(tmp, x, z, y, m); add(tmp, w.temperate); }
    if (w.swamp > 0.001) { tmp.copy(P.mud).lerp(P.moss, f(x / 14, z / 14, 2, s + 5)); add(tmp, w.swamp); }
    if (w.alpine > 0.001) {
      tmp.copy(P.alpGrass).lerp(P.stone, smooth(60, 140, y) * 0.8 + Math.min(1, m * 0.8));
      const snow = smooth(150 + f(x / 50, z / 50, 2, s) * 60, 210, y) * (m < 1.1 ? 1 : 0.4);
      tmp.lerp(P.snow, snow); add(tmp, w.alpine);
    }
    if (w.tundra > 0.001) {
      const pn = f(x / 60, z / 60, 2, s + 7);
      tmp.copy(P.tundra).lerp(P.lichen, pn);
      tmp.lerp(P.stone, Math.min(1, Math.max(0, (m - 0.6) * 1.5)));
      tmp.lerp(P.snow, smooth(0.45, 0.7, pn + y / 160));
      tmp.lerp(P.ice, smooth(70, 110, y + pn * 30) * (m < 0.9 ? 1 : 0.3));
      add(tmp, w.tundra);
    }
    if (w.red > 0.001) {
      const band = 0.5 + 0.5 * Math.sin(y * 0.62 + f(x / 80, z / 80, 2, s + 9) * 3);
      tmp.copy(P.redDeep).lerp(P.redLight, band);
      if (Math.sin(y * 0.21 + 1.3) > 0.88) tmp.lerp(P.cream, 0.7); // pale caprock band
      if (m < 0.25) tmp.lerp(P.sand, 0.45); // sandy benches and canyon floors
      add(tmp, w.red);
    }
    if (w.salt > 0.001) {
      const flat = smooth(0.48, 0.62, f(x / 260, z / 260, 2, s + 13)) * (m < 0.12 ? 1 : 0.2);
      tmp.copy(P.sand).lerp(P.salt, flat); add(tmp, w.salt);
    }
    if (w.cd < 260) { // beach (sand) or a dark rocky shore in the north
      const k = smooth(220, 40, w.cd) * smooth(5, 1.5, y);
      tmp.copy(P.sand).lerp(P.shoreRock, w.tundra + w.alpine); c.lerp(tmp, k);
    }
    return c;
  }
}
