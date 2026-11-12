/**
 * Overworld resident data: a seeded heightfield (pure function, no meshes), cave entrance
 * list, and per-chunk scatter (tree / rock placements) generated deterministically from
 * seed + chunk coords and cached. Collision, minimap and transitions all query this module;
 * rendered chunks are just a view of the same data, so they can come and go freely.
 */
import { mulberry32 } from "../rng.js";
import { caveName } from "../generator.js";
import { planSettlements, settleMod, colliderGrid } from "./settlements.js";
import { Biomes, WORLD_HALF } from "./biomes.js";

export const CHUNK = 64;
export const SWIM_DEPTH = 1.15; // round 18: deeper than this you swim
const BOUND = WORLD_HALF - 20; // round 18: a much bigger world (was 1400)

function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519 | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm2(x, z, oct, seed) {
  let v = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += noise2(x * f, z * f, seed + i * 101) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return v / n;
}
function segDist2(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L));
  return Math.hypot(ax + vx * t - px, az + vz * t - pz);
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Terrain {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.s = (this.seed % 100000) + 17;
    this.scatterCache = new Map();
    this.mods = null;
    this.bio = new Biomes(this, fbm2); // round 18: regions, rivers, lakes, ocean
    this.entrances = this._placeEntrances();
    // Act 1 site: a waterfall on a hillside (with a small cave beside it), a stream running
    // downhill to the ruined River-Tooth camp on flatter ground. Carved into the height function.
    this.act1 = this._placeAct1();
    if (this.act1) {
      this.mods = this.act1;
      for (const e of this.entrances) e.y = this.height(e.x, e.z);
    }
    // Round 12: camps, villages and lakeside towns (flattened yards, lake basins, colliders).
    this.settlements = planSettlements(this);
    this.settleGrid = colliderGrid(this.settlements);
    if (this.settlements.length) for (const e of this.entrances) e.y = this.height(e.x, e.z);
    // Round 18: rivers and lakes, kept clear of the camp, towns, cave mouths and the start.
    {
      const av = [];
      for (const st of this.settlements) { av.push({ x: st.x, z: st.z, r: st.R + 60 }); if (st.lake) av.push({ x: st.lake.x, z: st.lake.z, r: st.lake.r + 40 }); }
      if (this.act1) { av.push({ x: this.act1.camp.x, z: this.act1.camp.z, r: 90 }); av.push({ x: this.act1.pool.x, z: this.act1.pool.z, r: 70 }); }
      for (const e of this.entrances) av.push({ x: e.x, z: e.z, r: 45 });
      av.push({ x: 0, z: 0, r: 150 });
      this.bio.plan((x, z) => this.baseHeight(x, z), av);
      this.bio.ready = true;
    }
    const e0 = this.entrances[0];
    // Start a short walk downhill from the nearest entrance, looking at it.
    this.spawn = { x: e0.x + e0.fx * 24, z: e0.z + e0.fz * 24 };
    this.spawn.yaw = Math.atan2(-(e0.x - this.spawn.x), -(e0.z - this.spawn.z));
  }

  /** Ground height (m). Rolling hills + a mountain ridge ~450 m north. */
  height(x, z) {
    const h = this.baseHeight(x, z);
    const hm = this.mods ? h + this._mod(x, z, h) : h;
    return this.settlements?.length ? hm + settleMod(this.settlements, x, z, hm) : hm;
  }

  /** Act 1 carving: flat camp, plunge pool, stream bed (all smooth, so collision stays continuous). */
  _mod(x, z, h) {
    const a = this.mods;
    let d = 0;
    const dc = Math.hypot(x - a.camp.x, z - a.camp.z);
    if (dc < 34) d += (a.camp.y - h) * (1 - smooth(15, 34, dc));
    const dp = Math.hypot(x - a.pool.x, z - a.pool.z);
    if (dp < 9) d -= 1.1 * (1 - smooth(2.5, 8, dp));
    if (x > a.sb.x0 && x < a.sb.x1 && z > a.sb.z0 && z < a.sb.z1) {
      let best = 1e9;
      const P = a.stream;
      for (let i = 0; i < P.length - 1; i++) { const q = segDist2(x, z, P[i].x, P[i].z, P[i + 1].x, P[i + 1].z); if (q < best) best = q; }
      if (best < 4.5) d -= 0.75 * (1 - smooth(1.0, 4.2, best));
    }
    return d;
  }

  /** Distance to the stream centreline (Infinity if there is no stream). */
  streamDist(x, z) {
    if (this.bio?.ready) { const rv = this.bio.river(x, z); if (rv && rv.d < rv.w + 40) return Math.max(0, rv.d - rv.w); if (this.waterDepth(x, z) > -0.3) return 0; } // round 18: rivers / lakes count as water too
    const a = this.act1; if (!a) return Infinity;
    let best = Infinity;
    for (let i = 0; i < a.stream.length - 1; i++) best = Math.min(best, segDist2(x, z, a.stream[i].x, a.stream[i].z, a.stream[i + 1].x, a.stream[i + 1].z));
    return Math.min(best, Math.hypot(x - a.pool.x, z - a.pool.z) - 3.5);
  }

  _placeAct1() {
    const rng = mulberry32(this.seed ^ 0xac71);
    const H = (x, z) => this.baseHeight(x, z);
    const slopeB = (x, z) => { const e = 1.5; const gx = (H(x + e, z) - H(x - e, z)) / (2 * e), gz = (H(x, z + e) - H(x, z - e)) / (2 * e); return { gx, gz, m: Math.hypot(gx, gz) }; };
    let best = null;
    for (let tries = 0; tries < 1500; tries++) {
      const r = 60 + Math.sqrt(rng()) * 200, a = rng() * Math.PI * 2;
      const wx = Math.cos(a) * r, wz = Math.sin(a) * r;
      const s0 = slopeB(wx, wz);
      if (s0.m < 0.42 || s0.m > 1.1 || H(wx, wz) > 85) continue;
      if (this.entrances.some((e) => Math.hypot(e.x - wx, e.z - wz) < 75)) continue;
      // follow the fall line downhill until the ground flattens out
      const path = [{ x: wx, z: wz }];
      let x = wx, z = wz, L = 0, end = null;
      for (let k = 0; k < 90; k++) {
        const g = slopeB(x, z);
        if (g.m < 1e-3) break;
        x -= (g.gx / g.m) * 2; z -= (g.gz / g.m) * 2; L += 2;
        if (k % 4 === 3) path.push({ x, z });
        if (L > 50 && g.m < 0.16) { end = { x, z }; break; }
      }
      if (!end || L > 150) continue;
      const fx = -s0.gx / s0.m, fz = -s0.gz / s0.m;
      // camp sits beside the stream's lower end
      const n = path.length, a0 = path[n - 2], dirx = end.x - a0.x, dirz = end.z - a0.z, dl = Math.hypot(dirx, dirz) || 1;
      let camp = null;
      for (const side of [1, -1]) {
        const cx = end.x - (dirz / dl) * 11 * side, cz = end.z + (dirx / dl) * 11 * side;
        if (slopeB(cx, cz).m < 0.22 && this.entrances.every((e) => Math.hypot(e.x - cx, e.z - cz) > 55)) { camp = { x: cx, z: cz }; break; }
      }
      if (!camp) continue;
      const score = Math.abs(L - 75) + Math.hypot(camp.x, camp.z) * 0.08;
      if (!best || score < best.score) best = { score, wx, wz, fx, fz, path, end, camp, dir: { x: dirx / dl, z: dirz / dl } };
      if (tries > 400 && best) break;
    }
    if (!best) return null;
    const { wx, wz, fx, fz } = best;
    // extend the stream past the camp a little further downhill
    const stream = best.path.slice();
    let x = best.end.x, z = best.end.z;
    // mostly straight on (flat ground has no reliable fall line), bending a little downhill, never back
    let dx = best.dir.x, dz = best.dir.z;
    for (let k = 0; k < 7; k++) {
      const g = slopeB(x, z), m = g.m || 1;
      let nx = dx * 3 - (g.gx / m) * 0.8, nz = dz * 3 - (g.gz / m) * 0.8; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if (nx * best.dir.x + nz * best.dir.z < 0.75) { nx = dx; nz = dz; }
      dx = nx; dz = nz; x += dx * 4.5; z += dz * 4.5; stream.push({ x, z });
    }
    stream[0] = { x: wx + fx * 1.5, z: wz + fz * 1.5 };
    const sx = -fz, sz = fx; // along the contour
    const caveE = { x: wx + sx * 9 + fx * 0.5, z: wz + sz * 9 + fz * 0.5 };
    const sb = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const p of stream) { sb.x0 = Math.min(sb.x0, p.x - 6); sb.x1 = Math.max(sb.x1, p.x + 6); sb.z0 = Math.min(sb.z0, p.z - 6); sb.z1 = Math.max(sb.z1, p.z + 6); }
    const site = {
      pool: { x: wx, z: wz, y: H(wx, wz) },
      fall: { x: wx - fx * 4.2, z: wz - fz * 4.2, fx, fz, top: H(wx, wz) + 9.5 },
      camp: { x: best.camp.x, z: best.camp.z, y: H(best.camp.x, best.camp.z) },
      stream, sb,
    };
    // the small first cave ("Waterfall Hollow") beside the falls
    const g = slopeB(caveE.x, caveE.z), m = g.m || 1;
    const ent = { x: caveE.x, z: caveE.z, fx: -g.gx / m, fz: -g.gz / m };
    this.entrances.push({
      ...ent, id: this.entrances.length, y: H(ent.x, ent.z), cave: "hollow", hollow: true,
      name: "Waterfall Hollow", scale: 0.85, yaw: Math.atan2(ent.fx, ent.fz),
    });
    site.caveEntrance = this.entrances[this.entrances.length - 1];
    // berry bushes + root patches around the camp
    const r2 = mulberry32(this.seed ^ 0xbe77);
    site.bushes = [];
    for (let i = 0; i < 18; i++) { // round 23: twice as many (12 berry bushes, 6 root patches)
      const a = r2() * Math.PI * 2, d = 14 + r2() * (i < 9 ? 26 : 34);
      const bx = site.camp.x + Math.cos(a) * d, bz = site.camp.z + Math.sin(a) * d;
      if (Math.hypot(bx - wx, bz - wz) < 10) continue;
      if (i >= 9 && (site.stream.some((p) => Math.hypot(p.x - bx, p.z - bz) < 5) || site.bushes.some((q) => Math.hypot(q.x - bx, q.z - bz) < 2.5))) continue;
      site.bushes.push({ id: "b" + i, x: bx, z: bz, kind: i % 3 === 2 ? "roots" : "berries" });
    }
    return site;
  }

  /** Inside an Act 1 clearing (camp, stream banks, the falls) where no trees / rocks grow. */
  inClearing(x, z) {
    if (this.settlements) for (const s of this.settlements) {
      if (Math.abs(x - s.x) < s.R + 90 && Math.abs(z - s.z) < s.R + 90) {
        if (Math.hypot(x - s.x, z - s.z) < s.R + 5) return true;
        if (s.lake && Math.hypot(x - s.lake.x, z - s.lake.z) < s.lake.r + 6) return true;
      }
    }
    const a = this.act1; if (!a) return false;
    if (Math.hypot(x - a.camp.x, z - a.camp.z) < 24) return true;
    if (Math.hypot(x - a.pool.x, z - a.pool.z) < 12) return true;
    if (x > a.sb.x0 && x < a.sb.x1 && z > a.sb.z0 && z < a.sb.z1 && this.streamDist(x, z) < 3.5) return true;
    return false;
  }

  /** Base heightfield before Act 1 carving. */
  baseHeight(x, z) {
    const w = this.bio.weights(x, z);
    const h = w.temperate > 0.999 && w.cd > 300 ? this.temperateHeight(x, z) : this.bio.land(x, z, w.temperate > 0.001 ? this.temperateHeight(x, z) : 0, w);
    return this.bio.ready ? this.bio.carve(x, z, h) : h;
  }

  /** Round 18: water surface here ({ y, kind, fx, fz }) or null. */
  waterAt(x, z) { return this.bio.waterAt(x, z); }
  /** Water depth above the ground (<= 0: dry). */
  waterDepth(x, z) { const w = this.bio.waterAt(x, z); return w ? w.y - this.height(x, z) : -1; }
  biomeAt(x, z) { return this.bio.biomeAt(x, z); }

  /** The original rolling hills + ridge (the temperate heartland). */
  temperateHeight(x, z) {
    const s = this.s;
    let h = (fbm2(x / 240, z / 240, 4, s) - 0.5) * 50 + (fbm2(x / 70, z / 70, 3, s + 7) - 0.5) * 10 + (fbm2(x / 18, z / 18, 2, s + 13) - 0.5) * 1.2;
    const zr = -450 + 70 * Math.sin(x / 260 + (s % 7)) + 35 * Math.sin(x / 97 + 1.3);
    const d = z - zr;
    const ridged = 1 - Math.abs(fbm2(x / 110, z / 110, 3, s + 3) * 2 - 1);
    h += Math.exp(-((d / 140) ** 2)) * (95 + 110 * ridged * ridged);
    return h;
  }

  slope(x, z) {
    const e = 1.5;
    const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return { gx, gz, m: Math.hypot(gx, gz) };
  }

  _placeEntrances() {
    const rng = mulberry32(this.seed ^ 0x5e17ab);
    const out = [];
    for (let tries = 0; tries < 900 && out.length < 6; tries++) {
      const r = 45 + Math.sqrt(rng()) * 230;
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const { gx, gz, m } = this.slope(x, z);
      if (m < 0.2 || m > 0.75) continue; // a hillside: steep enough for a rock face, walkable below
      if (out.some((e) => Math.hypot(e.x - x, e.z - z) < 60)) continue;
      out.push({ x, z, fx: -gx / m, fz: -gz / m });
    }
    out.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    return out.map((e, i) => {
      const carlsbad = i === 1;
      const caveSeed = (Math.imul(this.seed, 2654435761) + i * 7919 + 13) >>> 0;
      return {
        ...e, id: i, y: this.height(e.x, e.z),
        cave: carlsbad ? "carlsbad" : caveSeed,
        name: carlsbad ? "Carlsbad Cavern" : caveName(caveSeed),
        scale: carlsbad ? 1.6 : 1,
        yaw: Math.atan2(e.fx, e.fz),
      };
    });
  }

  /** Mouth trigger point and the outcrop's colliders for an entrance. */
  entranceGeometry(e) {
    const k = e.scale, bx = -e.fx, bz = -e.fz, sx = -bz, sz = bx;
    return {
      mouth: { x: e.x + bx * 0.9 * k, z: e.z + bz * 0.9 * k },
      colliders: [
        { x: e.x + sx * 3.0 * k + bx * 0.6 * k, z: e.z + sz * 3.0 * k + bz * 0.6 * k, r: 1.5 * k },
        { x: e.x - sx * 3.0 * k + bx * 0.6 * k, z: e.z - sz * 3.0 * k + bz * 0.6 * k, r: 1.5 * k },
        { x: e.x + bx * 7.4 * k, z: e.z + bz * 7.4 * k, r: 4.6 * k },
      ],
    };
  }

  /** Deterministic tree / rock placements for one chunk (resident, cached, LRU-trimmed). */
  scatter(cx, cz) {
    const key = cx + "," + cz;
    let sc = this.scatterCache.get(key);
    if (sc) { this.scatterCache.delete(key); this.scatterCache.set(key, sc); return sc; }
    const rng = mulberry32(Math.floor(hash2(cx, cz, this.s + 999) * 4294967296));
    const trees = [], rocks = [];
    const x0 = cx * CHUNK, z0 = cz * CHUNK, step = 6.5;
    // Keep the mouths, the spawn point and the sightline spawn -> first entrance clear.
    const e0 = this.entrances[0];
    const clearOf = (x, z, r) => this.entrances.every((e) => Math.hypot(e.x - x, e.z - z) > r * e.scale) && Math.hypot(this.spawn.x - x, this.spawn.z - z) > 7
      && segDist2(x, z, this.spawn.x, this.spawn.z, e0.x, e0.z) > 7 && !this.inClearing(x, z);
    // Round 18: what grows depends on the region. Types: 0 pine, 1 juniper, 2 spruce, 3 dead tree,
    // 4 sage / scrub, 5 hoodoo (rock spire), 6 rock arch (rare, red rock).
    const B = this.bio;
    for (let gx = 0; gx < CHUNK; gx += step) {
      for (let gz = 0; gz < CHUNK; gz += step) {
        const x = x0 + gx + rng() * step, z = z0 + gz + rng() * step;
        const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
        const w = B.weights(x, z), r5 = w.temperate > 0.999 ? 0 : rng(); // core chunks keep their old layout
        if (w.sea > 0.02) continue;
        let pick = r5, bio = "temperate"; // soft borders: pick a biome in proportion to the weights
        for (const b of ["temperate", "swamp", "alpine", "tundra", "red", "salt"]) { pick -= w[b]; if (pick <= 0) { bio = b; break; } }
        let dens, type;
        if (bio === "temperate") {
          const forest = fbm2(x / 120, z / 120, 3, this.s + 11);
          dens = smooth(0.44, 0.64, forest) * 0.75 + 0.05; type = r2 < 0.7 ? 0 : 1;
        } else if (bio === "alpine") { dens = 0.42; type = r2 < 0.85 ? 2 : 0; }
        else if (bio === "tundra") { dens = 0.22 * smooth(0.4, 0.6, fbm2(x / 150, z / 150, 2, this.s + 15)) + 0.03; type = r2 < 0.9 ? 2 : 3; }
        else if (bio === "swamp") { dens = 0.32; type = r2 < 0.55 ? 3 : r2 < 0.8 ? 0 : 4; }
        else if (bio === "red") { dens = 0.2; type = r2 < 0.32 ? 1 : r2 < 0.9 ? 4 : 5; }
        else { dens = 0.035; type = 4; }
        if (r1 > dens) continue;
        const y = this.height(x, z);
        if (y > (bio === "alpine" ? 175 : bio === "tundra" ? 85 : 120) && type !== 5) continue; // tree line
        const m = this.slope(x, z).m;
        if (m > (type === 5 ? 0.6 : 0.85) || !clearOf(x, z, 13)) continue;
        if (B.ready && type !== 3) { const wa = B.waterAt(x, z, w, y); if (wa && wa.y > y - 0.3) continue; }
        trees.push({ x, z, y, type, s: (type === 4 ? 0.45 : type === 5 ? 1.2 : 0.75) + r3 * (type === 5 ? 1.6 : 0.9), rot: r4 * 6.28 });
      }
    }
    { // a rare arch in the red rock
      const ax = x0 + CHUNK / 2, az = z0 + CHUNK / 2, w = B.weights(ax, az);
      if (w.red > 0.8 && rng() < 0.06 && this.slope(ax, az).m < 0.3 && clearOf(ax, az, 20)) trees.push({ x: ax, z: az, y: this.height(ax, az), type: 6, s: 1 + rng() * 0.6, rot: rng() * 6.28 });
    }
    const nr = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < nr; i++) {
      const x = x0 + rng() * CHUNK, z = z0 + rng() * CHUNK;
      const s = 0.3 + Math.pow(rng(), 2.2) * 2.2, rot = rng() * 6.28, tilt = rng();
      if (!clearOf(x, z, 9)) continue;
      if (B.weights(x, z).sea > 0.02) continue;
      rocks.push({ x, z, y: this.height(x, z), s, rot, tilt });
    }
    sc = { trees, rocks };
    this.scatterCache.set(key, sc);
    if (this.scatterCache.size > 160) this.scatterCache.delete(this.scatterCache.keys().next().value);
    return sc;
  }

  /** Circle colliders near a point (trees' trunks, big rocks, entrance outcrops). */
  collidersNear(x, z, r = 3) {
    const out = [];
    const c0x = Math.floor((x - r) / CHUNK), c1x = Math.floor((x + r) / CHUNK);
    const c0z = Math.floor((z - r) / CHUNK), c1z = Math.floor((z + r) / CHUNK);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const sc = this.scatter(cx, cz);
      for (const t of sc.trees) {
        if (t.type === 6) { // arch: two legs, walk under the span
          if (Math.abs(t.x - x) > r + 14 || Math.abs(t.z - z) > r + 14) continue;
          const cs = Math.cos(t.rot), sn = Math.sin(t.rot), L = 7 * t.s;
          out.push({ x: t.x + cs * L, z: t.z - sn * L, r: 1.6 * t.s }, { x: t.x - cs * L, z: t.z + sn * L, r: 1.6 * t.s });
          continue;
        }
        if (t.type === 4) continue; // sage / scrub: walk through it
        if (Math.abs(t.x - x) < r + 3 && Math.abs(t.z - z) < r + 3) out.push({ x: t.x, z: t.z, r: t.type === 5 ? 0.9 * t.s : 0.22 * t.s + 0.08 });
      }
      for (const k of sc.rocks) if (k.s > 0.7 && Math.abs(k.x - x) < r + 3 && Math.abs(k.z - z) < r + 3) out.push({ x: k.x, z: k.z, r: k.s * 0.85, top: k.y + k.s * 0.6 }); // round 13: top = jump over / stand on
    }
    if (this.settleGrid) {
      const C = this.settleGrid.C, seen = new Set();
      for (let ix = Math.floor((x - r) / C); ix <= Math.floor((x + r) / C); ix++) for (let iz = Math.floor((z - r) / C); iz <= Math.floor((z + r) / C); iz++) {
        const a = this.settleGrid.get(ix + "," + iz); if (!a) continue;
        for (const c of a) if (!seen.has(c) && Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) { seen.add(c); out.push(c); }
      }
    }
    if (this.campColliders) for (const c of this.campColliders) if (Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) out.push(c);
    if (this.extraColliders) for (const c of this.extraColliders) if (Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) out.push(c); // round 20: Kra's settlements
    const f = this.act1?.fall;
    if (f && Math.abs(f.x - x) < r + 6 && Math.abs(f.z - z) < r + 6) out.push({ x: f.x, z: f.z, r: 3.4 });
    for (const e of this.entrances) {
      if (Math.hypot(e.x - x, e.z - z) > 20 * e.scale) continue;
      for (const c of this.entranceGeometry(e).colliders) out.push(c);
    }
    return out;
  }

  /** Round 19: tree crowns (and hoodoos) near a point as cones, so the chase camera stops short of them. */
  treeCones(x, z, r = 6) {
    const out = [];
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++) {
      for (const t of this.scatter(cx, cz).trees) {
        if (Math.abs(t.x - x) > r + 3 || Math.abs(t.z - z) > r + 3) continue;
        const s = t.s;
        if (t.type === 0) out.push({ x: t.x, z: t.z, y: t.y + 1.2 * s, r: 1.7 * s, h: 5.6 * s, under: true });
        else if (t.type === 1) out.push({ x: t.x, z: t.z, y: t.y + 0.9 * s, r: 1.15 * s, h: 2.6 * s, under: true });
        else if (t.type === 2) out.push({ x: t.x, z: t.z, y: t.y + 0.7 * s, r: 1.15 * s, h: 6.6 * s, under: true });
        else if (t.type === 5) out.push({ x: t.x, z: t.z, y: t.y, r: 0.9 * s, h: 5 * s, cyl: true });
      }
    }
    return out;
  }

  /** Round 12: hut / tent hide cones (and hall volumes) near a point, for the chase camera. */
  conesNear(x, z, r = 6) {
    const out = [];
    if (this.campCones) for (const c of this.campCones) if (Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) out.push(c);
    if (this.settlements) for (const s of this.settlements) {
      if (Math.abs(s.x - x) > s.R + r + 5 || Math.abs(s.z - z) > s.R + r + 5) continue;
      for (const c of s.cones) if (Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) out.push(c);
    }
    for (const c of out) if (c.y == null) c.y = this.height(c.x, c.z);
    return out;
  }

  /** Same contract as volume.js constrainToVolume: returns position + _floor/_eye/_ceil. */
  constrain(proposed, from, radius, st) {
    const p = proposed.clone();
    const feet = from.y - st.eye;
    let standOn = -Infinity;
    for (let it = 0; it < 2; it++) {
      for (const c of this.collidersNear(p.x, p.z, 2)) {
        // Round 13: boulders have a top. Feet above it (mid-jump, or already standing on it) pass
        // over; inside its footprint the top becomes the floor, so you can hop up and stand on rocks.
        if (c.top != null && feet > c.top - 0.42) {
          if (Math.hypot(p.x - c.x, p.z - c.z) < c.r * 0.8) standOn = Math.max(standOn, c.top);
          continue;
        }
        // round 15: wall-segment colliders (hollow buildings) push out from the nearest point on the wall
        const q = colCore(c, p.x, p.z);
        const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz), min = q.t + radius;
        if (d < min) {
          if (d < 1e-4) { p.x = from.x; p.z = from.z; continue; }
          p.x = q.x + (dx / d) * min;
          p.z = q.z + (dz / d) * min;
        }
      }
    }
    p.x = Math.max(-BOUND, Math.min(BOUND, p.x));
    p.z = Math.max(-BOUND, Math.min(BOUND, p.z));
    p._floor = Math.max(this.height(p.x, p.z), standOn);
    // Round 18: water. Wading is just slower; in deep water you swim at the surface (the floor
    // becomes the surface minus a body height), so the bottom never traps you and the swim floor
    // meets the bank continuously.
    p._water = 0;
    const wa = this.bio.ready ? this.bio.waterAt(p.x, p.z) : null;
    if (wa && wa.y > p._floor) { p._water = wa.y - p._floor; p._waterY = wa.y; if (p._water > SWIM_DEPTH) p._floor = wa.y - SWIM_DEPTH; }
    p._eye = st.eye;
    p._ceil = p._floor + 1000;
    return p;
  }

  /** Cave entrance whose mouth the point is in, or null. */
  entranceAt(x, z, radius = 1.7) {
    for (const e of this.entrances) {
      const m = this.entranceGeometry(e).mouth;
      if (Math.hypot(m.x - x, m.z - z) < radius * Math.sqrt(e.scale)) return e;
    }
    return null;
  }
}

/** Round 15: nearest point on a collider's core and its thickness: circles are a point + r, wall
 *  segments ({seg, ax, az, bx, bz, t}) the closest point on the segment + t. */
export function colCore(c, x, z) {
  if (!c.seg) return { x: c.x, z: c.z, t: c.r };
  const vx = c.bx - c.ax, vz = c.bz - c.az, L = vx * vx + vz * vz || 1;
  const k = Math.max(0, Math.min(1, ((x - c.ax) * vx + (z - c.az) * vz) / L));
  return { x: c.ax + vx * k, z: c.az + vz * k, t: c.t };
}
