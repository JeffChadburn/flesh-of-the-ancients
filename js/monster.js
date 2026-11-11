/**
 * The cave creature: an original, procedurally built pale, eyeless, long-limbed crawler.
 * AI: roam -> investigate (noise) -> chase (noise / torchlight in line of sight) -> lunge / attack,
 * stagger + flee when stabbed, brief lose-track, death. Navigates along the survey centerline
 * graph (Dijkstra over stations) and only moves directly toward the player at close range when
 * the straight line stays inside the passage volume, so it never clips through rock.
 */
import * as THREE from "three";
import { stationMap, stationWorld, neighborsOf } from "./cave-data.js";
import { queryVolume, STAND_EYE } from "./volume.js";

const SPEED = { roam: 1.25, investigate: 2.1, chase: 3.4, flee: 4.4, lunge: 7.2 };
const HEALTH = 3;

function mat(color, rough = 0.5) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true });
}
function bumpy(geo, amt, seed) {
  const p = geo.attributes.position;
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) {
      const h = Math.sin((p.getX(i) * 31.1 + p.getY(i) * 17.3 + p.getZ(i) * 47.9 + seed) * 9137.13);
      k = 1 + (h - Math.floor(h) - 0.5) * 2 * amt;
      cache.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function seg(len, r0, r1, m) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 6, 2);
  g.translate(0, -len / 2, 0);
  const pivot = new THREE.Group();
  pivot.add(new THREE.Mesh(bumpy(g, 0.12, len * 10), m));
  return pivot;
}

function buildModel() {
  const skin = mat(0xd6cdc2, 0.45);
  const dark = mat(0x5a4c46, 0.6);
  const root = new THREE.Group();
  root.name = "monster";
  const body = new THREE.Group();
  body.position.y = 0.78;
  root.add(body);
  const torso = new THREE.Mesh(bumpy(new THREE.SphereGeometry(0.34, 12, 9), 0.08, 1), skin);
  torso.scale.set(0.85, 0.7, 1.55);
  body.add(torso);
  // Spine ridge.
  for (let i = 0; i < 7; i++) {
    const v = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 4), skin);
    v.position.set(0, 0.23 - Math.abs(i - 3) * 0.015, -0.36 + i * 0.12);
    body.add(v);
  }
  const pelvis = new THREE.Mesh(bumpy(new THREE.SphereGeometry(0.22, 10, 8), 0.1, 2), skin);
  pelvis.position.set(0, -0.02, 0.48);
  body.add(pelvis);
  // Ribs showing.
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.012, 4, 10, Math.PI), skin);
    r.rotation.set(0, Math.PI / 2, Math.PI);
    r.position.set(0, 0.0, -0.2 + i * 0.1);
    r.scale.set(1, 0.8, 1);
    body.add(r);
  }
  const neck = new THREE.Group();
  neck.position.set(0, 0.12, -0.5);
  body.add(neck);
  const neckM = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.32, 6), skin);
  neckM.rotation.x = Math.PI / 2 + 0.4;
  neckM.position.set(0, 0.04, -0.12);
  neck.add(neckM);
  const head = new THREE.Group();
  head.position.set(0, 0.1, -0.3);
  neck.add(head);
  const skull = new THREE.Mesh(bumpy(new THREE.SphereGeometry(0.14, 10, 8), 0.07, 3), skin);
  skull.scale.set(0.9, 0.85, 1.65);
  head.add(skull);
  // Eyeless: shallow dark pits where eyes would be.
  for (const s of [-1, 1]) {
    const pit = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), dark);
    pit.scale.set(1.2, 0.6, 0.5);
    pit.position.set(s * 0.07, 0.04, -0.17);
    head.add(pit);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.05, -0.02);
  head.add(jaw);
  const jawM = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.26), skin);
  jawM.position.set(0, -0.02, -0.12);
  jaw.add(jawM);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.22), mat(0x2a0d0d, 0.8));
  mouth.position.set(0, -0.045, -0.13);
  head.add(mouth);
  const teethM = mat(0xe8e2cf, 0.3);
  for (let i = 0; i < 7; i++) {
    for (const up of [1, -1]) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.05, 4), teethM);
      tooth.rotation.x = up > 0 ? Math.PI : 0;
      const zz = -0.22 + i * 0.022, xx = (i % 2 ? 1 : -1) * 0.05;
      tooth.position.set(xx, up > 0 ? -0.03 : 0.0, zz);
      (up > 0 ? head : jaw).add(tooth);
    }
  }
  // Long arms (front) and reverse-jointed legs (back).
  const limbs = [];
  const mkLimb = (side, front) => {
    const hip = new THREE.Group();
    hip.position.set(side * (front ? 0.24 : 0.2), front ? 0.0 : -0.02, front ? -0.34 : 0.48);
    body.add(hip);
    const a = seg(front ? 0.62 : 0.5, 0.055, 0.04, skin);
    hip.add(a);
    const b = seg(front ? 0.66 : 0.55, 0.04, 0.025, skin);
    b.position.y = -(front ? 0.62 : 0.5);
    a.add(b);
    // Claws.
    for (let k = -1; k <= 1; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.012, front ? 0.14 : 0.09, 4), teethM);
      c.rotation.x = -Math.PI / 2 - 0.4;
      c.position.set(k * 0.025, -(front ? 0.66 : 0.55), -0.05);
      b.add(c);
    }
    limbs.push({ hip, a, b, side, front });
  };
  for (const s of [-1, 1]) { mkLimb(s, true); mkLimb(s, false); }
  return { root, body, neck, head, jaw, limbs, skin };
}

export class Monster {
  constructor(scene, cave, volume, rng = Math.random, opts = {}) {
    // kind "rat": the Act 1 rat-thing - smaller, longer, weaker (2 hits), a little slower, more teeth.
    this.kind = opts.kind || "crawler";
    this.maxHealth = this.kind === "rat" ? 2 : HEALTH;
    this.speedMul = this.kind === "rat" ? 0.82 : 1;
    this.scene = scene;
    this.cave = cave;
    this.volume = volume;
    this.rng = rng;
    this.smap = stationMap(cave);
    this.nbrs = neighborsOf(cave);
    this.nodes = cave.stations.map((s) => {
      const w = stationWorld(s);
      return { id: s.id, x: w.x, y: w.y - s.down, z: w.z, s };
    });
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.m = buildModel();
    if (this.kind === "rat") {
      this.m.root.scale.set(0.6, 0.52, 0.95);
      this.m.skin.color.set(0xe6d2c8);
      const teeth = mat(0xf2ead6, 0.3);
      for (let i = 0; i < 12; i++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.09, 4), teeth);
        const a = (i / 12) * Math.PI * 2;
        t.position.set(Math.cos(a) * 0.07, -0.03 + Math.sin(a) * 0.035, -0.24);
        t.rotation.x = -Math.PI / 2 + Math.sin(a) * 0.5; t.rotation.z = Math.cos(a) * 0.5;
        this.m.head.add(t);
      }
    }
    scene.add(this.m.root);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.state = "roam";
    this.health = this.maxHealth;
    this.path = [];
    this.target = null;
    this.lastKnown = null;
    this.lostTimer = 0;
    this.stateTime = 0;
    this.attackCd = 0;
    this.lungeT = 0;
    this.phase = 0;
    this.speedNow = 0;
    this.alive = true;
    this.deadTime = 0;
    this.heard = 0;
    this.seen = false;
    this.events = [];
    this.onHitPlayer = null;
    this.onKilled = null;
    this.voice = null;
    this.screamT = -1;
    this.hurtFlash = 0;
  }

  dispose() {
    this.scene.remove(this.m.root);
    this.m.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }

  _ev(e) { this.events.push(e); if (this.events.length > 60) this.events.shift(); }

  // ---------- graph helpers ----------
  nearestNode(p) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - p.x, (n.y - p.y) * 1.5, n.z - p.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  dijkstra(fromId) {
    const dist = new Map([[fromId, 0]]), prev = new Map(), done = new Set();
    const q = [fromId];
    while (q.length) {
      let bi = 0;
      for (let i = 1; i < q.length; i++) if (dist.get(q[i]) < dist.get(q[bi])) bi = i;
      const u = q.splice(bi, 1)[0];
      if (done.has(u)) continue;
      done.add(u);
      const nu = this.byId.get(u);
      for (const v of this.nbrs.get(u) || []) {
        const nv = this.byId.get(v);
        if (!nv) continue;
        const d = dist.get(u) + Math.hypot(nu.x - nv.x, nu.y - nv.y, nu.z - nv.z);
        if (d < (dist.get(v) ?? Infinity)) { dist.set(v, d); prev.set(v, u); q.push(v); }
      }
    }
    return { dist, prev };
  }
  /** Waypoints from the monster to a world point, via stations. */
  planTo(goal) {
    const a = this.nearestNode(this.pos), b = this.nearestNode(goal);
    if (!a || !b) { this.path = [goal.clone()]; return; }
    const { prev } = this.dijkstra(a.id);
    const ids = [];
    for (let id = b.id; id; id = prev.get(id)) { ids.unshift(id); if (id === a.id) break; }
    if (ids[0] !== a.id) { this.path = [goal.clone()]; return; }
    const pts = ids.map((id) => { const n = this.byId.get(id); return new THREE.Vector3(n.x, n.y, n.z); });
    // Skip the first node if we're already past it toward the second.
    if (pts.length > 1) {
      const d01 = pts[0].distanceTo(pts[1]);
      if (this.pos.distanceTo(pts[1]) < d01) pts.shift();
    }
    pts.push(goal.clone());
    this.path = pts;
  }

  /** Is the straight line from a to b inside the passage volume (a cheap line-of-sight test)? */
  clearLine(a, b, step = 1.0) {
    const d = a.distanceTo(b);
    const n = Math.max(2, Math.ceil(d / step));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      const q = queryVolume(this.volume, x, y, z, 0.15, 0.25);
      if (!q.inside || y < q.floor - 0.2 || y > q.ceil + 0.3) return false;
    }
    return true;
  }

  groundAt(x, z, yRef) {
    const q = queryVolume(this.volume, x, yRef + STAND_EYE, z, 0.3, 0.2);
    return { floor: q.floor, inside: q.inside };
  }

  spawnFar(playerPos, minDist = 40) {
    const start = this.nearestNode(playerPos);
    const { dist } = this.dijkstra(start.id);
    let max = 0;
    for (const v of dist.values()) max = Math.max(max, v);
    // far enough to be a surprise, but not so far (Carlsbad is ~1 km of passage) that it never finds you
    const lo = Math.min(minDist, max * 0.75), hi = lo + 75;
    const ok = (n) => n.s.kind !== "entrance" && n.s.kind !== "exit";
    let far = this.nodes.filter((n) => { const d = dist.get(n.id) ?? 0; return d >= lo && d <= hi && ok(n); });
    if (!far.length) far = this.nodes.filter((n) => (dist.get(n.id) ?? 0) >= lo && ok(n));
    const pick = (far.length ? far : this.nodes)[Math.floor(this.rng() * (far.length || this.nodes.length))];
    this.pos.set(pick.x, pick.y, pick.z);
    this.state = "roam";
    this.health = this.maxHealth;
    this.alive = true;
    this.path = [];
    this.m.root.visible = true;
    this.spawnNode = pick.id;
    this._ev({ e: "spawn", at: pick.id, graphDist: Math.round(dist.get(pick.id) || 0) });
    return pick.id;
  }

  setState(s) {
    if (s === this.state) return;
    this._ev({ e: "state", from: this.state, to: s });
    this.state = s;
    this.stateTime = 0;
    this.path = [];
  }

  /** Player stabbed it. */
  hit(fromPos, dmg = 1) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.hurtFlash = 1;
    this._ev({ e: "hit", health: this.health });
    if (this.health <= 0) {
      this.alive = false;
      this.state = "dead";
      this.deadTime = 0;
      this.voice?.death();
      this.onKilled?.();
      return true;
    }
    this.voice?.pain();
    this.setState("stagger");
    // Knock back a little, away from the player (inside the volume).
    const away = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(0.8);
    const np = this.pos.clone().add(away);
    if (this.clearLine(this.pos.clone().setY(this.pos.y + 0.6), np.clone().setY(np.y + 0.6), 0.4)) this.pos.copy(np);
    return true;
  }

  /**
   * player: { eye, feet, noise (0..1 loudness), torch (bool), dead }
   */
  update(dt, player) {
    const P = player.feet;
    const dist = Math.hypot(P.x - this.pos.x, (P.y - this.pos.y) * 0.8, P.z - this.pos.z);
    this.distToPlayer = dist;
    this.stateTime += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    if (this.state === "dead") { this.deadTime += dt; this._animate(dt, 0); return; }

    // --- Perception ---
    // Hearing: loudness sets the range (running ~38 m, walking ~15 m, crouch ~6 m, crawl ~4 m).
    const hearRange = player.noise * 38;
    const heard = !player.dead && hearRange > 0 && dist < hearRange;
    // Sight: it senses the torch's light and heat when there's a clear line within torch reach.
    let seen = false;
    if (!player.dead && player.torch && dist < 17 && (this._losT = (this._losT || 0) - dt) <= 0) {
      this._losT = 0.25;
      this._los = this.clearLine(new THREE.Vector3(this.pos.x, this.pos.y + 0.7, this.pos.z), player.eye.clone(), 0.9);
    }
    if (!player.dead && player.torch && dist < 17) seen = !!this._los; else this._los = false;
    this.heard = heard; this.seen = seen;

    const v = this.voice;
    switch (this.state) {
      case "roam":
        if (seen || (heard && dist < hearRange * 0.45)) { this._startChase(P); break; }
        if (heard) { this.lastKnown = P.clone(); this.setState("investigate"); v?.clicks(0.9); break; }
        if (!this.path.length) {
          // it is hunting: most roam goals are somewhere in the player's general area
          const me = this.pos;
          let pool = this.rng() < 0.7
            ? this.nodes.filter((k) => Math.hypot(k.x - P.x, k.z - P.z) < 40 && Math.abs(k.y - P.y) < 25)
            : this.nodes.filter((k) => Math.hypot(k.x - me.x, k.y - me.y, k.z - me.z) < 50);
          if (!pool.length) pool = this.nodes;
          const n = pool[Math.floor(this.rng() * pool.length)];
          this.planTo(new THREE.Vector3(n.x, n.y, n.z));
        }
        if (this.rng() < dt / 7) v?.wail();
        if (this.rng() < dt / 6) v?.clicks(0.4);
        break;
      case "investigate":
        if (seen || (heard && dist < 12)) { this._startChase(P); break; }
        if (heard) this.lastKnown = P.clone();
        if (!this.path.length || this.stateTime > 3 && heard) this.planTo(this.lastKnown || P);
        if (this.lastKnown && this.pos.distanceTo(this.lastKnown) < 2 && this.stateTime > 2) { this.setState("roam"); }
        if (this.stateTime > 30) this.setState("roam");
        v?.clicks(1);
        break;
      case "chase":
        if (player.dead) { this.setState("roam"); break; }
        if (seen || heard) { this.lastKnown = P.clone(); this.lostTimer = 0; }
        else this.lostTimer += dt;
        if (this.lostTimer > 4.5) { this._ev({ e: "lostTrack" }); this.setState("investigate"); break; }
        if (dist < 3.4 && this.attackCd <= 0 && seen) { this.setState("lunge"); this.lungeT = 0; v?.growl(); break; }
        if (dist < 7) v?.growl(); else v?.clicks(1);
        break;
      case "lunge":
        this.lungeT += dt;
        if (this.lungeT > 0.42) {
          if (dist < 1.9 && !player.dead) {
            this._ev({ e: "attack", hit: true });
            this.onHitPlayer?.();
          } else this._ev({ e: "attack", hit: false });
          this.attackCd = 1.6;
          this.setState("chase");
        }
        break;
      case "stagger":
        if (this.stateTime > 0.65) this.setState("flee");
        break;
      case "flee":
        if (!this.path.length) {
          // Run to a node well away from the player.
          let best = null, bd = -1;
          const here = this.nearestNode(this.pos);
          const { dist: dd } = this.dijkstra(here.id);
          for (const n of this.nodes) {
            const g = dd.get(n.id) ?? Infinity;
            if (g > 45 || g < 8) continue;
            const away = Math.hypot(n.x - P.x, n.z - P.z);
            if (away > bd) { bd = away; best = n; }
          }
          if (best) this.planTo(new THREE.Vector3(best.x, best.y, best.z));
        }
        if (this.stateTime > 3.8) { this.lastKnown = P.clone(); this.setState("investigate"); v?.wail(); }
        break;
    }

    // --- Movement ---
    let speed = (SPEED[this.state] || 0) * this.speedMul;
    if (this.state === "stagger") speed = 0;
    let goal = null;
    const direct = (this.state === "chase" || this.state === "lunge") && dist < 9 && this._los;
    if (this.state === "lunge") { speed = (this.lungeT < 0.3 ? SPEED.lunge : 0.5) * this.speedMul; goal = P; }
    else if (this.state === "chase") {
      if (direct) goal = P;
      else {
        if (!this.path.length || (this._replan = (this._replan || 0) - dt) <= 0) { this._replan = 0.6; this.planTo(this.lastKnown || P); }
      }
    }
    if (!goal && this.path.length) {
      goal = this.path[0];
      if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < 0.9) { this.path.shift(); goal = this.path[0] || null; }
    }
    if (goal && speed > 0) {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const stopAt = (this.state === "chase" || this.state === "lunge") && goal === P ? 1.15 : 0;
      if (d > stopAt + 0.01) {
        const stepLen = Math.min(d - stopAt, speed * dt);
        const nx = this.pos.x + (dx / d) * stepLen, nz = this.pos.z + (dz / d) * stepLen;
        const g = this.groundAt(nx, nz, this.pos.y);
        if (g.inside || !direct) {
          this.pos.x = nx; this.pos.z = nz;
          this.pos.y += (g.floor - this.pos.y) * Math.min(1, dt * 10);
        } else this.path = [];
        this.speedNow = stepLen / Math.max(dt, 1e-4);
      } else this.speedNow = 0;
      const want = Math.atan2(-dx, -dz);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yaw += dy * Math.min(1, dt * (this.state === "lunge" ? 14 : 6));
    } else this.speedNow = 0;
    if (this.state === "chase" || this.state === "lunge") {
      // Always face the player when close.
      if (dist < 6) this.yaw = Math.atan2(-(P.x - this.pos.x), -(P.z - this.pos.z));
    }
    this._animate(dt, this.speedNow);
  }

  _startChase(P) {
    this.lastKnown = P.clone();
    this.lostTimer = 0;
    const wasHunting = this.state === "chase";
    this.setState("chase");
    if (!wasHunting) {
      this.screamT = 0;
      this.voice?.scream();
      this._ev({ e: "spotted" });
    }
  }

  _animate(dt, speed) {
    const m = this.m;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    this.phase += dt * (1.5 + speed * 2.2);
    const ph = this.phase;
    const amp = Math.min(1, speed / 3);
    if (this.state === "dead") {
      const k = Math.min(1, this.deadTime / 0.9);
      m.body.rotation.z = k * 1.3;
      m.body.position.y = 0.78 - k * 0.5;
      m.jaw.rotation.x = 0.7;
      for (const l of m.limbs) { l.a.rotation.x = 0.4 * k; l.b.rotation.x = -0.8 * k; }
      return;
    }
    // Hunched crawl; rears up briefly when it screams / gets stabbed.
    if (this.screamT >= 0) { this.screamT += dt; if (this.screamT > 1.4) this.screamT = -1; }
    const rear = this.screamT >= 0 ? Math.sin(Math.PI * Math.min(1, this.screamT / 1.4)) : 0;
    const stag = this.state === "stagger" ? 1 : 0;
    m.body.rotation.x = -0.12 + rear * 0.55 + stag * 0.35 + Math.sin(ph * 2) * 0.03 * amp;
    m.body.position.y = 0.72 + Math.abs(Math.sin(ph)) * 0.05 * amp + rear * 0.15 - (this.state === "lunge" ? 0.12 : 0);
    m.body.rotation.z = Math.sin(ph) * 0.05 * amp + stag * Math.sin(this.stateTime * 30) * 0.12;
    m.neck.rotation.x = -0.25 + rear * -0.5 + Math.sin(ph * 0.7) * 0.08;
    m.head.rotation.z = Math.sin(this.stateTime * 3.1) * 0.15 * (this.state === "investigate" ? 1 : 0.3);
    m.jaw.rotation.x = Math.max(rear * 0.9, this.state === "lunge" ? 0.8 : 0.08 + 0.06 * Math.sin(ph * 3));
    for (const l of m.limbs) {
      // Diagonal pairs move together.
      const off = (l.side > 0) === l.front ? 0 : Math.PI;
      const s = Math.sin(ph + off);
      if (l.front) {
        l.a.rotation.x = 0.55 + s * 0.55 * amp + rear * 0.6;
        l.b.rotation.x = -0.95 + Math.max(0, -Math.cos(ph + off)) * 0.5 * amp;
        l.a.rotation.z = l.side * 0.25;
      } else {
        l.a.rotation.x = -0.6 + s * 0.45 * amp;
        l.b.rotation.x = 1.2 - Math.max(0, Math.cos(ph + off)) * 0.4 * amp;
        l.a.rotation.z = l.side * 0.15;
      }
    }
    // Pale skin flushes when hurt.
    m.skin.emissive.setRGB(this.hurtFlash * 0.5, 0, 0);
  }
}
