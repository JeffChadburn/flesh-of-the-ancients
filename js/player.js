/** First-person walking, mouse look, touch joystick, and passage-volume collision. */

import * as THREE from "three";
import { stationMap, stationWorld } from "./cave-data.js";
import { clamp } from "./rng.js";
import {
  buildVolume, constrainToVolume, pointInside, queryVolume,
  PLAYER_RADIUS, STAND_EYE, GRAVITY, STEP_UP,
  STANCES, MOUNTED, stanceHeight, canFitStance, clearanceAhead, requiredStanceAt,
} from "./volume.js";

export class Player {
  constructor(camera, cave, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.travelling = 0;
    this.keys = new Set();
    this.enabled = false;
    this.isTouch = isTouchDevice();
    this.joy = { dx: 0, dy: 0, mag: 0, active: false };
    // Analog movement: current eased speed, its fraction of walk/run, head-bob phase, footsteps.
    this.speedNow = 0;
    this.runFrac = 0;
    this.speedTarget = 0;
    this.bobPhase = 0;
    this.bobY = 0;
    this.onStep = null;
    this.lookTouch = null;
    // Round 25e: one-finger steering (phones): stick left/right turns Kra + camera, forward/back moves;
    // a drag elsewhere free-looks (camOff) and eases back behind Kra after ~1.5 s of moving.
    this.oneFinger = false; this.fpView = false; this.camOff = 0; this._lookAt = -99; this._clock = 0;
    this.foundExit = false;
    this.onExit = null;
    this.lastValid = new THREE.Vector3();
    this.rescues = 0;
    this.volume = null;
    this.stance = "stand";
    this.ahead = "stand";
    this.blockedLow = false;
    this.onStance = null;
    this.terrain = null;
    if (cave) this.setCave(cave);
    this._bind();
  }

  /**
   * Overworld: walk on a heightfield (terrain.constrain / terrain.height) instead of a cave
   * volume. No ceilings, no stance limits; obstacles (trees, rocks, outcrops) come from
   * the terrain's resident scatter data, never from meshes.
   */
  setTerrain(terrain, x, z, yaw = 0) {
    this.terrain = terrain;
    this.mounted = false; this.jumping = false; this.jumpBuf = 0; this.boating = false;
    this.cave = null;
    this.smap = new Map();
    this.volume = null;
    this.foundExit = false;
    this.vy = 0;
    this.rescues = 0;
    this.stance = "stand";
    this.ahead = "stand";
    this.blockedLow = false;
    this.yaw = yaw;
    this.pitch = -0.05;
    this.camera.position.set(x, terrain.height(x, z) + STANCES.stand.eye, z);
    this.lastValid.copy(this.camera.position);
    this.groundEye = null;
    this.grounded = true;
    this.applyLook();
    if (this.onStance) this.onStance(this.stance);
  }

  _constrain(proposed, from, radius, st) {
    return this.terrain ? this.terrain.constrain(proposed, from, radius, st) : constrainToVolume(this.volume, proposed, from, radius, st);
  }

  setCave(cave, obstacles = null) {
    this.terrain = null;
    this.cave = cave;
    this.smap = stationMap(cave);
    this.volume = buildVolume(cave, obstacles || []);
    this.foundExit = false;
    this.travelling = 0;
    this.vy = 0;
    this.rescues = 0;
    this.stance = "stand";
    this.ahead = "stand";
    this.blockedLow = false;
    this.spawnAtEntrance();
    if (this.onStance) this.onStance(this.stance);
  }

  setObstacles(obstacles) {
    if (this.volume) this.volume.obstacles = obstacles ? obstacles.slice() : [];
  }

  /** Round 12: request a jump (applied on the next update if standing / mounted on the ground). */
  jump() { this.jumpBuf = 0.16; } // round 13: buffered, so a tap just before landing still jumps

  stanceDef() {
    if (this.mounted) return MOUNTED;
    return STANCES[this.stance] || STANCES.stand;
  }

  canUseStance(name) {
    if (this.terrain || !this.volume) return true;
    const p = this.camera.position;
    return canFitStance(this.volume, p.x, p.y, p.z, name);
  }

  setStance(name, { toggle = false } = {}) {
    if (!STANCES[name]) return false;
    if ((this.mounted || this.boating) && name !== "stand") return false; // get off the horse (or out of the boat) first
    if (toggle && this.stance === name) {
      // Rise as high as the current ceiling allows.
      if (name === "crawl") name = this.canUseStance("crouch") ? "crouch" : "crawl";
      else if (name === "crouch") name = this.canUseStance("stand") ? "stand" : "crouch";
    }
    if (name !== this.stance && (name === "stand" || name === "crouch") && !this.canUseStance(name)) {
      return false;
    }
    if (this.stance === name) return true;
    this.stance = name;
    const q = this.volume ? queryVolume(this.volume, this.camera.position.x, this.camera.position.y, this.camera.position.z, STANCES[name].radius, 0.1) : null;
    const floor = this.terrain ? this.terrain.height(this.camera.position.x, this.camera.position.z) : q ? q.floor : this.camera.position.y - STANCES[name].eye;
    this.camera.position.y = floor + STANCES[name].eye;
    this.lastValid.copy(this.camera.position);
    this.groundEye = null;
    this.grounded = true;
    this.vy = 0;
    if (this.onStance) this.onStance(this.stance);
    return true;
  }

  spawnAtEntrance() {
    const id = this.cave.entranceId || this.cave.stations[0]?.id;
    const s = this.smap.get(id);
    if (!s) return;
    const p = stationWorld(s);
    // Face along the first leg into the cave.
    const leg = this.cave.legs.find((l) => l.from === id || l.to === id);
    let dir = new THREE.Vector3(0, 0, -1);
    if (leg) {
      const other = this.smap.get(leg.from === id ? leg.to : leg.from);
      const q = stationWorld(other);
      dir.set(q.x - p.x, 0, q.z - p.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      else dir.normalize();
    }
    this.yaw = Math.atan2(-dir.x, -dir.z);
    if (leg) {
      const other = this.smap.get(leg.from === id ? leg.to : leg.from);
      const q = stationWorld(other);
      const horiz = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      this.pitch = clamp(Math.atan2(q.y - p.y, horiz) + 0.04, -1.1, 1.1);
    } else {
      this.pitch = 0.08;
    }
    this.stance = "stand";
    const eye = STANCES.stand.eye;
    // Round 10: start a few metres inside the mouth (not on its lip), so the chase camera has rock
    // behind it instead of the open entrance and the void beyond.
    let sx = p.x, sy = p.y - s.down, sz = p.z;
    if (leg) {
      const other = this.smap.get(leg.from === id ? leg.to : leg.from);
      const q = stationWorld(other);
      const L = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) || 1;
      const t = Math.min(3.2, L * 0.4) / L;
      sx = p.x + (q.x - p.x) * t; sz = p.z + (q.z - p.z) * t;
      sy = (p.y - s.down) + ((q.y - other.down) - (p.y - s.down)) * t;
    }
    this.camera.position.set(sx, sy + eye, sz);
    this.travelling = 0;
    this.lastValid.copy(this.camera.position);
    this.groundEye = null;
    this.grounded = true;
    this.applyLook();
  }

  placeAlongMainPath(t, pathIds) {
    const ids = pathIds && pathIds.length ? pathIds : this.cave.stations.map((s) => s.id);
    if (ids.length < 2) return;
    const f = clamp(t, 0, 0.999);
    const target = Math.floor(f * (ids.length - 1));
    // Prefer a reasonably long, not-too-steep passage near the requested point.
    let bestI = Math.min(target, ids.length - 2);
    let bestScore = -Infinity;
    const lo = Math.max(1, target - 6);
    const hi = Math.min(ids.length - 2, target + 6);
    for (let i = lo; i <= hi; i++) {
      const a = this.smap.get(ids[i]);
      const b = this.smap.get(ids[i + 1]);
      if (!a || !b) continue;
      const pa = stationWorld(a);
      const pb = stationWorld(b);
      const horiz = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      const len = Math.hypot(horiz, pb.y - pa.y);
      const slope = Math.abs(Math.atan2(pb.y - pa.y, horiz || 1));
      const width = (a.left + a.right + b.left + b.right) / 4;
      if (len < 2.4) continue;
      const tight = (a.clearance === "crawl" || b.clearance === "crawl") ? 3 : (a.clearance === "crouch" || b.clearance === "crouch") ? 1.2 : 0;
      const score = len - slope * 8 - Math.abs(width - 1.4) * 0.4 - Math.abs(i - target) * 0.15 - tight;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    const a = this.smap.get(ids[bestI]);
    const b = this.smap.get(ids[Math.min(bestI + 1, ids.length - 1)]);
    const pa = stationWorld(a);
    const pb = stationWorld(b);
    const local = 0.45;
    const pos = {
      x: pa.x + (pb.x - pa.x) * local,
      y: pa.y + (pb.y - pa.y) * local,
      z: pa.z + (pb.z - pa.z) * local,
    };
    const down = a.down + (b.down - a.down) * local;
    const up = a.up + (b.up - a.up) * local;
    const need = (a.clearance === "crawl" || b.clearance === "crawl") ? "crawl" : (a.clearance === "crouch" || b.clearance === "crouch") ? "crouch" : "stand";
    this.stance = need;
    const eye = STANCES[this.stance].eye;
    this.camera.position.set(pos.x, pos.y - down + eye, pos.z);
    const dir = new THREE.Vector3(pb.x - pa.x, 0, pb.z - pa.z);
    if (dir.lengthSq() > 1e-6) {
      dir.normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
    }
    const horiz = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
    this.pitch = clamp(Math.atan2(pb.y - pa.y, horiz) + 0.05, -1.1, 1.1);
    this.travelling = 0;
    this.vy = 0;
    this.lastValid.copy(this.camera.position);
    this.groundEye = null;
    this.grounded = true;
    this.applyLook();
  }

  lookAtPoint(x, y, z) {
    const p = this.camera.position;
    const dx = x - p.x;
    const dy = y - p.y;
    const dz = z - p.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz) || 1), -1.2, 1.2);
    this.applyLook();
  }

  placeWorld(x, y, z) {
    if (this.terrain) {
      this.camera.position.set(x, this.terrain.height(x, z) + this.stanceDef().eye, z);
      this.lastValid.copy(this.camera.position);
      this.groundEye = null; this.grounded = true; this.vy = 0; this.jumping = false;
      this.applyLook();
      return;
    }
    const proposed = new THREE.Vector3(x, y, z);
    const need = this.volume ? requiredStanceAt(this.volume, x, y, z) : "stand";
    const ranks = { stand: 0, crouch: 1, crawl: 2 };
    if ((ranks[need] || 0) > (ranks[this.stance] || 0)) {
      this.stance = need;
      if (this.onStance) this.onStance(this.stance);
    }
    const st = STANCES[this.stance] || STANCES.stand;
    // Use the target as "previous" so a teleport is not snapped back to the last room.
    const resolved = constrainToVolume(this.volume, proposed, proposed, st.radius, st);
    const yy = resolved._floor + resolved._eye;
    this.camera.position.set(resolved.x, yy, resolved.z);
    this.lastValid.copy(this.camera.position);
    this.groundEye = null;
    this.grounded = true;
    this.vy = 0;
    this.applyLook();
  }

  applyLook() {
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw + (this.camOff || 0);
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  look(dyaw, dpitch) {
    this.yaw -= dyaw;
    this.pitch = clamp(this.pitch - dpitch, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08);
    this.applyLook();
  }

  /**
   * Joystick deflection (0..~1.2, 1 = ring edge) -> target speed.
   * Deadzone 0.12; 0.12..0.85 eases from a slow creep up to full walk;
   * 0.85..1.05 (at / past the edge) blends from walk into a run. Crouch / crawl stay capped.
   */
  static joySpeed(mag, st) {
    // Round 17: one smooth analog curve over the whole ring. Deadzone 0.1; the inner ~half is a
    // slow walk easing up to a normal walk, the outer half ramps from walk through jog to a full
    // run at the edge (1.0+). Crouch / crawl have sprint == speed so they just scale 25%..100%.
    if (mag < 0.1) return 0;
    const u = Math.min(1, (mag - 0.1) / 0.9);
    if (u <= 0.5) { const w = u / 0.5; return st.speed * (0.25 + 0.75 * w * w * (3 - 2 * w)); }
    const r = (u - 0.5) / 0.5;
    return st.speed + Math.max(0, st.sprint - st.speed) * Math.pow(r, 1.35);
  }
  /** Round 17: desktop pace (1 walk / 2 jog / 3 run) for WASD; Shift is always a full run. */
  static paceSpeed(pace, st) {
    const f = pace >= 3 ? 1 : pace === 2 ? 0.4 : 0;
    return st.speed + Math.max(0, st.sprint - st.speed) * f;
  }
  setPace(p) {
    this.pace = Math.max(1, Math.min(3, p | 0));
    this.onPace?.(this.pace);
    return this.pace;
  }
  /** Round 17: a connected gamepad's left stick moves (analog), right stick looks. */
  _pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find((x) => x && x.connected);
    if (!g) { this.pad = null; return; }
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    const lx = dz(g.axes[0] || 0), ly = dz(g.axes[1] || 0), rx = dz(g.axes[2] || 0), ry = dz(g.axes[3] || 0);
    const run = !!(g.buttons[10]?.pressed || (g.buttons[7]?.value || 0) > 0.5);
    this.pad = { dx: lx, dy: ly, mag: Math.min(1, Math.hypot(lx, ly)), run };
    if (rx || ry) this.look(rx * 2.6 * dt, ry * 2.0 * dt);
  }

  update(dt, wishOverride = null) {
    this.camera.position.y -= this.bobY;
    this.bobY = 0;
    const wish = new THREE.Vector3();
    if (wishOverride) {
      wish.x = wishOverride.x || 0;
      wish.z = wishOverride.z || 0;
    } else {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) wish.z -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) wish.z += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) wish.x -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) wish.x += 1;
    }
    const st = this.mounted ? MOUNTED : STANCES[this.stance] || STANCES.stand;
    const keyMove = wish.lengthSq() > 1e-4;
    const sprint = !wishOverride && (this.stance === "stand" || this.mounted) && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
    let target = 0;
    if (!wishOverride) this._pollPad(dt);
    if (keyMove) {
      wish.normalize();
      target = sprint ? st.sprint : Player.paceSpeed(this.pace || 1, st);
    } else if (!wishOverride && this.joy.active && this.joy.mag >= 0.1 && this.oneFinger) {
      // Round 25e: one-finger steering. Sideways deflection = turn rate (eased curve, scales with the
      // push), the forward/back part = speed. Pure sideways = turn on the spot.
      const m = this.joy.mag, dx = this.joy.dx, dy = this.joy.dy, dz = 0.12;
      const ax = Math.max(0, (Math.abs(dx) - dz) / (1 - dz));
      const rate = (this.mounted ? 1.9 : 2.4) * Math.pow(ax, 1.4) * Math.sign(dx);
      this.yaw -= rate * dt; this.applyLook();
      const fwd = -dy;
      // Hotfix: after a free-look drag, pushing forward walks where the camera looks. Kra turns to the
      // camera heading quickly (~0.1 s) while the camera stays put (camOff folds into yaw), and keeps
      // following a look drag made while walking.
      if (fwd > 0.2 && this.camOff) {
        const k = Math.abs(this.camOff) < 0.01 ? 1 : Math.min(1, dt * 14);
        const d = this.camOff * k;
        this.yaw += d; this.camOff -= d; if (Math.abs(this.camOff) < 1e-4) this.camOff = 0;
        this.applyLook();
      }
      if (Math.abs(fwd) > 0.2) {
        wish.set(0, 0, -Math.sign(fwd));
        target = Player.joySpeed(Math.min(1.2, m * Math.min(1, Math.abs(fwd) * 1.25)), st);
        if (fwd < 0) target = Math.min(target, st.speed * 0.6); // backing up: a careful walk
      }
    } else if (!wishOverride && this.joy.active && this.joy.mag >= 0.1) {
      wish.set(this.joy.dx, 0, this.joy.dy).normalize();
      target = Player.joySpeed(this.joy.mag, st);
    } else if (!wishOverride && this.pad && this.pad.mag > 0) {
      wish.set(this.pad.dx, 0, this.pad.dy).normalize();
      target = Player.joySpeed(0.1 + this.pad.mag * 0.9, st);
      if (this.pad.run) target = Math.min(st.sprint, target * (st.sprint / st.speed)); // run button multiplies the analog speed
    }
    if (wishOverride) target = st.speed;
    if (this.sprintAllowed === false && !this.mounted && target > st.speed) target = st.speed; // exhausted: no running
    // Round 18: wading slows you, swimming more so (no running in deep water).
    if (this.terrain && this.water > 0.3) target = Math.min(target, this.water > 1.1 ? (this.mounted ? 3.2 : 1.5) : Math.min(target * 0.55 + 0.5, this.mounted ? 6 : 4));
    this.speedTarget = target;
    // Smooth easing: speed up over ~0.3 s, stop a little quicker.
    const k = target > this.speedNow ? 7 : 11;
    this.speedNow += (target - this.speedNow) * Math.min(1, dt * k);
    if (this.speedNow > st.sprint) this.speedNow = st.sprint; // stance caps (crouch / crawl)
    if (target === 0 && this.speedNow < 0.03) this.speedNow = 0;
    if (target > 0) this._wishDir = wish.clone();
    else if (this._wishDir) wish.copy(this._wishDir);
    const moving = this.speedNow > 0.001 && wish.lengthSq() > 1e-4;
    const speed = this.speedNow;
    this.runFrac = st.sprint > st.speed ? Math.max(0, Math.min(1, (speed - st.speed) / (st.sprint - st.speed))) : 0;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const delta = new THREE.Vector3();
    if (moving) {
      delta.addScaledVector(right, wish.x * speed * dt);
      delta.addScaledVector(forward, -wish.z * speed * dt);
    }

    const from = this.camera.position.clone();
    const attempt = (d, squeeze = false) => {
      const proposed = from.clone().add(d);
      let resolved = this._constrain(proposed, from, st.radius, st);
      // round 13 diagnostics: what shortened this step (volume / rendered wall / guard / step-up)
      let block = null;
      if (d.lengthSq() > 1e-8 && Math.hypot(resolved.x - proposed.x, resolved.z - proposed.z) > d.length() * 0.5) block = "vol";
      // Caves: clamp against the rendered rock too, so you can never walk through a visible wall.
      if (!this.terrain && this.walls && (resolved.x !== from.x || resolved.z !== from.z)) {
        // squeeze (round 13 unstick): the passage volume says it fits, so test the rock with a much
        // thinner body (brush past a lump); the guard below still never lets you cross a wall.
        const w = this.walls.resolve(from, resolved, resolved._floor, resolved._ceil, squeeze ? { ...st, radius: (st.radius || 0.28) * 0.4 } : st);
        if (w.hit || w.x !== resolved.x || w.z !== resolved.z) {
          if (Math.hypot(w.x - resolved.x, w.z - resolved.z) > d.length() * 0.5) block = "wall";
          const again = this._constrain(new THREE.Vector3(w.x, proposed.y, w.z), from, st.radius, st);
          if (again._inside) resolved = again; else { resolved.x = from.x; resolved.z = from.z; }
        }
        // Final guard: never end a step on the far side of a visible wall.
        if (this.walls.crosses(from, resolved, Math.min(resolved._floor, from.y - st.eye), st)
          || (this.grounded === false && this.walls.crosses(from, resolved, from.y - st.eye, st))) { resolved.x = from.x; resolved.z = from.z; block = "guard"; }
      }
      return { resolved, block };
    };
    let { resolved, block } = attempt(delta);
    const lowBlock = !!resolved._blockedLow; // a low roof: crouch / crawl is the answer, not a nudge
    this.lastBlock = block;
    // Round 13: slide instead of stopping. When the straight move is mostly blocked (a wall met at an
    // angle, a corner, a low lip), try the same step turned 30 / 55 / 80 degrees either way, shortened
    // by the cosine, and keep whichever makes the most progress in the wanted direction.
    const dl = delta.length();
    if (dl > 1e-5) { // round 19: outdoors too (a trunk / boulder met head-on slides you round it)
      const prog = (r) => ((r.x - from.x) * delta.x + (r.z - from.z) * delta.z) / dl;
      let best = prog(resolved);
      const lastG = this.groundEye != null ? this.groundEye : from.y;
      if (best < dl * 0.45) {
        for (const a of [0.52, -0.52, 0.96, -0.96, 1.4, -1.4]) {
          const c = Math.cos(a), sn = Math.sin(a);
          const d2 = new THREE.Vector3((delta.x * c - delta.z * sn) * c, 0, (delta.x * sn + delta.z * c) * c);
          const t = attempt(d2);
          if (t.resolved._floor + t.resolved._eye - lastG > STEP_UP && this.grounded !== false) continue;
          if (this.walls && [0.35, 0.8].some((h) => this.walls.crosses(from, t.resolved, from.y - st.eye + h, st))) continue; // slide never cuts through rock
          const pr = prog(t.resolved);
          if (pr > best + dl * 0.08) { best = pr; resolved = t.resolved; }
        }
      }
    }
    // Round 13: auto-unstick. Pushing for over 1 s without getting anywhere (a sliver of rock, a
    // pinch the slide can't solve) eases you toward the middle of the passage, a little ahead.
    {
      const want = moving ? speed * dt : 0;
      const got = Math.hypot(resolved.x - from.x, resolved.z - from.z);
      // Net progress over time, not per frame: sliding back and forth along a lump is still stuck.
      if (!this.terrain && this.volume && want > 0.002 && !lowBlock) {
        if (!this._anc || Math.hypot(from.x - this._anc.x, from.z - this._anc.z) > 0.4) { this._anc = { x: from.x, z: from.z }; this.stuckT = 0; }
        else this.stuckT = (this.stuckT || 0) + dt;
      } else { this.stuckT = 0; this._anc = null; }
      // Round 17: crawling and snagged on a knee-high ramp for a moment: rise to a crouch if it fits
      // (crouching steps over ramps that a crawling body catches on).
      if (this.stuckT > 0.5 && this.stance === "crawl" && this.canUseStance("crouch")) { this.setStance("crouch"); this.stuckT = 0; this._anc = null; }
      let squeezed = false;
      if (this.stuckT <= 1) this._nudging = false;
      if (this.squeezeT > 0) this.squeezeT -= dt;
      if ((this.stuckT > 1 || (this.squeezeT > 0 && got < want * 0.5)) && dl > 1e-6) {
        const t = attempt(delta.clone().multiplyScalar(0.6), true);
        const pr = ((t.resolved.x - from.x) * delta.x + (t.resolved.z - from.z) * delta.z) / dl;
        if (pr > dl * 0.25 && t.resolved._inside) {
          resolved = t.resolved; squeezed = true; this.lastBlock = "squeeze";
          if (!(this.squeezeT > 0)) this.unsticks = (this.unsticks || 0) + 1;
          this.squeezeT = 0.8; // keep easing through the pinch, not 1 s on / 1 frame off
        }
      }
      if (this.stuckT > 1 && !squeezed) {
        const q = queryVolume(this.volume, from.x, from.y, from.z, st.radius, 0.05);
        const c = (q.containing && q.containing[0]) || q.best;
        if (c && c.s) {
          let nx = c.s.x - from.x, nz = c.s.z - from.z;
          const nl = Math.hypot(nx, nz);
          if (nl > 0.05) { nx /= nl; nz /= nl; } else { nx = 0; nz = 0; }
          const dd = dl > 1e-6 ? 1 / dl : 0;
          // never pull backwards: drop the part of the centre-ward pull that opposes the input
          const back = (nx * delta.x + nz * delta.z) * dd;
          if (back < 0) { nx -= delta.x * dd * back; nz -= delta.z * dd * back; }
          const step = Math.min(1.2 * dt, 0.05);
          const t = attempt(new THREE.Vector3((nx * 0.8 + delta.x * dd * 0.6) * step, 0, (nz * 0.8 + delta.z * dd * 0.6) * step));
          const prog = (r) => (dl > 1e-6 ? ((r.x - from.x) * delta.x + (r.z - from.z) * delta.z) * dd : 0);
          const better = prog(t.resolved) > prog(resolved) || prog(resolved) < dl * 0.1;
          if (better && Math.hypot(t.resolved.x - from.x, t.resolved.z - from.z) > 1e-4) { resolved = t.resolved; if (!this._nudging) this.unsticks = (this.unsticks || 0) + 1; this._nudging = true; this.lastBlock = "nudge"; }
        }
      }
    }
    const moved = Math.hypot(resolved.x - from.x, resolved.z - from.z);
    this.travelling += moved;

    // Vertical: follow a continuous ground height. Step-up limit is measured against the last
    // ground target (not the damped camera), rises are eased, small descents stick to the ground
    // (no float-then-drop on slopes), bigger drops use gravity.
    this.water = resolved._water || 0; this.waterY = resolved._waterY; // round 18
    let floorEye = resolved._floor + resolved._eye;
    const lastGround = this.groundEye != null ? this.groundEye : from.y;
    // Round 12: airborne (jumping) you can land on anything up to STEP_UP below your current height.
    const stepRef = this.grounded === false ? Math.max(lastGround, from.y) : lastGround;
    if (floorEye - stepRef > STEP_UP && delta.lengthSq() > 0) {
      this.lastBlock = "step";
      resolved.x = from.x;
      resolved.z = from.z;
      this.vy = 0;
      const again = this._constrain(from, from, st.radius, st);
      resolved._floor = again._floor;
      resolved._eye = again._eye;
      resolved._ceil = again._ceil;
      floorEye = resolved._floor + resolved._eye;
    }
    this.groundEye = floorEye;
    // Round 12: jump (Space / Jump button). Standing or mounted, from the ground; the take-off speed
    // is cut so the apex stays under the ceiling (caves), and no jump at all with < 0.25 m headroom.
    // Round 13: works while moving / sprinting (momentum is kept: the horizontal move above is
    // independent of the jump). Coyote time: still allowed ~0.15 s after leaving the ground (running
    // downhill at 13.8 m/s the ground-follow briefly reads "airborne", which used to eat the jump).
    if (this.jumpBuf > 0) this.jumpBuf -= dt;
    if (this.jumpBuf > 0) {
      const canJump = !this.jumping && (this.grounded !== false || (this.airT || 0) < 0.15) && (this.stance === "stand" || this.mounted);
      if (canJump) {
        this.jumpBuf = 0;
        const head = resolved._ceil - 0.12 - Math.max(from.y, floorEye) - 0.05;
        const h = Math.min(this.mounted ? 1.2 : 1.0, head);
        if (h >= 0.25) { this.vy = Math.sqrt(2 * GRAVITY * h); this.grounded = false; this.jumping = true; this.airT = 1; this.jumps = (this.jumps || 0) + 1; }
      }
    }
    let y;
    const gap = from.y - floorEye; // > 0: above the ground target
    const rising = this.vy > 0; // jumping, on the way up: gravity branch only
    if (!rising && gap < 0) {
      // Ease up (about 60 ms), never lagging more than 0.3 m below.
      y = Math.max(floorEye - 0.3, from.y + (floorEye - from.y) * Math.min(1, dt * 16));
      this.vy = 0;
      this.grounded = true; this.airT = 0; this.jumping = false;
    }
    else if (!rising && this.grounded !== false && gap < 0.6 + Math.hypot(delta.x, delta.z) * 3) {
      // Walking downhill / small dips: stay on the ground; ease any residual step over a few frames.
      y = gap < 0.06 ? floorEye : Math.max(floorEye, from.y - Math.max(0.06, gap * Math.min(1, dt * 14)));
      this.vy = 0;
      this.grounded = true; this.airT = 0; this.jumping = false;
    } else {
      this.vy -= GRAVITY * dt;
      y = from.y + this.vy * dt;
      this.grounded = false; this.airT = (this.airT || 0) + dt;
      if (y <= floorEye) {
        if (this.vy < -3 && this.onLand) { try { this.onLand(Math.min(1, -this.vy / 8)); } catch (_) {} }
        y = floorEye;
        this.vy = 0;
        this.grounded = true; this.airT = 0; this.jumping = false;
      }
    }
    const ceiling = resolved._ceil - 0.12;
    if (y > ceiling) {
      y = ceiling;
      this.vy = Math.min(this.vy, 0);
    }
    this.camera.position.set(resolved.x, y, resolved.z);
    const realSpeed = moved / Math.max(dt, 1e-4);

    // Safety net: if we ever leave the passage volume, snap back.
    if (!this.terrain && !pointInside(this.volume, resolved.x, y, resolved.z, st.radius, 0.18)) {
      this.lastBlock = "rescue";
      this.camera.position.copy(this.lastValid);
      this.vy = 0;
      this.rescues += 1;
      // Round 13: a rescue every frame means you're pushing into a squeeze your stance can't
      // fit (you'd be snapped back forever): drop a stance automatically, then nudge.
      this.rescueRun = (this.rescueRun || 0) + 1;
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.rescueRun > 12 && !this.mounted && this.stance !== "crawl") { this.setStance(this.stance === "stand" ? "crouch" : "crawl"); this.rescueRun = 0; this.autoDucks = (this.autoDucks || 0) + 1; }
    } else {
      this.lastValid.set(resolved.x, y, resolved.z);
      this.rescueRun = 0;
    }
    // Head bob + footsteps, scaled by real ground speed (none when blocked by a wall).
    const sp = Math.min(realSpeed, speed + 0.01);
    if (sp > 0.15 && this.vy === 0) {
      // Round 12: long strides at the 3x sprint (and on horseback) so steps don't machine-gun.
      const stride = this.mounted ? 1.1 + this.runFrac * 1.6 : this.stance === "crawl" ? 0.55 : this.stance === "crouch" ? 0.6 : 0.72 + this.runFrac * 2.2;
      const prev = this.bobPhase;
      this.bobPhase += (sp * dt) / stride * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI) && this.onStep) {
        try { this.onStep(Math.min(1, sp / 4.6), this.stance); } catch (_) {}
      }
    }
    const bobAmp = Math.min(1, sp / 2.3) * (this.stance === "stand" ? 0.022 + this.runFrac * 0.03 : 0.012);
    this.bobY = sp > 0.15 ? -Math.abs(Math.sin(this.bobPhase)) * bobAmp + bobAmp * 0.5 : 0;
    this.camera.position.y += this.bobY;
    this.blockedLow = !!resolved._blockedLow || (lowBlock && moved < delta.length() * 0.5);
    this.ahead = this.terrain ? "stand" : clearanceAhead(this.volume, this.camera.position.x, this.camera.position.y, this.camera.position.z, this.yaw);
    this.applyLook();

    if (!this.foundExit && this.cave && this.cave.exitId) {
      const ex = this.smap.get(this.cave.exitId);
      if (ex) {
        const p = stationWorld(ex);
        const d = Math.hypot(p.x - resolved.x, p.y - resolved.y, p.z - resolved.z);
        if (d < Math.max(1.4, (ex.left + ex.right) * 0.45)) {
          this.foundExit = true;
          if (this.onExit) this.onExit();
        }
      }
    }

    return this.readout();
  }

  readout() {
    const pos = this.camera.position;
    const st = STANCES[this.stance] || STANCES.stand;
    if (this.terrain) {
      const h = this.terrain.height(pos.x, pos.z);
      return { depth: 0, travelled: this.travelling, floor: h, inside: true, rescues: 0, nearest: null, stance: this.stance, ahead: "stand", blockedLow: false, outdoors: true };
    }
    const q = this.volume ? queryVolume(this.volume, pos.x, pos.y, pos.z, st.radius, 0.1) : null;
    const entrance = this.smap.get(this.cave.entranceId);
    const ez = entrance ? stationWorld(entrance).y : 0;
    const depth = ez - pos.y;
    return {
      depth,
      travelled: this.travelling,
      floor: q ? q.floor : 0,
      inside: q ? q.inside : false,
      rescues: this.rescues,
      nearest: q,
      stance: this.stance,
      ahead: this.ahead,
      blockedLow: this.blockedLow,
    };
  }

  _bind() {
    const c = this.canvas;
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") { this.setPace(+e.code.slice(5)); return; }
      if (e.code === "KeyC") {
        e.preventDefault();
        this.setStance("crouch", { toggle: true });
      } else if (e.code === "KeyZ" || e.code === "ControlLeft" || e.code === "ControlRight") {
        e.preventDefault();
        this.setStance("crawl", { toggle: true });
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== c) return;
      const sens = 0.0022;
      this.look(e.movementX * sens, e.movementY * sens);
    };
    document.addEventListener("mousemove", this._onMouseMove);
    // Round 17: the mouse wheel steps the walking pace (up = faster), while playing (pointer locked).
    this._onWheel = (e) => {
      if (this.isTouch || document.pointerLockElement !== c) return;
      e.preventDefault();
      const now = performance.now();
      if (now - (this._wheelT || 0) < 140) return;
      this._wheelT = now;
      this.setPace((this.pace || 1) + (e.deltaY < 0 ? 1 : -1));
    };
    c.addEventListener("wheel", this._onWheel, { passive: false });

    this._onClick = () => {
      if (this.isTouch) return;
      if (document.pointerLockElement !== c) c.requestPointerLock?.();
    };
    c.addEventListener("click", this._onClick);

    this._onPointerDown = (e) => this._touchStart(e);
    this._onPointerMove = (e) => this._touchMove(e);
    this._onPointerUp = (e) => this._touchEnd(e);
    c.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
  }

  attachJoystick(root, knob) {
    this.joyEl = root;
    this.knobEl = knob;
    const start = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.joy.active = true;
      this.joy.pointerId = e.pointerId;
      try { root.setPointerCapture?.(e.pointerId); } catch {}
      this._joyFromEvent(e);
    };
    const move = (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.pointerId) return;
      e.preventDefault();
      this._joyFromEvent(e);
    };
    const end = (e) => {
      if (e && e.pointerId !== this.joy.pointerId) return;
      this.resetJoy();
    };
    root.addEventListener("pointerdown", start);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    // Hotfix (stuck auto-run on iPhone): the stick must let go however the finger leaves, even when
    // the up event goes to another element, capture is lost, ids get mixed up with a look drag, or
    // the page is backgrounded.
    root.addEventListener("lostpointercapture", end);
    JOY.owner = this; JOY.root = root;
    if (!JOY.bound) {
      // bound once (players are re-created per world / cave); they act on the current stick owner
      JOY.bound = true;
      const P = () => JOY.owner;
      const up = (e) => { const p = P(); if (p && p.joy.active && e.pointerId === p.joy.pointerId) p.resetJoy(); };
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
      const inStick = (t) => { const r = JOY.root.getBoundingClientRect(), pad = r.width * 0.9; return t.clientX > r.left - pad && t.clientX < r.right + pad && t.clientY > r.top - pad && t.clientY < r.bottom + pad; };
      const touchCheck = (e) => {
        const p = P(); if (!p) return;
        const ts = e.touches;
        if (!ts || ts.length === 0) { p.resetJoy(); p.lookTouch = null; return; }
        // none of the remaining fingers is near the stick: the stick finger has gone
        if (p.joy.active && ![...ts].some(inStick)) p.resetJoy();
      };
      window.addEventListener("touchend", touchCheck, true);
      window.addEventListener("touchcancel", touchCheck, true);
      // and while other fingers move / land: a stick whose finger is no longer on the glass lets go
      const stale = (e) => { const p = P(); if (p && p.joy.active && e.touches && ![...e.touches].some(inStick)) p.resetJoy(); };
      window.addEventListener("touchmove", stale, { capture: true, passive: true });
      window.addEventListener("touchstart", stale, { capture: true, passive: true });
      const all = () => { const p = P(); if (p) { p.resetJoy(); p.lookTouch = null; } };
      document.addEventListener("visibilitychange", () => { if (document.hidden) all(); });
      window.addEventListener("blur", all);
      window.addEventListener("pagehide", all);
    }
  }

  /** Stick back to centre: no movement until it is touched again. */
  resetJoy() {
    this.joy.active = false;
    this.joy.dx = 0;
    this.joy.dy = 0;
    this.joy.mag = 0;
    this.joy.pointerId = null;
    if (this.joyEl) { this.joyEl.classList.remove("run"); this.joyEl.classList.remove("jog"); }
    if (this.knobEl) this.knobEl.style.transform = "translate(-50%, -50%)";
  }

  _joyFromEvent(e) {
    const rect = this.joyEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width * 0.42);
    let dy = (e.clientY - cy) / (rect.height * 0.42);
    const m = Math.hypot(dx, dy) || 1;
    // Keep the raw deflection (past the ring = run), capped at 1.2.
    this.joy.mag = Math.min(1.2, Math.hypot(dx, dy));
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    if (this.joyEl) { this.joyEl.classList.toggle("run", this.joy.mag > 0.9); this.joyEl.classList.toggle("jog", this.joy.mag > 0.55 && this.joy.mag <= 0.9); }
    this.joy.dx = dx;
    this.joy.dy = dy;
    if (this.knobEl) {
      const px = dx * rect.width * 0.32;
      const py = dy * rect.height * 0.32;
      this.knobEl.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
    }
  }

  _touchStart(e) {
    if (!this.isTouch) return;
    if (e.target.closest && e.target.closest("#joystick, #toolbar, button, input, #about, #about-btn, #found, #stance-bar, #low-hint")) return;
    if (e.clientX < window.innerWidth * 0.36) return; // left side is movement / joystick
    if (this.joy.active && e.pointerId === this.joy.pointerId) return; // never let one finger be both
    this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  _touchMove(e) {
    if (!this.lookTouch || e.pointerId !== this.lookTouch.id) return;
    const dx = e.clientX - this.lookTouch.x;
    const dy = e.clientY - this.lookTouch.y;
    this.lookTouch.x = e.clientX;
    this.lookTouch.y = e.clientY;
    this.dragLook(dx * 0.0055, dy * 0.0055);
  }
  /** Touch free-look. One-finger mode, third person: swings the camera only (Kra keeps his heading). */
  dragLook(dyaw, dpitch) {
    if (this.oneFinger && !this.fpView) {
      this.camOff = Math.max(-Math.PI, Math.min(Math.PI, (this.camOff || 0) - dyaw));
      this._lookAt = this._clock;
      this.look(0, dpitch);
    } else this.look(dyaw, dpitch);
  }
  /** Round 25e: per frame. Ease the free-look offset back behind Kra once he has moved ~1.5 s since
   *  the last drag (and straight away in first person / two-finger mode). */
  easeCam(dt, moving) {
    this._clock += dt;
    if (!this.camOff) return;
    if (!this.oneFinger || this.fpView) { this.yaw += this.camOff; this.camOff = 0; this.applyLook(); return; }
    if (moving) this._movedFor = (this._movedFor || 0) + dt; else this._movedFor = 0;
    if (this._movedFor > 1.5 && this._clock - this._lookAt > 1.5 && !this.lookTouch) {
      this.camOff *= Math.exp(-dt * 2.2);
      if (Math.abs(this.camOff) < 0.002) this.camOff = 0;
      this.applyLook();
    }
  }

  _touchEnd(e) {
    if (this.lookTouch && e.pointerId === this.lookTouch.id) this.lookTouch = null;
  }
}

/** Hotfix: the one live joystick owner for the page-wide release handlers. */
const JOY = { owner: null, root: null, bound: false };

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

export { isTouchDevice, PLAYER_RADIUS };
