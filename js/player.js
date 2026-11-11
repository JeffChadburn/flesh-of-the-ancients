/** First-person walking, mouse look, touch joystick, and passage-volume collision. */

import * as THREE from "three";
import { stationMap, stationWorld } from "./cave-data.js";
import { clamp } from "./rng.js";
import {
  buildVolume, constrainToVolume, pointInside, queryVolume,
  PLAYER_RADIUS, STAND_EYE, GRAVITY, STEP_UP,
  STANCES, stanceHeight, canFitStance, clearanceAhead, requiredStanceAt,
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

  stanceDef() {
    return STANCES[this.stance] || STANCES.stand;
  }

  canUseStance(name) {
    if (this.terrain || !this.volume) return true;
    const p = this.camera.position;
    return canFitStance(this.volume, p.x, p.y, p.z, name);
  }

  setStance(name, { toggle = false } = {}) {
    if (!STANCES[name]) return false;
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
    this.camera.position.set(p.x, p.y - s.down + eye, p.z);
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
      this.groundEye = null; this.grounded = true; this.vy = 0;
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
    this.camera.rotation.y = this.yaw;
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
    if (mag < 0.12) return 0;
    const w = Math.min(1, (mag - 0.12) / (0.85 - 0.12));
    let v = st.speed * (0.18 + 0.82 * w * w * (3 - 2 * w));
    if (mag > 0.85 && st.sprint > st.speed) {
      const r = Math.min(1, (mag - 0.85) / 0.2);
      v += (st.sprint - st.speed) * r * r * (3 - 2 * r);
    }
    return v;
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
    const st = STANCES[this.stance] || STANCES.stand;
    const keyMove = wish.lengthSq() > 1e-4;
    const sprint = !wishOverride && this.stance === "stand" && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
    let target = 0;
    if (keyMove) {
      wish.normalize();
      target = sprint ? st.sprint : st.speed;
    } else if (!wishOverride && this.joy.active && this.joy.mag >= 0.12) {
      wish.set(this.joy.dx, 0, this.joy.dy).normalize();
      target = Player.joySpeed(this.joy.mag, st);
    }
    if (wishOverride) target = st.speed;
    if (this.sprintAllowed === false && target > st.speed) target = st.speed; // exhausted: no running
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
    const proposed = from.clone().add(delta);
    let resolved = this._constrain(proposed, from, st.radius, st);
    // Caves: clamp against the rendered rock too, so you can never walk through a visible wall.
    if (!this.terrain && this.walls && (resolved.x !== from.x || resolved.z !== from.z)) {
      const w = this.walls.resolve(from, resolved, resolved._floor, resolved._ceil, st);
      if (w.hit || w.x !== resolved.x || w.z !== resolved.z) {
        const again = this._constrain(new THREE.Vector3(w.x, proposed.y, w.z), from, st.radius, st);
        if (again._inside) resolved = again; else { resolved.x = from.x; resolved.z = from.z; }
      }
      // Final guard: never end a step on the far side of a visible wall.
      if (this.walls.crosses(from, resolved, Math.min(resolved._floor, from.y - st.eye), st)) { resolved.x = from.x; resolved.z = from.z; }
    }
    const moved = Math.hypot(resolved.x - from.x, resolved.z - from.z);
    this.travelling += moved;

    // Vertical: follow a continuous ground height. Step-up limit is measured against the last
    // ground target (not the damped camera), rises are eased, small descents stick to the ground
    // (no float-then-drop on slopes), bigger drops use gravity.
    let floorEye = resolved._floor + resolved._eye;
    const lastGround = this.groundEye != null ? this.groundEye : from.y;
    if (floorEye - lastGround > STEP_UP && delta.lengthSq() > 0) {
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
    let y;
    const gap = from.y - floorEye; // > 0: above the ground target
    if (gap < 0) {
      // Ease up (about 60 ms), never lagging more than 0.3 m below.
      y = Math.max(floorEye - 0.3, from.y + (floorEye - from.y) * Math.min(1, dt * 16));
      this.vy = 0;
      this.grounded = true;
    } else if (this.grounded !== false && gap < 0.6 + Math.hypot(delta.x, delta.z) * 3) {
      // Walking downhill / small dips: stay on the ground; ease any residual step over a few frames.
      y = gap < 0.06 ? floorEye : Math.max(floorEye, from.y - Math.max(0.06, gap * Math.min(1, dt * 14)));
      this.vy = 0;
      this.grounded = true;
    } else {
      this.vy -= GRAVITY * dt;
      y = from.y + this.vy * dt;
      this.grounded = false;
      if (y <= floorEye) {
        y = floorEye;
        this.vy = 0;
        this.grounded = true;
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
      this.camera.position.copy(this.lastValid);
      this.vy = 0;
      this.rescues += 1;
    } else {
      this.lastValid.set(resolved.x, y, resolved.z);
    }
    // Head bob + footsteps, scaled by real ground speed (none when blocked by a wall).
    const sp = Math.min(realSpeed, speed + 0.01);
    if (sp > 0.15 && this.vy === 0) {
      const stride = this.stance === "crawl" ? 0.55 : this.stance === "crouch" ? 0.6 : 0.72 + this.runFrac * 0.38;
      const prev = this.bobPhase;
      this.bobPhase += (sp * dt) / stride * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI) && this.onStep) {
        try { this.onStep(Math.min(1, sp / 4.6), this.stance); } catch (_) {}
      }
    }
    const bobAmp = Math.min(1, sp / 2.3) * (this.stance === "stand" ? 0.022 + this.runFrac * 0.03 : 0.012);
    this.bobY = sp > 0.15 ? -Math.abs(Math.sin(this.bobPhase)) * bobAmp + bobAmp * 0.5 : 0;
    this.camera.position.y += this.bobY;
    this.blockedLow = !!resolved._blockedLow;
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
      if (e.pointerId !== this.joy.pointerId) return;
      this.joy.active = false;
      this.joy.dx = 0;
      this.joy.dy = 0;
      this.joy.mag = 0;
      if (this.joyEl) this.joyEl.classList.remove("run");
      if (knob) knob.style.transform = "translate(-50%, -50%)";
    };
    root.addEventListener("pointerdown", start);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
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
    if (this.joyEl) this.joyEl.classList.toggle("run", this.joy.mag > 0.9);
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
    this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  _touchMove(e) {
    if (!this.lookTouch || e.pointerId !== this.lookTouch.id) return;
    const dx = e.clientX - this.lookTouch.x;
    const dy = e.clientY - this.lookTouch.y;
    this.lookTouch.x = e.clientX;
    this.lookTouch.y = e.clientY;
    this.look(dx * 0.0055, dy * 0.0055);
  }

  _touchEnd(e) {
    if (this.lookTouch && e.pointerId === this.lookTouch.id) this.lookTouch = null;
  }
}

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

export { isTouchDevice, PLAYER_RADIUS };
