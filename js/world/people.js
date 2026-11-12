/**
 * Round 12: settlement people (low-poly cavefolk). Non-hostile and unkillable: they are not in the
 * wildlife / arrow target lists, so spears and arrows pass straight through them.
 * They walk between hut doors, the fires and the drying racks (via the plaza / fire ring), stand
 * and idle, sit at fires, and sometimes carry a bundle. Rendered as 6 instanced draws for
 * everyone (torso, head, legs, arms, bundle, hide skirt); far ones are simulated but hidden.
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";
import { addDetail, smoothNormals } from "../realism.js";
import { colCore } from "./terrain.js";
import { identity } from "../act1/talk.js";

const TUNIC = [0x8a6a48, 0x7a5a3c, 0x9b7b55, 0x6e5034, 0xa38763, 0x5f4a36, 0x8c5a3c];
const SKIN = [0xc79a74, 0xb5835c, 0xa87454, 0x8e5e40, 0xd2a983];
const PER = { camp: [3, 5], village: [8, 14], city: [22, 30] };

function headGeo() {
  const parts = [[new THREE.IcosahedronGeometry(0.14, 1), 0xffffff], [new THREE.IcosahedronGeometry(0.15, 1).translate(0, 0.04, -0.035).scale(1.02, 0.85, 1), 0x3a2a1e]];
  const pos = [], col = [], c = new THREE.Color();
  for (const [g0, hex] of parts) { const g = g0.toNonIndexed(); pos.push(...g.attributes.position.array); c.setHex(hex); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}

export class People {
  constructor(terrain, scene, { lite = false } = {}) {
    this.t = terrain; this.scene = scene; this.lite = lite;
    this.cap = lite ? 40 : 110;
    this.visR = lite ? 60 : 95;
    this.list = [];
    this.rng = mulberry32(terrain.seed ^ 0x9e0b1e);
    const flat = (c) => addDetail(new THREE.MeshLambertMaterial({ color: c }), { scale: 7, amt: 0.14, sat: 0.72, ao: 0.08, bump: 0.04 }); // round 14: smooth-shaded, muted
    const torso = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 7).translate(0, 1.13, 0); torso.scale(1, 1, 0.72);
    const skirt = new THREE.CylinderGeometry(0.2, 0.27, 0.32, 7).translate(0, 0.8, 0); skirt.scale(1, 1, 0.8);
    const leg = new THREE.CylinderGeometry(0.065, 0.05, 0.82, 5).translate(0, -0.41, 0);
    const arm = new THREE.CylinderGeometry(0.055, 0.045, 0.6, 5).translate(0, -0.3, 0);
    const head = headGeo().translate(0, 1.6, 0);
    const bundle = new THREE.DodecahedronGeometry(0.24, 0).scale(1.2, 0.8, 0.9);
    const mk = (geo, mat, n) => { smoothNormals(geo); const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.name = "people"; scene.add(m); return m; };
    const white = addDetail(new THREE.MeshLambertMaterial({ color: 0xffffff }), { scale: 7, amt: 0.14, sat: 0.72, ao: 0.08, bump: 0.04 });
    this.m = {
      torso: mk(torso, white, this.cap), skirt: mk(skirt, flat(0x5c4430), this.cap),
      head: mk(head, addDetail(new THREE.MeshLambertMaterial({ vertexColors: true }), { scale: 9, amt: 0.1, sat: 0.75, ao: 0.05, bump: 0.03 }), this.cap),
      leg: mk(leg, white, this.cap * 2), arm: mk(arm, white, this.cap * 2),
      bundle: mk(bundle, flat(0x7d6446), this.cap),
    };
    this._m = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._l = new THREE.Matrix4(); this._c = new THREE.Color(); this._z = new THREE.Matrix4(); this._bundles = 0;
    this.time = 0;
  }

  /** Spawn people for a settlement whose meshes were just built. */
  spawnFor(s) {
    // Round 20: each townsperson is a fixed person (name, voice, trade) from the town's seed, so
    // they can be talked to and remembered; ones who joined Kra's settlement stay away.
    const R0 = mulberry32((s.seed || 1) ^ 0x51ed);
    const [lo, hi] = PER[s.kind];
    let n = lo + Math.floor(R0() * (hi - lo + 1));
    if (this.lite) n = Math.ceil(n * 0.45);
    for (let i = 0; i < n && this.list.length < this.cap; i++) {
      const key = `${s.id}:${i}`;
      if (this.skip?.(key)) continue;
      const r = mulberry32((s.seed || 1) + i * 977 + 13);
      const sp = this._spot(s);
      const p = {
        s, key, ident: identity((s.seed || 1) + i * 7919, s), x: sp.x + (r() - 0.5) * 2, z: sp.z + (r() - 0.5) * 2, yaw: r() * 6.28,
        speed: 1.0 + r() * 0.5, h: 0.92 + r() * 0.14, phase: r() * 6.28,
        tunic: TUNIC[Math.floor(r() * TUNIC.length)], skin: SKIN[Math.floor(r() * SKIN.length)],
        state: "idle", t: r() * 4, route: [], carry: false, sit: 0, stuck: 0, walkAmt: 0,
      };
      this.list.push(p);
    }
  }
  /** Round 20: a person driven from outside (a villager of Kra's settlement); only rendered here. */
  addExternal(p) { Object.assign(p, { ext: true, yaw: p.yaw || 0, speed: 1.3, h: p.h || 1, phase: 0, tunic: p.tunic || TUNIC[(p.seed || 0) % TUNIC.length], skin: p.skin || SKIN[(p.seed || 0) % SKIN.length], state: "idle", route: [], carry: false, sit: 0, stuck: 0, walkAmt: 0 }); this.list.push(p); return p; }
  remove(p) { const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); }
  despawnFor(s) { this.list = this.list.filter((p) => p.s !== s); }

  _spot(s) {
    const r = this.rng();
    if (s.fires.length && r < 0.25) { const f = s.fires[Math.floor(this.rng() * s.fires.length)], a = this.rng() * 6.28; return { x: f.x + Math.cos(a) * 2.2, z: f.z + Math.sin(a) * 2.2 }; }
    return s.spots[Math.floor(this.rng() * s.spots.length)] || { x: s.x + 3, z: s.z };
  }
  _plan(p) {
    const s = p.s, r = this.rng();
    p.work = null;
    if (r < 0.3) { p.state = "idle"; p.t = 2 + this.rng() * 6; if (p.ident && this.rng() < 0.6) { p.work = p.ident.anim; p.t += 4; } return; } // round 20: chores
    if (r < 0.5 && s.fires.length) {
      // walk to a fire and sit
      const f = s.fires[Math.floor(this.rng() * s.fires.length)], a = this.rng() * 6.28;
      p.route = [{ x: f.x + Math.cos(a) * 1.9, z: f.z + Math.sin(a) * 1.9, sit: f }];
    } else {
      const sp = this._spot(s);
      p.route = [{ x: sp.x, z: sp.z }];
    }
    // via the plaza / fire ring (keeps them on the open ground between huts)
    if (s.kind !== "camp") {
      const a = Math.atan2(p.z - s.z, p.x - s.x) + (this.rng() - 0.5) * 0.6, ring = s.kind === "city" ? 7.5 : 3.6;
      const tgt = p.route[0], ta = Math.atan2(tgt.z - s.z, tgt.x - s.x);
      if (Math.hypot(tgt.x - s.x, tgt.z - s.z) > ring + 2 || Math.hypot(p.x - s.x, p.z - s.z) > ring + 2)
        p.route.unshift({ x: s.x + Math.cos(a) * ring, z: s.z + Math.sin(a) * ring }, { x: s.x + Math.cos(ta) * ring, z: s.z + Math.sin(ta) * ring });
    }
    p.state = "walk"; p.carry = this.rng() < 0.35; p.stuck = 0;
  }

  update(dt, player) {
    this.time += dt;
    const px = player.x, pz = player.z, vis2 = this.visR * this.visR;
    let n = 0;
    this._bundles = 0;
    for (const p of this.list) {
      const dx = p.x - px, dz = p.z - pz, d2 = dx * dx + dz * dz;
      // ---- behaviour (cheap; runs for hidden ones too)
      if (p.ext) { // round 20: Kra's villagers are moved by the colony sim
        if (p.talkT > 0) { p.talkT -= dt; const want = Math.atan2(-dx, -dz); p.yaw += wrap(want - p.yaw) * Math.min(1, dt * 4); }
        p.walkAmt += ((p.state === "walk" ? 1 : 0) - p.walkAmt) * Math.min(1, dt * 6);
        if (d2 > vis2 || n >= this.cap) continue;
        this._pose(p, n++);
        continue;
      }
      if (!(p.talkT > 0) && d2 < 9 && p.ident && p.state === "walk") p.talkT = 3; // round 20: they stop when Kra walks up (easy to talk to)
      if (p.talkT > 0) { p.talkT -= dt; p.state = "idle"; p.t = Math.max(p.t, 1); p.yaw += wrap(Math.atan2(-dx, -dz) - p.yaw) * Math.min(1, dt * 4); } // round 20: stop and face Kra while talking
      if (p.state === "idle" || p.state === "sit") {
        p.t -= dt;
        if (p.t <= 0) { p.state = "idle"; p.sit = 0; this._plan(p); }
        if (d2 < 16 && p.state === "idle") { const want = Math.atan2(-dx, -dz); p.yaw += wrap(want - p.yaw) * Math.min(1, dt * 3); }
      } else if (p.state === "walk") {
        const w = p.route[0];
        if (!w) { p.state = "idle"; p.t = 2; }
        else {
        const wx = w.x - p.x, wz = w.z - p.z, wd = Math.hypot(wx, wz);
        if (wd < 0.35) {
          p.route.shift();
          if (!p.route.length) { if (w.sit) { p.state = "sit"; p.t = 10 + this.rng() * 22; p.yaw = Math.atan2(w.sit.x - p.x, w.sit.z - p.z); } else { p.state = "idle"; p.t = 1.5 + this.rng() * 5; } p.carry = p.carry && this.rng() < 0.5; }
        } else {
          const blocked = d2 < 1.4; // stop for the player rather than walking through them
          if (!blocked) {
            const step = Math.min(wd, p.speed * dt), ox = p.x, oz = p.z;
            p.x += (wx / wd) * step; p.z += (wz / wd) * step;
            if (d2 < vis2) this._push(p);
            const moved = Math.hypot(p.x - ox, p.z - oz);
            p.stuck = moved < step * 0.3 ? p.stuck + dt : 0;
            if (p.stuck > 1.5) { p.route = []; p.state = "idle"; p.t = 1; }
            p.yaw += wrap(Math.atan2(wx, wz) - p.yaw) * Math.min(1, dt * 6);
            p.phase += moved * 4.2;
          }
        }
        }
      }
      p.walkAmt += ((p.state === "walk" && d2 >= 1.4 ? 1 : 0) - p.walkAmt) * Math.min(1, dt * 6);
      // ---- render
      if (d2 > vis2 || n >= this.cap) continue;
      this._pose(p, n++);
    }
    for (const k in this.m) { const m = this.m[k]; m.count = k === "leg" || k === "arm" ? n * 2 : k === "bundle" ? this._bundles : n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.visible = n;
  }

  _push(p) {
    for (const c of this.t.collidersNear(p.x, p.z, 1)) {
      const q = colCore(c, p.x, p.z), dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz), min = q.t + 0.3;
      if (d < min && d > 1e-4) { p.x = q.x + (dx / d) * min; p.z = q.z + (dz / d) * min; }
    }
  }

  _pose(p, i) {
    const M = this._m, R = this._r, L = this._l, c = this._c;
    const y = this.t.height(p.x, p.z), sit = p.state === "sit";
    const sw = Math.sin(p.phase) * 0.55 * p.walkAmt;
    R.makeRotationY(p.yaw).setPosition(p.x, y - (sit ? 0.5 : 0), p.z);
    const s = p.h;
    M.makeScale(s, s, s).premultiply(R);
    // body bob
    if (!sit) M.elements[13] += Math.abs(Math.cos(p.phase)) * 0.04 * p.walkAmt;
    this.m.torso.setMatrixAt(i, M); this.m.torso.setColorAt(i, c.setHex(p.tunic));
    this.m.skirt.setMatrixAt(i, M);
    this.m.head.setMatrixAt(i, M); this.m.head.setColorAt(i, c.setHex(p.skin));
    const legAt = (k, side, ang) => {
      L.makeRotationX(ang).setPosition(side * 0.1, 0.88, 0);
      L.premultiply(M); this.m.leg.setMatrixAt(i * 2 + k, L); this.m.leg.setColorAt(i * 2 + k, c.setHex(p.skin));
    };
    legAt(0, 1, sit ? -1.45 : sw); legAt(1, -1, sit ? -1.45 : -sw);
    const armAt = (k, side, ax, az) => {
      L.makeRotationX(ax); const Z = this._z.makeRotationZ(az); L.premultiply(Z).setPosition(side * 0.24, 1.38, 0);
      L.premultiply(M); this.m.arm.setMatrixAt(i * 2 + k, L); this.m.arm.setColorAt(i * 2 + k, c.setHex(p.skin));
    };
    const wk = p.state === "idle" && p.walkAmt < 0.2 ? p.work : null, tt = this.time * (wk === "chop" || wk === "mine" ? 3.2 : 2.4) + p.phase;
    if (wk === "chop" || wk === "mine") { const a = -1.6 - Math.max(0, Math.sin(tt)) * 1.3; armAt(0, 1, a, 0.1); armAt(1, -1, a, -0.1); } // round 20: work animations
    else if (wk === "scrape") { const a = -0.9 - Math.sin(tt) * 0.35; armAt(0, 1, a, 0.15); armAt(1, -1, a + 0.2, -0.15); }
    else if (wk === "dig") { const a = -0.6 - Math.abs(Math.sin(tt)) * 0.9; armAt(0, 1, a, 0.05); armAt(1, -1, a, -0.05); }
    else if (p.carry && !sit) { armAt(0, 1, -2.7, 0.15); armAt(1, -1, -sw * 0.8, -0.08); }
    else if (sit) { armAt(0, 1, -0.9, 0.1); armAt(1, -1, -0.9, -0.1); }
    else { const idleSway = p.walkAmt < 0.1 ? Math.sin(this.time * 1.3 + p.phase) * 0.05 : 0; armAt(0, 1, -sw * 0.8 + idleSway, 0.08); armAt(1, -1, sw * 0.8 - idleSway, -0.08); }
    if (p.carry && !sit) {
      L.makeTranslation(0.2, 1.72, -0.02).premultiply(M);
      this.m.bundle.setMatrixAt(this._bundles++, L);
    }
  }

  nearest(x, z) { let best = null, bd = 1e9; for (const p of this.list) { if (!p.ident) continue; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best ? { p: best, d: bd } : null; }

  dispose() {
    for (const k in this.m) { this.scene.remove(this.m[k]); this.m[k].geometry.dispose(); this.m[k].material.dispose(); this.m[k].dispose(); }
    this.list = [];
  }
}
function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
