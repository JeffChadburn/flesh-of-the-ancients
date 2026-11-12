/**
 * Round 24b: hostile towns that fight back, loot from fallen fighters, and the Call to Arms.
 *  - Some camps / villages (never cities, never the story's towns or the ones nearest the start)
 *    are hostile. Their folk won't talk; step inside the palisade (or strike one) and they fight:
 *    villagers flee, warriors close in, spear-throwers keep their distance and throw, a war chief
 *    leads. Anyone who drops to their stats' fleeAt runs. Leave for a while and they calm down.
 *  - The fallen leave a pouch with loot for the town's age (LOOT in survival.js).
 *  - Call to Arms (📯): warriors from your friendly towns / own settlements nearby march over and
 *    fight beside you. Count = settlement size and age; cooldown; blue ⚔ on the minimap.
 * Townsfolk are the instanced People; a fight takes them over with `ext` (as the colony does).
 */
import * as THREE from "three";
import { STATS } from "./stats.js";
import { LOOT, ITEMS } from "./survival.js";

const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; };
const AGE_NAME = ["Stone", "Bronze", "Iron"];
export const HORN_CD = 180;

/** Mark some settlements hostile (deterministic per world). Returns the hostile ones. */
export function markHostile(list, start = { x: 0, z: 0 }, keep = []) {
  const near = (k) => list.filter((s) => s.kind === k).sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z))[0];
  const safe = new Set([near("city"), near("village"), near("camp"), ...keep].filter(Boolean));
  const ok = list.filter((s) => s.kind !== "city" && !s.nearCamp && !safe.has(s) && Math.hypot(s.x - start.x, s.z - start.z) > 420);
  for (const s of list) { s.hostile = false; s.age = s.kind === "city" ? 2 : s.kind === "village" ? 1 + (hash(s.seed || 1) % 2) : 0; }
  for (const s of ok) if (hash((s.seed || 1) + 7) % (s.kind === "village" ? 2 : 3) === 0) s.hostile = true;
  const vil = ok.filter((q) => q.kind === "village"); // at least one hostile village (a war chief, more fighters)
  if (vil.length && !vil.some((q) => q.hostile)) vil.sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z))[0].hostile = true;
  // at least two (the nearest eligible ones), so there's always a fight within reach
  ok.sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
  for (const s of ok) { if (ok.filter((q) => q.hostile).length >= Math.min(2, ok.length)) break; s.hostile = true; }
  return list.filter((s) => s.hostile);
}

function roleFor(p) {
  const i = +String(p.key || "").split(":").pop() || 0;
  if (i === 0 && p.s?.kind === "village") return "chief";
  return ["villager", "warrior", "thrower", "villager", "warrior", "thrower", "warrior"][i % 7];
}

export class Fighters {
  /** env: { scene, terrain(), people(), towns() (all settlements), colonies(), feet(), yaw(), safe(),
   *   hurt(n, src) -> bool, toast(msg, kind), log(e), surv(), sound(kind) } */
  constructor(env) {
    this.env = env;
    this.towns = new Map(); // s.id -> { s, aggro, calmT, warned }
    this.allies = []; this.spears = []; this.bags = [];
    this.hornCd = 0; this.c = { kills: 0, loot: 0, calls: 0, allyKills: 0, throws: 0, hits: 0 };
    this.fallen = new Set();
    const g = new THREE.CylinderGeometry(0.025, 0.03, 1.5, 5).rotateX(Math.PI / 2);
    this._spearGeo = g; this._spearMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });
    this._bagGeo = new THREE.SphereGeometry(0.28, 10, 8).scale(1, 0.7, 1); this._bagMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3e, roughness: 0.95, emissive: 0x3a2400, emissiveIntensity: 0.35 });
  }
  _key() { return this.env.key?.() || "fota-fallen-v1"; }
  _load() { try { return JSON.parse(localStorage.getItem(this._key()) || "[]"); } catch { return []; } }
  _save() { try { localStorage.setItem(this._key(), JSON.stringify([...this.fallen].slice(-400))); } catch {} }
  reload() { this.fallen = new Set(this._load()); }
  isFallen(key) { const k = this._key(); if (k !== this._kk) { this._kk = k; this.fallen = new Set(this._load()); } return this.fallen.has(key); }

  hostileTowns() { return (this.env.towns() || []).filter((s) => s.hostile); }
  townState(s) { let t = this.towns.get(s.id); if (!t) this.towns.set(s.id, (t = { s, aggro: false, calmT: 0, warned: false })); return t; }
  /** People of a hostile town that are set up to fight. */
  foes() { return (this.env.people()?.list || []).filter((p) => p.fight && p.fight.team === "foe"); }

  _arm(p) {
    if (p.fight) return p.fight;
    const type = roleFor(p), st = STATS[type], age = p.s?.age || 0;
    const hp = st.hp + (type !== "villager" && age >= 2 ? 1 : 0);
    p.fight = { type, st, hp, max: hp, team: "foe", cd: 1 + Math.random(), fled: false, dmg: st.dmg + (age >= 2 && type !== "villager" ? 1 : 0) };
    p.armed = type !== "villager";
    p.tunic0 = p.tunic;
    if (p.armed) p.tunic = type === "chief" ? 0x5a1414 : 0x7a2a22;
    return p.fight;
  }
  aggro(s, why = "") {
    const t = this.townState(s);
    if (t.aggro) { t.calmT = 0; return; }
    t.aggro = true; t.calmT = 0;
    for (const p of this.env.people()?.list || []) if (p.s === s) { this._arm(p); p.ext = true; p.ready = true; }
    this.env.toast(`⚔️ ${s.name} takes up arms against you!${why ? " " + why : ""}`, "bad");
    this.env.log?.({ e: "townAggro", id: s.id, why });
    this.env.sound?.("aggro");
  }
  calm(s) {
    const t = this.townState(s); t.aggro = false; t.calmT = 0; t.warned = false;
    for (const p of this.env.people()?.list || []) if (p.s === s && p.fight) { p.ext = false; p.ready = false; p.state = "idle"; p.t = 1 + Math.random() * 3; p.route = []; p.fight.fled = false; }
    this.env.log?.({ e: "townCalm", id: s.id });
  }

  update(dt, now) {
    const env = this.env, f = env.feet(), ppl = env.people();
    if (this.hornCd > 0) this.hornCd = Math.max(0, this.hornCd - dt);
    if (!f || !ppl) return;
    const safe = env.safe?.();
    // towns: arm the folk of nearby hostile towns, aggro on entry, calm down after you leave
    for (const s of this.hostileTowns()) {
      const d = Math.hypot(s.x - f.x, s.z - f.z), t = this.townState(s);
      if (d < 220) for (const p of ppl.list) if (p.s === s && !p.fight) this._arm(p);
      if (!t.aggro && !safe && d < s.R + 26 && !t.warned) { t.warned = true; env.toast(`⚠️ ${s.name} is hostile. Their warriors watch you from the palisade.`, "bad"); }
      if (!t.aggro && !safe && d < s.R + 2) this.aggro(s, "You walked in uninvited.");
      if (t.aggro) {
        const alive = ppl.list.some((p) => p.s === s && p.fight && !p.fight.fled && p.armed);
        if (d > s.R + 80 || !alive && d > s.R + 10) { t.calmT += dt; if (t.calmT > (alive ? 15 : 30)) this.calm(s); } else t.calmT = 0;
      }
      if (d > s.R + 40) t.warned = d < s.R + 120 ? t.warned : false;
    }
    // everyone in a fight
    const fighting = ppl.list.filter((p) => p.fight && p.ext && (p.fight.team === "ally" || this.towns.get(p.s?.id)?.aggro));
    for (const p of fighting) this._fight(p, dt, f, fighting, safe);
    // keep bodies apart (no two fighters in one spot)
    for (let i = 0; i < fighting.length; i++) for (let j = i + 1; j < fighting.length; j++) {
      const A = fighting[i], B = fighting[j], dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
      if (d < 0.85) { const k = (0.85 - d) / 2, nx = d > 1e-3 ? dx / d : Math.cos(i + j), nz = d > 1e-3 ? dz / d : Math.sin(i + j); A.x -= nx * k; A.z -= nz * k; B.x += nx * k; B.z += nz * k; }
    }
    this._spearsUpdate(dt, f, fighting);
    for (const b of this.bags) b.mesh.rotation.y += dt * 0.6;
  }

  _target(p, f, fighting, safe) {
    let best = null, bd = 1e9;
    const consider = (o, x, z) => { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = o; } };
    if (p.fight.team === "foe") {
      if (!safe) consider({ player: true, x: f.x, z: f.z }, f.x, f.z);
      for (const a of fighting) if (a.fight.team === "ally" && a.fight.hp > 0) consider(a, a.x, a.z);
    } else {
      for (const o of fighting) if (o.fight.team === "foe" && !o.fight.fled && o.fight.hp > 0 && Math.hypot(o.x - p.x, o.z - p.z) < 60) consider(o, o.x, o.z);
    }
    return best ? { o: best, d: bd } : null;
  }
  _step(p, dx, dz, sp, dt) {
    const L = Math.hypot(dx, dz); if (L < 1e-4 || sp <= 0) { p.state = "idle"; return; }
    const t = this.env.terrain();
    let nx = p.x + (dx / L) * sp * dt, nz = p.z + (dz / L) * sp * dt;
    if (t?.waterDepth && t.waterDepth(nx, nz) > 0.6) { nx = p.x + (dz / L) * sp * dt; nz = p.z - (dx / L) * sp * dt; } // side-step water
    p.x = nx; p.z = nz;
    const want = Math.atan2(dx, dz); let dy = want - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * Math.min(1, dt * 9);
    p.phase = (p.phase || 0) + sp * dt * 4.2; p.state = "walk"; p.speed = sp;
  }
  _fight(p, dt, f, fighting, safe) {
    const F = p.fight, st = F.st;
    F.cd -= dt;
    if (F.team === "ally") return this._ally(p, dt, f, fighting);
    const tg = this._target(p, f, fighting, safe);
    if (!tg) { p.state = "idle"; return; }
    const dx = tg.o.x - p.x, dz = tg.o.z - p.z, d = tg.d;
    // flee: villagers always; fighters once hurt to fleeAt
    if (F.type === "villager" || F.hp <= st.fleeAt * F.max) {
      if (!F.fled && F.type !== "villager") { F.fled = true; this.env.toast(`The ${st.name.toLowerCase()} breaks and runs!`); }
      F.fled = true;
      return d < 28 ? this._step(p, -dx, -dz, st.speed * 0.95, dt) : (p.state = "idle");
    }
    if (F.type === "thrower" && d > 6) {
      if (d > st.range) return this._step(p, dx, dz, st.speed, dt);
      if (d < 9) this._step(p, -dx, -dz, st.speed * 0.6, dt); else { p.state = "idle"; p.yaw = Math.atan2(dx, dz); }
      if (F.cd <= 0) { F.cd = st.cd + Math.random() * 0.8; this._throw(p, tg.o, F.dmg); }
      return;
    }
    if (d > st.attack) return this._step(p, dx, dz, st.speed * (d < 8 ? 1 : 0.9), dt);
    p.state = "idle"; p.yaw = Math.atan2(dx, dz);
    if (F.cd <= 0) { F.cd = st.cd; p.strikeT = 0.45; this._strike(p, tg.o, F.dmg); }
  }
  _ally(p, dt, f, fighting) {
    const F = p.fight, st = F.st;
    F.ttl -= dt;
    if (F.home) { // marching home, then gone
      const dx = F.home.x - p.x, dz = F.home.z - p.z; this._step(p, dx, dz, st.speed, dt);
      if (F.ttl < -14 || Math.hypot(dx, dz) < 4) this._removeAlly(p);
      return;
    }
    const tg = this._target(p, f, fighting);
    if (tg && (tg.d < 45 || Math.hypot(tg.o.x - f.x, tg.o.z - f.z) < 40)) {
      F.idleT = 0;
      if (tg.d > st.attack) return this._step(p, tg.o.x - p.x, tg.o.z - p.z, st.speed, dt);
      p.state = "idle"; p.yaw = Math.atan2(tg.o.x - p.x, tg.o.z - p.z);
      if (F.cd <= 0) { F.cd = st.cd; p.strikeT = 0.45; this._strike(p, tg.o, F.dmg); }
      return;
    }
    // no foe at hand: march to Kra (march in from the side of their home)
    F.idleT = (F.idleT || 0) + dt;
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz);
    if (d > 4 + (F.slot || 0) * 0.7) this._step(p, dx, dz, d > 25 ? st.speed : st.speed * 0.55, dt); else p.state = "idle";
    if (F.ttl <= 0 || F.arrived && F.idleT > 40) this._sendHome(p);
    if (d < 10) F.arrived = true;
  }
  _sendHome(p) { const F = p.fight; F.home = F.from || { x: p.x + 60, z: p.z }; F.ttl = Math.min(F.ttl, 0); p.ready = false; }
  _removeAlly(p) { this.env.people().remove(p); this.allies = this.allies.filter((a) => a !== p); }

  _strike(p, o, dmg) {
    if (o.player) { if (this.env.hurt(dmg, p.fight.st.name.toLowerCase())) this.env.toast(`The ${p.fight.st.name.toLowerCase()} strikes you!`, "bad"); this.c.hits++; }
    else this.damage(o, dmg, p);
    this.env.sound?.("strike");
  }
  _throw(p, o, dmg) {
    const T = this.env.terrain(), y0 = (T?.height(p.x, p.z) || 0) + 1.6;
    const lead = o.player ? 0.25 : 0, tx = o.x, tz = o.z, ty = (T?.height(tx, tz) || 0) + 1.1;
    const d = Math.hypot(tx - p.x, tz - p.z), time = d / 16 + 0.25 + lead;
    const m = new THREE.Mesh(this._spearGeo, this._spearMat);
    m.position.set(p.x, y0, p.z); this.env.scene.add(m);
    this.spears.push({ m, from: p, dmg, t: 0, life: time + 3, vel: new THREE.Vector3((tx - p.x) / time, (ty - y0) / time + 4.9 * time, (tz - p.z) / time), stuck: false, team: p.fight.team });
    p.strikeT = 0.45; this.c.throws++;
    this.env.sound?.("throw");
  }
  _spearsUpdate(dt, f, fighting) {
    const T = this.env.terrain();
    for (const s of this.spears) {
      s.t += dt;
      if (!s.stuck) {
        s.vel.y -= 9.8 * dt; s.m.position.addScaledVector(s.vel, dt);
        s.m.lookAt(s.m.position.x + s.vel.x, s.m.position.y + s.vel.y, s.m.position.z + s.vel.z);
        const P = s.m.position, g = T?.height(P.x, P.z) || 0;
        if (s.team === "foe") {
          if (Math.hypot(P.x - f.x, P.z - f.z) < 0.75 && P.y > f.y - 0.2 && P.y < f.y + 1.9) { s.stuck = true; s.t = s.life - 0.4; if (this.env.hurt(s.dmg, "spear")) this.env.toast("A thrown spear hits you!", "bad"); this.c.hits++; continue; }
          for (const a of fighting) if (a.fight.team === "ally" && Math.hypot(P.x - a.x, P.z - a.z) < 0.6 && P.y < g + 1.9) { this.damage(a, s.dmg, s.from); s.stuck = true; s.t = s.life - 0.4; break; }
        }
        if (P.y < g + 0.05) { s.stuck = true; P.y = g + 0.2; }
      }
    }
    const done = this.spears.filter((s) => s.t > s.life);
    for (const s of done) this.env.scene.remove(s.m);
    if (done.length) this.spears = this.spears.filter((s) => s.t <= s.life);
  }

  /** Damage a fighter (from Kra when `by` is null). */
  damage(p, n, by = null) {
    if (!p.fight) return null;
    const F = p.fight;
    F.hp -= n; p.hurtT = 0.3;
    if (F.team === "foe" && p.s) this.aggro(p.s, by ? "" : "You struck first.");
    if (F.hp <= 0) return this._kill(p, by), { kind: F.st.name.toLowerCase(), alive: false, fighter: true };
    return { kind: F.st.name.toLowerCase(), alive: true, fighter: true, hp: F.hp, max: F.max };
  }
  _kill(p, by) {
    const ppl = this.env.people(), F = p.fight;
    if (F.team === "ally") { this.env.toast(`One of your warriors has fallen.`, "bad"); this._removeAlly(p); return; }
    ppl.remove(p); this.fallen.add(p.key); this._save(); this.c.kills++;
    if (by) this.c.allyKills++;
    this.env.log?.({ e: "fighterDown", key: p.key, type: F.type, by: by ? "ally" : "kra" });
    if (F.type !== "villager") this._dropBag(p);
    this.env.toast(by ? `Your warriors bring down a ${F.st.name.toLowerCase()}.` : `You bring down a ${F.st.name.toLowerCase()}. They drop a pouch.`, "good");
  }
  _dropBag(p) {
    const age = Math.max(0, Math.min(2, p.s?.age || 0)), rnd = Math.random;
    const loot = [];
    for (const [id, n, ch] of LOOT[age]) if (rnd() < ch * (p.fight.type === "chief" ? 1.8 : 1)) loot.push([id, n]);
    if (!loot.length) loot.push(LOOT[age][0].slice(0, 2));
    const T = this.env.terrain(), y = (T?.height(p.x, p.z) || 0) + 0.18;
    const mesh = new THREE.Mesh(this._bagGeo, this._bagMat); mesh.position.set(p.x, y, p.z); this.env.scene.add(mesh);
    this.bags.push({ x: p.x, z: p.z, y, mesh, loot, who: p.fight.st.name.toLowerCase(), age, t: 0 });
  }
  lootNear(f, r = 2.2) { let b = null, bd = r; for (const q of this.bags) { const d = Math.hypot(q.x - f.x, q.z - f.z); if (d < bd) { bd = d; b = q; } } return b; }
  lootTake(b, surv) {
    const got = [];
    for (const [id, n] of b.loot) { surv?.add(id, n); got.push(`${n} ${(ITEMS[id]?.name || id).toLowerCase()}`); }
    this.env.scene.remove(b.mesh); this.bags = this.bags.filter((q) => q !== b); this.c.loot++;
    this.env.toast(`Looted (${AGE_NAME[b.age]} Age): ${got.join(", ")}`, "good");
    this.env.log?.({ e: "loot", loot: b.loot });
    return b.loot;
  }

  /** Kra's spear thrust: the fighter (or hostile townsperson) in front of him within reach. */
  tryHit(f, fx, fz, dmg, reach = 2.7) {
    let best = null, bd = reach;
    for (const p of this.env.people()?.list || []) {
      if (!(p.fight?.team === "foe" || (p.s?.hostile && !p.fight))) continue;
      const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / Math.max(d, 1e-3) > 0.45) { bd = d; best = p; }
    }
    if (!best) return null;
    this._arm(best);
    return this.damage(best, dmg);
  }
  /** An arrow at point p: a foe there? */
  arrowHit(P, dmg) {
    const T = this.env.terrain();
    for (const p of this.env.people()?.list || []) {
      if (!(p.fight?.team === "foe" || (p.s?.hostile && !p.fight))) continue;
      const g = T?.height(p.x, p.z) || 0;
      if (Math.hypot(P.x - p.x, P.z - p.z) < 0.55 && P.y > g && P.y < g + 1.85) { this._arm(p); return this.damage(p, dmg); }
    }
    return null;
  }

  /** Is the horn usable here? The hostile town in reach (or one already fighting), else null. */
  hornTown(f = this.env.feet()) {
    if (!f) return null;
    let best = null, bd = 260;
    for (const s of this.hostileTowns()) { const d = Math.hypot(s.x - f.x, s.z - f.z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  /** Who would answer the horn: friendly towns within 1500 m and Kra's own settlements. */
  sources(f = this.env.feet()) {
    const out = [];
    for (const s of this.env.towns() || []) {
      if (s.hostile) continue;
      const d = Math.hypot(s.x - f.x, s.z - f.z); if (d > 1500) continue;
      out.push({ name: s.name, x: s.x, z: s.z, d, n: s.kind === "city" ? 4 : s.kind === "village" ? 2 : 1, age: s.age || 0, own: false });
    }
    for (const c of this.env.colonies() || []) {
      const d = Math.hypot(c.x - f.x, c.z - f.z); if (d > 2500) continue;
      out.push({ name: c.name, x: c.x, z: c.z, d, n: Math.min(5, 1 + Math.floor((c.age || 0) / 2) + Math.floor((c.vill?.length || 0) / 4)), age: Math.min(2, Math.floor((c.age || 0) / 2)), own: true });
    }
    return out.sort((a, b) => (b.own - a.own) || a.d - b.d);
  }
  callToArms(cap = this.env.lite ? 6 : 8) {
    const f = this.env.feet(), s = this.hornTown(f);
    if (!f) return { err: "nowhere" };
    if (this.hornCd > 0) { this.env.toast(`📯 Your allies are still answering the last call (${Math.ceil(this.hornCd)} s).`); return { err: "cooldown", cd: this.hornCd }; }
    if (!s) { this.env.toast("📯 There's no hostile town near enough to call warriors against."); return { err: "notown" }; }
    const src = this.sources(f);
    if (!src.length) { this.env.toast("📯 The horn echoes, but no friendly town is near enough to answer. Make friends, or found your own settlement."); this.hornCd = 30; return { err: "nofriends" }; }
    const ppl = this.env.people(), T = this.env.terrain();
    let n = 0; const from = [];
    for (const q of src) {
      const k = Math.min(q.n, cap - n); if (k <= 0) break;
      from.push(`${q.name} (${k})`);
      const ax = q.x - f.x, az = q.z - f.z, L = Math.hypot(ax, az) || 1;
      for (let i = 0; i < k; i++) {
        const off = (n + i - cap / 2) * 1.6;
        const x = f.x + (ax / L) * 46 - (az / L) * off, z = f.z + (az / L) * 46 + (ax / L) * off;
        const p = ppl.addExternal({ x, z, seed: 991 + n * 37 + i, tunic: 0x2e4a7a, yaw: Math.atan2(-ax, -az) });
        const st = STATS.ally, hp = st.hp + q.age;
        p.fight = { type: "ally", st, hp, max: hp, team: "ally", cd: 0.5, dmg: st.dmg + (q.age >= 1 ? 1 : 0), ttl: 150, from: { x: f.x + (ax / L) * 120, z: f.z + (az / L) * 120 }, slot: n + i };
        p.armed = true; p.ready = true; p.ally = true;
        if (T) p.y = T.height(x, z);
        this.allies.push(p);
      }
      n += k;
    }
    this.hornCd = HORN_CD; this.c.calls++;
    if (!this.townState(s).aggro && Math.hypot(s.x - f.x, s.z - f.z) < s.R + 60) this.aggro(s, "They saw your warriors coming.");
    this.env.toast(`📯 Call to Arms! ${n} warrior${n > 1 ? "s" : ""} march to you from ${from.join(", ")}.`, "good");
    this.env.log?.({ e: "callToArms", n, from, town: s.id });
    this.env.sound?.("horn");
    return { n, from, town: s.name };
  }
  /** Minimap / map marks: allies (blue), fighting foes (red), pouches (gold). */
  marks() {
    const out = [];
    for (const a of this.allies) out.push({ x: a.x, z: a.z, color: "#5aa8ff", r: 0.016, label: "⚔", ally: true });
    for (const p of this.foes()) if (this.towns.get(p.s?.id)?.aggro && !p.fight.fled && p.armed) out.push({ x: p.x, z: p.z, color: "#ff4a3a", r: 0.011 });
    for (const b of this.bags) out.push({ x: b.x, z: b.z, color: "#ffd25a", r: 0.012 });
    return out;
  }
  inCombat(f = this.env.feet()) { return !!f && [...this.towns.values()].some((t) => t.aggro && Math.hypot(t.s.x - f.x, t.s.z - f.z) < t.s.R + 80); }
  clearAll() { for (const a of [...this.allies]) this._removeAlly(a); for (const s of this.spears) this.env.scene.remove(s.m); for (const b of this.bags) this.env.scene.remove(b.mesh); this.spears = []; this.bags = []; for (const t of this.towns.values()) if (t.aggro) this.calm(t.s); }
  state() {
    return { hornCd: +this.hornCd.toFixed(1), allies: this.allies.map((a) => ({ x: +a.x.toFixed(1), z: +a.z.toFixed(1), hp: a.fight.hp, home: !!a.fight.home })), bags: this.bags.length, spears: this.spears.length,
      aggro: [...this.towns.values()].filter((t) => t.aggro).map((t) => t.s.name), c: { ...this.c },
      foes: this.foes().map((p) => ({ key: p.key, type: p.fight.type, hp: p.fight.hp, fled: p.fight.fled, x: +p.x.toFixed(1), z: +p.z.toFixed(1), ext: !!p.ext })) };
  }
}
