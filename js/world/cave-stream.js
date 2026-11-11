/**
 * Cave streaming layer. Resident (always in memory, cheap): the survey graph, the wall
 * "piece" recipes (one per leg / hub, see mesh.js), formation instance matrices, colliders
 * (in the player's LRUD volume) and water. Heavy (per cell, built on demand and disposed):
 * wall geometry, formation instance buffers, named formation meshes.
 *
 * Cells are a 3D grid (CELL metres). A cell is wanted when one of its pieces is reachable
 * within LOAD metres ALONG THE PASSAGES from the player (Dijkstra over the station graph,
 * seeded from the player's position on their current leg), or when the player stands right
 * next to that piece's wall. Rock you can't see through never triggers a load.
 */
import * as THREE from "three";
import { stationMap, stationWorld } from "../cave-data.js";
import { ensureBVH } from "../wallcollide.js";
import { prepareCavePieces, makePieceBuffer, pieceBufferGeometry, passageMeshes, portalObjects } from "../mesh.js";
import { addFormations, buildInstanced, addNamedFeatures } from "../formations.js";

const CELL = 24;
const LOAD = 60;   // metres along passages (fog hides ~30 m)
const KEEP = 85;   // hysteresis: unload only beyond this
const NEAR_WALL = 6;

function segDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const L2 = vx * vx + vy * vy + vz * vz || 1;
  let t = ((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / L2;
  t = Math.max(0, Math.min(1, t));
  const dx = ax + vx * t - px, dy = ay + vy * t - py, dz = az + vz * t - pz;
  return { d: Math.hypot(dx, dy, dz), t };
}

export class CaveStreamLayer {
  constructor(cave, { material, formMat, night = false } = {}) {
    this.name = "cave";
    this.cave = cave;
    this.material = material;
    this.formMat = formMat;
    this.smap = stationMap(cave);
    const { pieces } = prepareCavePieces(cave);
    this.pieces = pieces;
    // Formations: placement data only (deferred), plus all colliders.
    this.form = addFormations(new THREE.Group(), cave, formMat, null, { defer: true });
    this.obstacles = this.form.obstacles;
    this.cells = new Map();
    const cell = (x, y, z) => {
      const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
      if (!this.cells.has(key)) this.cells.set(key, { key, pieces: [], inst: {}, cx: (Math.floor(x / CELL) + 0.5) * CELL, cy: (Math.floor(y / CELL) + 0.5) * CELL, cz: (Math.floor(z / CELL) + 0.5) * CELL });
      return this.cells.get(key);
    };
    this.cellKey = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
    for (const pc of pieces) {
      cell(pc.x, pc.y, pc.z).pieces.push(pc);
      if (pc.kind === "leg") {
        const [a, b] = pc.stations.map((id) => stationWorld(this.smap.get(id)));
        pc.ax = a.x; pc.ay = a.y; pc.az = a.z; pc.bx = b.x; pc.by = b.y; pc.bz = b.z;
        const sa = this.smap.get(pc.stations[0]), sb = this.smap.get(pc.stations[1]);
        pc.half = Math.max(sa.left, sa.right, sa.up, sb.left, sb.right, sb.up);
        pc.len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      } else {
        const s = this.smap.get(pc.id);
        pc.half = Math.max(s.left, s.right, s.up) * 1.2;
      }
    }
    const v = new THREE.Vector3();
    for (const [type, items] of Object.entries(this.form.lists)) {
      for (const it of items) {
        v.setFromMatrixPosition(it.matrix);
        const c = cell(v.x, v.y, v.z);
        (c.inst[type] = c.inst[type] || []).push(it);
      }
    }
    // Cells holding only formations still need a piece-based gate: use their nearest piece.
    for (const c of this.cells.values()) {
      if (c.pieces.length) continue;
      let best = null, bd = Infinity;
      for (const pc of pieces) { const d = Math.hypot(pc.x - c.cx, pc.y - c.cy, pc.z - c.cz); if (d < bd) { bd = d; best = pc; } }
      c.proxy = best;
    }
    // Resident: tiny portal lights / markers (adding/removing lights would recompile shaders).
    this.resident = new THREE.Group();
    this.resident.name = "cave-resident";
    for (const o of portalObjects(cave, { night })) this.resident.add(o.obj);
    if (night) this.resident.traverse((o) => {
      if (o.isPointLight && o.color.getHex() === 0xb9d4ff) { o.color.set(0x7088b8); o.intensity = 4; }
      if (o.isMesh && o.material.map) { o.material.color.set(0x2a3450); }
    });
    // Graph for passage distances.
    this.adj = new Map();
    for (const leg of cave.legs) {
      const a = this.smap.get(leg.from), b = this.smap.get(leg.to);
      if (!a || !b) continue;
      const pa = stationWorld(a), pb = stationWorld(b);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      if (!this.adj.has(a.id)) this.adj.set(a.id, []);
      if (!this.adj.has(b.id)) this.adj.set(b.id, []);
      this.adj.get(a.id).push([b.id, d]);
      this.adj.get(b.id).push([a.id, d]);
    }
    this.gd = new Map();
    this.lastScanPos = new THREE.Vector3(1e9, 0, 0);
    this.lastResult = null;
    this.water = null;
  }

  /** Water stays resident (small, animated, shared materials) but is only drawn in loaded cells. */
  attachWater(waterGroup) {
    this.water = [];
    const v = new THREE.Vector3();
    waterGroup.updateMatrixWorld(true);
    for (const o of waterGroup.children) {
      if (o.geometry) { o.geometry.computeBoundingSphere(); v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld); } else v.copy(o.position);
      this.water.push({ obj: o, key: this.cellKey(v.x, v.y, v.z) });
      o.visible = false;
    }
  }

  _syncWater(manager) {
    if (!this.water) return;
    for (const w of this.water) w.obj.visible = manager.isLoaded(this.name, w.key);
  }

  _passageDistances(p) {
    // Seed Dijkstra from the closest leg (both ends, partial lengths).
    let best = null;
    for (const pc of this.pieces) {
      if (pc.kind !== "leg") continue;
      const r = segDist(p.x, p.y, p.z, pc.ax, pc.ay, pc.az, pc.bx, pc.by, pc.bz);
      if (!best || r.d < best.d) best = { pc, ...r };
    }
    const gd = new Map();
    if (!best) return { gd, leg: null };
    const heap = [[best.pc.stations[0], best.t * best.pc.len + best.d], [best.pc.stations[1], (1 - best.t) * best.pc.len + best.d]];
    while (heap.length) {
      heap.sort((a, b) => b[1] - a[1]);
      const [id, d] = heap.pop();
      if (gd.has(id) && gd.get(id) <= d) continue;
      gd.set(id, d);
      for (const [n, w] of this.adj.get(id) || []) if (!gd.has(n) || gd.get(n) > d + w) heap.push([n, d + w]);
    }
    return { gd, leg: best.pc };
  }

  pieceDistance(pc, p, gd, curLeg) {
    if (pc === curLeg) return 0;
    let g = Infinity;
    for (const id of pc.stations) g = Math.min(g, gd.get(id) ?? Infinity);
    if (pc.kind === "hub") g -= pc.half;
    // Standing next to a wall (e.g. parallel halls that overlap): load it even if the graph says far.
    const e = pc.kind === "leg"
      ? segDist(p.x, p.y, p.z, pc.ax, pc.ay, pc.az, pc.bx, pc.by, pc.bz).d - pc.half
      : Math.hypot(p.x - pc.x, p.y - pc.y, p.z - pc.z) - pc.half;
    if (e < NEAR_WALL) g = Math.min(g, Math.max(0, e));
    return Math.max(0, g);
  }

  scan(ctx) {
    const p = ctx.pos;
    if (this.lastResult && p.distanceToSquared(this.lastScanPos) < 0.6 * 0.6 && !ctx.force) {
      return this.lastResult;
    }
    this.lastScanPos.copy(p);
    const { gd, leg } = this._passageDistances(p);
    this.gd = gd;
    const want = new Map(), keep = new Set();
    const fx = ctx.dir ? ctx.dir.x : 0, fz = ctx.dir ? ctx.dir.z : 0;
    for (const c of this.cells.values()) {
      const list = c.pieces.length ? c.pieces : [c.proxy];
      let d = Infinity;
      for (const pc of list) d = Math.min(d, this.pieceDistance(pc, p, gd, leg));
      if (d <= KEEP) keep.add(c.key);
      if (d <= LOAD) {
        // Prefer cells ahead of where the player looks / moves.
        const dx = c.cx - p.x, dz = c.cz - p.z, n = Math.hypot(dx, dz) || 1;
        const ahead = (dx * fx + dz * fz) / n;
        want.set(c.key, d - (ahead > 0.3 ? 12 * ahead : 0));
      }
    }
    this.lastResult = { want, keep };
    return this.lastResult;
  }

  *build(key) {
    const c = this.cells.get(key);
    const group = new THREE.Group();
    group.name = "cell " + key;
    let tris = 0;
    if (c.pieces.length) {
      const buf = makePieceBuffer();
      for (const pc of c.pieces) { yield* pc.emit(buf); yield; }
      let T = performance.now();
      const geo = pieceBufferGeometry(buf);
      ensureBVH(geo); // mesh-accurate wall collision
      this._phase("geometry", T);
      tris += buf.indices.length / 3;
      for (const m of passageMeshes(geo, this.material)) group.add(m);
      group.children[1].userData.sharedGeometry = true; // backfill shares the front geometry
      yield;
    }
    let T2 = performance.now();
    for (const [type, items] of Object.entries(c.inst)) {
      const m = buildInstanced(this.form.geos[type], items, this.formMat);
      if (m) { m.name = type; group.add(m); tris += (this.form.geos[type].index ? this.form.geos[type].index.count / 3 : 0) * items.length; }
    }
    this._phase("instances", T2);
    yield;
    T2 = performance.now();
    const named = new THREE.Group();
    addNamedFeatures(named, this.cave, this.formMat, null, [], (x, y, z) => this.cellKey(x, y + 0.5, z) === key);
    for (const o of [...named.children]) {
      group.add(o);
      if (o.material && o.material !== this.formMat) o.userData.ownMaterial = true;
      const g = o.geometry; if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    this._phase("named", T2);
    const box = new THREE.Box3(new THREE.Vector3(c.cx - CELL / 2, c.cy - CELL / 2, c.cz - CELL / 2), new THREE.Vector3(c.cx + CELL / 2, c.cy + CELL / 2, c.cz + CELL / 2));
    return { obj: group, tris, bounds: box };
  }

  _phase(name, t0) {
    const ms = performance.now() - t0;
    this.phaseMax = this.phaseMax || {};
    if (!(this.phaseMax[name] > ms)) this.phaseMax[name] = +ms.toFixed(2);
  }

  onLoad() { this._dirtyWater = true; }
  onUnload() { this._dirtyWater = true; }
  postUpdate(manager) { if (this._dirtyWater) { this._dirtyWater = false; this._syncWater(manager); } }

  debugColor(key) { return 0x44ffaa; }

  get totalCells() { return this.cells.size; }
}
