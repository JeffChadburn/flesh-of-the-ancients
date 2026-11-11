/** Union-of-tubes passage volume: inside tests, walking clamp, obstacles. */

import { stationMap, stationWorld, neighborsOf } from "./cave-data.js";
import { clamp } from "./rng.js";

export const PLAYER_RADIUS = 0.28;
export const STAND_EYE = 1.55;
export const CROUCH_EYE = 0.92;
export const CRAWL_EYE = 0.40;
export const STEP_UP = 0.48;
export const GRAVITY = 18;

export const STANCES = {
  stand: { id: "stand", eye: STAND_EYE, head: 0.16, radius: 0.28, speed: 2.3, sprint: 4.6 },
  crouch: { id: "crouch", eye: CROUCH_EYE, head: 0.14, radius: 0.28, speed: 1.35, sprint: 1.35 },
  crawl: { id: "crawl", eye: CRAWL_EYE, head: 0.12, radius: 0.24, speed: 0.78, sprint: 0.78 },
};

export function stanceHeight(st) {
  const s = typeof st === "string" ? STANCES[st] : st;
  return s.eye + s.head;
}

export function clearanceOfHeight(h) {
  if (h < stanceHeight(STANCES.crouch) + 0.04) return "crawl";
  if (h < stanceHeight(STANCES.stand) + 0.04) return "crouch";
  return "stand";
}

function eyeHeight(up, down, stance) {
  const st = stance || STANCES.stand;
  return st.eye;
}

function frameFromTangent(tx, ty, tz) {
  const len = Math.hypot(tx, ty, tz) || 1;
  tx /= len; ty /= len; tz /= len;
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(ty) > 0.94) { ux = 1; uy = 0; }
  // right = up × tangent
  let rx = uy * tz - uz * ty;
  let ry = uz * tx - ux * tz;
  let rz = ux * ty - uy * tx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // recompute up = tangent × right
  ux = ty * rz - tz * ry;
  uy = tz * rx - tx * rz;
  uz = tx * ry - ty * rx;
  return { tx, ty, tz, rx, ry, rz, ux, uy, uz };
}

export function buildVolume(cave, obstacles = []) {
  const smap = stationMap(cave);
  const segments = [];
  for (const leg of cave.legs) {
    const a = smap.get(leg.from);
    const b = smap.get(leg.to);
    if (!a || !b) continue;
    const pa = stationWorld(a);
    const pb = stationWorld(b);
    const abx = pb.x - pa.x;
    const aby = pb.y - pa.y;
    const abz = pb.z - pa.z;
    const length = Math.hypot(abx, aby, abz) || 1;
    const len2h = abx * abx + abz * abz;
    segments.push({
      ax: pa.x, ay: pa.y, az: pa.z,
      bx: pb.x, by: pb.y, bz: pb.z,
      abx, aby, abz, length, len2h,
      al: a.left, ar: a.right, au: a.up, ad: a.down,
      bl: b.left, br: b.right, bu: b.up, bd: b.down,
      from: a.id, to: b.id,
      openA: a.kind === "entrance" || a.kind === "exit",
      openB: b.kind === "entrance" || b.kind === "exit",
    });
  }
  const hubs = [];
  const nbrs = neighborsOf(cave);
  for (const s of cave.stations) {
    const p = stationWorld(s);
    let radius = Math.max(s.left, s.right) * 1.05;
    for (const nid of nbrs.get(s.id) || []) {
      const n = smap.get(nid);
      if (!n) continue;
      const q = stationWorld(n);
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d > 0.2) radius = Math.min(radius, d * 0.42);
    }
    radius = Math.max(0.18, radius);
    if (s.kind === "cavern") {
      // Halls: walk the whole room (not just the legs crossing it), inside the rendered dome.
      const big = Math.max(s.left, s.right) * 0.86;
      const deg = (nbrs.get(s.id) || []).length;
      let lim = Infinity;
      if (deg === 1) for (const nid of nbrs.get(s.id) || []) { const n = smap.get(nid); if (n) { const q = stationWorld(n); lim = Math.hypot(p.x - q.x, p.z - q.z) * 0.75; } }
      radius = Math.max(radius, Math.min(big, lim));
    }
    hubs.push({
      id: s.id,
      x: p.x, y: p.y, z: p.z,
      left: s.left, right: s.right, up: s.up, down: s.down,
      radius,
      floor: p.y - s.down,
      ceil: p.y + s.up,
      kind: s.kind,
    });
  }
  // Hub -> its connected segments, so a junction's floor can blend the legs' sloped floors
  // (a flat hub floor against steep legs caused pop-up / drop / step-blocking at junctions).
  const byId = new Map(hubs.map((h) => [h.id, h]));
  segments.forEach((sg, i) => {
    for (const id of [sg.from, sg.to]) {
      const h = byId.get(id);
      if (h) (h.segs || (h.segs = [])).push(i);
    }
  });
  // Halls: a passage that crosses a big hall above its floor has its rock clipped away by the
  // hall (mesh.js), so it must not stay walkable there either (no invisible bridges).
  const halls = hubs.filter((h) => h.kind === "cavern").map((h) => ({ id: h.id, x: h.x, y: h.y, z: h.z, floor: h.floor, up: h.up, r: h.radius + 0.6 }));
  return { segments, hubs, halls, obstacles: obstacles.slice(), cave };
}

function overHall(volume, x, z, floor, seg) {
  const hs = volume.halls;
  if (!hs || !hs.length) return false;
  // Legs from the hall's own station stay walkable: they are the (visible) ramps up to its mouths.
  // Only where the passage actually lies inside the hall's dome (an ellipsoid, like mesh.js
  // insideHall); passages above the dome keep their own rock and stay walkable.
  for (const h of hs) {
    if (seg.from === h.id || seg.to === h.id || floor <= h.floor + 1.6) continue;
    const d = Math.hypot(x - h.x, z - h.z);
    if (d >= h.r) continue;
    const dy = Math.max(0, floor + 0.9 - h.y) / Math.max(1, h.up * 0.92);
    if ((d / h.r) ** 2 + dy * dy < 1) return true;
  }
  return false;
}

/**
 * Continuous walkable ground: weighted blend of candidate segment floors (containing segments
 * plus legs of containing hubs), each sampled at its clamped t, weighted by distance from its
 * centre line. Only floors near the player's current level count, so stacked passages don't mix.
 */
function smoothGround(volume, x, y, z, containing, fallbackFloor, fallbackCeil) {
  // Weights depend only on horizontal distance to each leg's centre line (continuous), with a
  // steep falloff; the level filter keeps stacked passages apart.
  const ref = y - STAND_EYE;
  let wf = 0, wc = 0, wsum = 0;
  for (const seg of volume.segments) {
    const tRaw = horizontalT(x, z, seg);
    const t = clamp(tRaw, 0, 1);
    const fx = seg.ax + seg.abx * t, fz = seg.az + seg.abz * t;
    const width = Math.max(1, (seg.al + seg.ar + seg.bl + seg.br) * 0.25);
    const d = Math.hypot(x - fx, z - fz) / width;
    if (d > 3) continue;
    const floor = seg.ay + seg.aby * t - (seg.ad + (seg.bd - seg.ad) * t);
    // Only legs on (about) the same level as the floor you're on: a passage passing above or
    // below within a few metres must not drag the ground up (that caused squeezes and snags).
    if (Math.abs(floor - fallbackFloor) > 1.8) continue;
    const ceil = seg.ay + seg.aby * t + (seg.au + (seg.bu - seg.au) * t);
    const q = d * d + 0.04;
    const w = 1 / (q * q * q);
    wf += floor * w; wc += ceil * w; wsum += w;
  }
  if (wsum <= 0) return null;
  return { floor: wf / wsum, ceil: Math.max(wc / wsum, wf / wsum + 0.5) };
}

export function setObstacles(volume, obstacles) {
  volume.obstacles = obstacles.slice();
}

function sampleSeg(seg, t) {
  const x = seg.ax + seg.abx * t;
  const y = seg.ay + seg.aby * t;
  const z = seg.az + seg.abz * t;
  const left = seg.al + (seg.bl - seg.al) * t;
  const right = seg.ar + (seg.br - seg.ar) * t;
  const up = seg.au + (seg.bu - seg.au) * t;
  const down = seg.ad + (seg.bd - seg.ad) * t;
  const fr = frameFromTangent(seg.abx, seg.aby, seg.abz);
  return { x, y, z, left, right, up, down, floor: y - down, ceil: y + up, ...fr };
}

/** Horizontal t on a segment, unclamped. */
export function horizontalT(px, pz, seg) {
  if (seg.len2h < 1e-6) return 0.5;
  return ((px - seg.ax) * seg.abx + (pz - seg.az) * seg.abz) / seg.len2h;
}

function latOf(px, pz, s) {
  return (px - s.x) * s.rx + (pz - s.z) * s.rz;
}

/**
 * Is a foot-level point (x,z) with eye/feet y inside the union of tubes + hubs?
 * radius is the capsule radius. eps loosens the test for the safety net.
 */
export function pointInside(volume, x, y, z, radius = PLAYER_RADIUS, eps = 0) {
  const q = queryVolume(volume, x, y, z, radius, eps);
  return q.inside;
}

export function queryVolume(volume, x, y, z, radius = PLAYER_RADIUS, eps = 0) {
  let best = null;
  let bestD = Infinity;
  const containing = [];
  for (let si = 0; si < volume.segments.length; si++) {
    const seg = volume.segments[si];
    const tRaw = horizontalT(x, z, seg);
    const t = clamp(tRaw, 0, 1);
    const s = sampleSeg(seg, t);
    const lat = latOf(x, z, s);
    const maxL = Math.max(0.16, s.left - radius) + eps;
    const maxR = Math.max(0.16, s.right - radius) + eps;
    const past = Math.abs(tRaw - t) * seg.length;
    const inLat = lat >= -maxL && lat <= maxR;
    const inY = y >= s.floor - 0.35 - eps && y <= s.ceil + STAND_EYE + eps;
    const inLen = past <= 0.12 + eps;
    const dx = x - s.x;
    const dz = z - s.z;
    const d = Math.hypot(dx, dz);
    if (inLat && inY && inLen && !overHall(volume, x, z, s.floor, seg)) containing.push({ type: "seg", segIndex: si, s, t, lat, floor: s.floor, ceil: s.ceil, up: s.up, down: s.down });
    // Distance to the allowed slab (for projection).
    const clat = clamp(lat, -maxL, maxR);
    const px = s.x + s.rx * clat;
    const pz = s.z + s.rz * clat;
    const pd = Math.hypot(x - px, z - pz);
    if (pd < bestD) {
      bestD = pd;
      best = { type: "seg", s, t, lat: clat, floor: s.floor, ceil: s.ceil, up: s.up, down: s.down, x: px, z: pz, dist: pd };
    }
  }
  for (const h of volume.hubs) {
    const dx = x - h.x;
    const dz = z - h.z;
    const d = Math.hypot(dx, dz);
    const rad = Math.max(0.16, h.radius - radius) + eps;
    const inY = y >= h.floor - 0.35 - eps && y <= h.ceil + STAND_EYE + eps;
    if (d <= rad && inY) {
      containing.push({ type: "hub", s: h, floor: h.floor, ceil: h.ceil, up: h.up, down: h.down, lat: 0 });
    }
    if (d - rad < bestD) {
      const k = d > 1e-6 ? rad / d : 0;
      const px = h.x + dx * k;
      const pz = h.z + dz * k;
      const pd = Math.max(0, d - rad);
      if (pd < bestD) {
        bestD = pd;
        best = { type: "hub", s: h, floor: h.floor, ceil: h.ceil, up: h.up, down: h.down, x: px, z: pz, dist: pd, lat: 0 };
      }
    }
  }

  const inside = containing.length > 0;
  let floor, ceil, up, down;
  if (inside) {
    // Prefer the containing tube whose floor is closest beneath the player.
    let pick = containing[0];
    let score = Infinity;
    for (const c of containing) {
      const sc = Math.abs(y - (c.floor + eyeHeight(c.up, c.down)));
      if (sc < score) { score = sc; pick = c; }
    }
    floor = pick.floor;
    ceil = pick.ceil;
    up = pick.up;
    down = pick.down;
    const g = smoothGround(volume, x, y, z, containing, pick.floor, pick.ceil);
    if (g) {
      floor = g.floor;
      ceil = Math.min(Math.max(g.ceil, floor + 0.5), Math.max(...containing.map((c) => c.ceil)));
    }
  } else if (best) {
    floor = best.floor;
    ceil = best.ceil;
    up = best.up;
    down = best.down;
  } else {
    floor = y - 1;
    ceil = y + 2;
    up = 1.4;
    down = 0.6;
  }
  return {
    inside,
    floor,
    ceil,
    up,
    down,
    eye: eyeHeight(up, down, STANCES.stand),
    best,
    containing,
  };
}

function pushObstacles(volume, x, y, z, floor, radius) {
  let px = x;
  let pz = z;
  const obstacles = volume.obstacles || [];
  for (let iter = 0; iter < 3; iter++) {
    let hit = false;
    for (const o of obstacles) {
      if (o.skip) continue;
      const top = (o.y ?? floor) + (o.height || 1);
      const base = o.y ?? floor;
      if (y + 0.2 < base || y - STAND_EYE > top) continue;
      const dx = px - o.x;
      const dz = pz - o.z;
      const d = Math.hypot(dx, dz);
      const need = (o.radius || 0.2) + radius + 0.02;
      if (d < need && d > 1e-6) {
        const k = need / d;
        px = o.x + dx * k;
        pz = o.z + dz * k;
        hit = true;
      } else if (d < 1e-6) {
        px += need;
        hit = true;
      }
    }
    if (!hit) break;
  }
  return { x: px, z: pz };
}

/** Clamp a proposed eye-level position into the walkable volume. */
export function constrainToVolume(volume, proposed, previous, radius = PLAYER_RADIUS, stance = STANCES.stand) {
  const q = queryVolume(volume, proposed.x, proposed.y, proposed.z, radius, 0);
  let x, z, floor, ceil, eye, up, down, inside;
  if (q.inside) {
    x = proposed.x;
    z = proposed.z;
    floor = q.floor;
    ceil = q.ceil;
    eye = q.eye;
    up = q.up;
    down = q.down;
    inside = true;
  } else if (q.best) {
    x = q.best.x;
    z = q.best.z;
    floor = q.best.floor;
    ceil = q.best.ceil;
    up = q.best.up;
    down = q.best.down;
    eye = eyeHeight(up, down);
    inside = false;
  } else if (previous) {
    x = previous.x;
    z = previous.z;
    const p = queryVolume(volume, x, previous.y, z, radius, 0.05);
    floor = p.floor;
    ceil = p.ceil;
    eye = p.eye;
    up = p.up;
    down = p.down;
    inside = p.inside;
  } else {
    x = proposed.x;
    z = proposed.z;
    floor = proposed.y - 1;
    ceil = proposed.y + 2;
    eye = STAND_EYE;
    up = 1.4;
    down = 0.6;
    inside = false;
  }

  const st = typeof stance === "string" ? STANCES[stance] || STANCES.stand : (stance || STANCES.stand);
  const needH = stanceHeight(st);
  const pushed = pushObstacles(volume, x, proposed.y, z, floor, st.radius || radius);
  if (pushed.x !== x || pushed.z !== z) {
    const q2 = queryVolume(volume, pushed.x, proposed.y, pushed.z, st.radius || radius, 0.02);
    if (q2.inside) {
      x = pushed.x;
      z = pushed.z;
      floor = q2.floor;
      ceil = q2.ceil;
      inside = true;
    } else if (q2.best && q2.best.dist < 0.6) {
      x = q2.best.x;
      z = q2.best.z;
      floor = q2.best.floor;
      ceil = q2.best.ceil;
      inside = false;
    }
  }

  let blockedLow = false;
  // Only pieces on the level you stand on limit headroom: at a junction a leg that climbs or drops
  // away from you has a much lower / higher floor there, and its ceiling isn't over your head.
  const sameLevel = (q && q.containing) ? q.containing.filter((c) => Math.abs(c.floor - floor) < 0.45) : [];
  const heightHere = sameLevel.length
    ? Math.min(ceil - floor, ...sameLevel.map((c) => c.ceil - c.floor))
    : (ceil - floor);
  let needStance = clearanceOfHeight(heightHere);
  if (heightHere < needH - 0.02) {
    blockedLow = true;
    if (previous) {
      const pq = queryVolume(volume, previous.x, previous.y, previous.z, st.radius || radius, 0.05);
      x = previous.x;
      z = previous.z;
      floor = pq.floor;
      ceil = pq.ceil;
      inside = pq.inside;
      needStance = clearanceOfHeight(ceil - floor);
    }
  }

  const out = previous && previous.clone ? previous.clone() : { x, y: proposed.y, z };
  out.x = x;
  out.y = proposed.y;
  out.z = z;
  out._floor = floor;
  out._ceil = ceil;
  out._eye = st.eye;
  out._inside = inside;
  out._blockedLow = blockedLow;
  out._needStance = needStance;
  out._clearance = needStance;
  return out;
}

function tightestHeight(q) {
  let h = q.ceil - q.floor;
  const same = (q.containing || []).filter((c) => Math.abs(c.floor - q.floor) < 0.45);
  if (same.length) h = Math.min(h, ...same.map((c) => c.ceil - c.floor));
  return h;
}

export function requiredStanceAt(volume, x, y, z, radius = 0.2) {
  const q = queryVolume(volume, x, y, z, radius, 0.15);
  return clearanceOfHeight(tightestHeight(q));
}

export function canFitStance(volume, x, y, z, stance) {
  const st = typeof stance === "string" ? STANCES[stance] : stance;
  const q = queryVolume(volume, x, y, z, st.radius, 0.08);
  if (!q.inside && !(q.best && q.best.dist < 0.25)) return false;
  return tightestHeight(q) >= stanceHeight(st) - 0.04;
}

export function clearanceAhead(volume, x, y, z, yaw, dist = 8) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let need = "stand";
  for (const d of [0.6, 1.2, 2.0, 3.0, 4.2, 5.5, 7.0]) {
    const r = requiredStanceAt(volume, x + fx * d, y, z + fz * d);
    if (r === "crawl") need = "crawl";
    else if (r === "crouch" && need === "stand") need = "crouch";
  }
  return need;
}

export function fitsAlongPath(volume, points, stance) {
  for (const p of points) {
    if (!canFitStance(volume, p.x, p.y, p.z, stance)) return false;
  }
  return true;
}

export { eyeHeight };
