/**
 * Bow and arrows: arrows are simple ballistic projectiles (gravity, no drag) stepped in small
 * substeps. They hit overworld animals, cave fauna and the monster, and stick into terrain /
 * cave rock (BVH raycast against the rendered passages) or vanish after a while. Unlimited arrows.
 */
import * as THREE from "three";

const SPEED = 40, GRAVITY = 7.5, LIFE = 4, STUCK_LIFE = 25, MAX_STUCK = 24;
const rc = new THREE.Raycaster();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpD = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, -1);

function arrowGeometry() {
  const shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.78, 5); shaft.rotateX(Math.PI / 2);
  const tip = new THREE.ConeGeometry(0.02, 0.07, 4); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -0.42);
  const f1 = new THREE.BoxGeometry(0.003, 0.05, 0.12); f1.translate(0, 0, 0.33);
  const f2 = new THREE.BoxGeometry(0.05, 0.003, 0.12); f2.translate(0, 0, 0.33);
  const parts = [shaft, tip, f1, f2].map((g) => (g.index ? g.toNonIndexed() : g));
  const pos = [], col = [];
  const cols = [[0.55, 0.4, 0.25], [0.35, 0.33, 0.3], [0.85, 0.82, 0.75], [0.85, 0.82, 0.75]];
  parts.forEach((g, i) => { pos.push(...g.attributes.position.array); for (let k = 0; k < g.attributes.position.count; k++) col.push(...cols[i]); });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

export class Archery {
  constructor(scene) {
    this.scene = scene;
    this.geo = arrowGeometry();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.flying = []; this.stuck = [];
    this.shots = 0; this.hits = 0;
    this.log = [];
  }

  _mesh() { const m = new THREE.Mesh(this.geo, this.mat); m.userData.sharedGeometry = true; this.scene.add(m); return m; }

  shoot(origin, dir) {
    const d = dir.clone().normalize();
    const a = { pos: origin.clone(), vel: d.multiplyScalar(SPEED), t: 0, mesh: this._mesh() };
    this._orient(a);
    this.flying.push(a); this.shots++;
    return a;
  }

  _orient(a) { a.mesh.position.copy(a.pos); tmpD.copy(a.vel).normalize(); a.mesh.quaternion.setFromUnitVectors(Z, tmpD); }

  _stick(a, p) {
    a.pos.copy(p); this._orient(a); a.mesh.position.addScaledVector(tmpD, 0.12); // tip buried
    a.t = 0; this.stuck.push(a);
    if (this.stuck.length > MAX_STUCK) this._remove(this.stuck.shift());
  }

  _remove(a) { this.scene.remove(a.mesh); }

  /** ctx: { terrain (overworld) | meshes (cave), targets(p) -> hit or null } */
  update(dt, ctx) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const a = this.flying[i];
      a.t += dt;
      let done = false;
      const steps = Math.max(1, Math.ceil((SPEED * dt) / 0.25));
      for (let s = 0; s < steps && !done; s++) {
        const h = dt / steps;
        tmpA.copy(a.pos);
        a.vel.y -= GRAVITY * h;
        a.pos.addScaledVector(a.vel, h);
        // creatures first (sampled along the step)
        for (const f of [0.5, 1]) {
          tmpB.copy(tmpA).lerp(a.pos, f);
          const hit = ctx.targets(tmpB, a);
          if (hit) { this.hits++; this.log.push({ e: "hit", what: hit }); this._remove(a); done = true; break; }
        }
        if (done) break;
        if (ctx.terrain) {
          const g = ctx.terrain.height(a.pos.x, a.pos.z);
          if (a.pos.y < g) { this._stick(a, tmpB.set(a.pos.x, g + 0.02, a.pos.z)); this.log.push({ e: "ground" }); done = true; }
        } else if (ctx.meshes && ctx.meshes.length) {
          tmpD.subVectors(a.pos, tmpA); const len = tmpD.length();
          if (len > 1e-5) {
            rc.set(tmpA, tmpD.multiplyScalar(1 / len)); rc.near = 0; rc.far = len;
            const h2 = rc.intersectObjects(ctx.meshes, false)[0];
            if (h2) { this._stick(a, h2.point); this.log.push({ e: "wall" }); done = true; }
          }
        }
      }
      if (done) { this.flying.splice(i, 1); continue; }
      if (a.t > LIFE) { this._remove(a); this.flying.splice(i, 1); continue; }
      this._orient(a);
    }
    for (let i = this.stuck.length - 1; i >= 0; i--) { const a = this.stuck[i]; a.t += dt; if (a.t > STUCK_LIFE) { this._remove(a); this.stuck.splice(i, 1); } }
  }

  clear() { for (const a of [...this.flying, ...this.stuck]) this._remove(a); this.flying = []; this.stuck = []; }
  stats() { const f = this.flying[0]; return { f0: f && { p: f.pos.toArray().map((v) => +v.toFixed(2)), v: f.vel.toArray().map((v) => +v.toFixed(2)) }, flying: this.flying.length, stuck: this.stuck.length, shots: this.shots, hits: this.hits, last: this.log.slice(-5) }; }
}
