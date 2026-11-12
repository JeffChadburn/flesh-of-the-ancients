import * as THREE from "three";
import { Caveman } from "../caveman.js";
import { BOAT_GEO } from "../world/boats.js";
/**
 * Round 22: a remote player: the same caveman rig as Kra (their clothing + hide colour), a name tag
 * with a speaking light, a chat bubble, horse / boat props and smooth interpolation of the 10 Hz
 * state stream. Torch lights come from a small shared pool (see mp.js) so joins never add lights.
 */
const DELAY = 0.13; // s behind the newest packet: smooth with one lost packet
const lerpAng = (a, b, k) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;

function textSprite(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  s.renderOrder = 20; s.userData = { c, tex }; s.userData.noMelt = true;
  return s;
}
let horseGeo = null;
function horseMesh() {
  if (!horseGeo) {
    const parts = [], add = (g, x, y, z) => { g.translate(x, y, z); parts.push(g); };
    add(new THREE.BoxGeometry(0.55, 0.6, 1.6), 0, 1.25, 0);
    add(new THREE.BoxGeometry(0.3, 0.75, 0.35), 0, 1.65, -0.85);
    add(new THREE.BoxGeometry(0.28, 0.3, 0.6), 0, 1.95, -1.15);
    for (const [x, z] of [[-0.18, -0.6], [0.18, -0.6], [-0.18, 0.6], [0.18, 0.6]]) add(new THREE.BoxGeometry(0.14, 0.95, 0.14), x, 0.48, z);
    add(new THREE.BoxGeometry(0.1, 0.6, 0.12), 0, 1.1, 0.85);
    const merged = new THREE.BufferGeometry(), pos = [], nor = [], idx = []; let off = 0;
    for (const g of parts) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); for (const i of g.index.array) idx.push(i + off); off += g.attributes.position.count; }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); merged.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); merged.setIndex(idx);
    horseGeo = merged;
  }
  return new THREE.Mesh(horseGeo, new THREE.MeshLambertMaterial({ color: 0x6a4428 }));
}

export class Avatar {
  constructor(scene, id) {
    this.scene = scene; this.id = id;
    this.cm = new Caveman(scene);
    scene.remove(this.cm.light); // pooled lights instead (no shader recompiles on join)
    this.cm.baseIntensity = 26;
    this.tag = textSprite(512, 128); this.tag.scale.set(2.2, 0.55, 1); scene.add(this.tag);
    this.bubble = textSprite(512, 192); this.bubble.scale.set(2.6, 0.975, 1); this.bubble.visible = false; scene.add(this.bubble);
    this.buf = []; this.s = null; this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.spd = 0;
    this.info = { name: "…", color: "#c9a27a" }; this.speaking = false; this.talkFlag = false; this.bubbleT = 0; this.emote = null; this.emoteT = 0;
    this.prop = null; this.propKey = ""; this.visible = true; this.lastRx = performance.now();
    this._tagKey = "";
  }
  setInfo(info) {
    Object.assign(this.info, info);
    // their colour on the hide tunic (torso is the chest's first mesh)
    const torso = this.cm.chest.children.find((o) => o.isMesh);
    if (torso) { torso.material = torso.material.clone(); torso.material.color.set(this.info.color); }
    if (info.gear) this.cm.setGear(new Set(info.gear));
    this._drawTag();
  }
  _drawTag() {
    const key = this.info.name + this.info.color + (this.speaking ? 1 : 0) + (this.info.muted ? "m" : "");
    if (key === this._tagKey) return; this._tagKey = key;
    const { c, tex } = this.tag.userData, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = "bold 54px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const label = this.info.name + (this.info.muted ? " 🔇" : "");
    const w = Math.min(500, g.measureText(label).width + (this.speaking ? 120 : 60));
    g.fillStyle = "rgba(10,8,6,0.62)"; g.beginPath(); g.roundRect((512 - w) / 2, 22, w, 84, 40); g.fill();
    g.lineWidth = 6; g.strokeStyle = this.info.color; g.stroke();
    g.fillStyle = "#fff4e2"; g.fillText(label, 256 + (this.speaking ? 26 : 0), 66);
    if (this.speaking) { g.fillStyle = "#53ff7a"; g.beginPath(); g.arc((512 - w) / 2 + 46, 64, 20, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(83,255,122,0.5)"; g.lineWidth = 8; g.beginPath(); g.arc((512 - w) / 2 + 46, 64, 30, 0, Math.PI * 2); g.stroke(); }
    tex.needsUpdate = true;
  }
  setSpeaking(on) { if (on !== this.speaking) { this.speaking = on; this._drawTag(); } }
  say(text) {
    const { c, tex } = this.bubble.userData, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = "40px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const words = String(text).split(/\s+/), lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > 460 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); lines.splice(3); 
    const H = lines.length * 46 + 30, y0 = 150 - H;
    g.fillStyle = "rgba(255,248,232,0.94)"; g.beginPath(); g.roundRect(16, y0, 480, H, 26); g.fill();
    g.beginPath(); g.moveTo(236, y0 + H); g.lineTo(256, y0 + H + 26); g.lineTo(276, y0 + H); g.fill();
    g.fillStyle = "#2a1c10"; lines.forEach((l, i) => g.fillText(l, 256, y0 + 38 + i * 46));
    tex.needsUpdate = true; this.bubble.visible = true; this.bubbleT = 7;
  }
  doEmote(k) { this.emote = k; this.emoteT = k === "dance" ? 4 : 2.2; }
  push(s) {
    this.lastRx = performance.now();
    const L = this.buf[this.buf.length - 1]?.s; if (L && Math.hypot(s.x - L.x, s.z - L.z) > 40) this.buf.length = 0; // round 23: fast travel / teleport: snap, don't glide
    this.buf.push({ t: performance.now() / 1000, s });
    if (this.buf.length > 12) this.buf.shift();
    if (!this.s) { this.s = s; this.pos.set(s.x, s.y, s.z); this.yaw = s.yaw; }
  }
  _sample(now) {
    const b = this.buf; if (!b.length) return null;
    const rt = now - DELAY;
    for (let i = b.length - 1; i > 0; i--) {
      const A = b[i - 1], B = b[i];
      if (A.t <= rt && rt <= B.t) { const k = (rt - A.t) / Math.max(1e-3, B.t - A.t); return { x: A.s.x + (B.s.x - A.s.x) * k, y: A.s.y + (B.s.y - A.s.y) * k, z: A.s.z + (B.s.z - A.s.z) * k, yaw: lerpAng(A.s.yaw, B.s.yaw, k), s: B.s }; }
    }
    const L = b[b.length - 1];
    if (rt > L.t && b.length > 1) { // extrapolate a little past the newest packet
      const P = b[b.length - 2], dt = Math.min(0.25, rt - L.t), span = Math.max(0.03, L.t - P.t);
      return { x: L.s.x + ((L.s.x - P.s.x) / span) * dt, y: L.s.y, z: L.s.z + ((L.s.z - P.s.z) / span) * dt, yaw: L.s.yaw, s: L.s };
    }
    return { x: b[0].s.x, y: b[0].s.y, z: b[0].s.z, yaw: b[0].s.yaw, s: b[0].s };
  }
  _prop(s) {
    const key = s.boat ? "b" + s.boat : s.mounted ? "h" : "";
    if (key === this.propKey) return; this.propKey = key;
    if (this.prop) { this.scene.remove(this.prop); this.prop = null; }
    if (key[0] === "h") this.prop = horseMesh();
    else if (key[0] === "b") this.prop = new THREE.Mesh((BOAT_GEO[s.boat] || BOAT_GEO.canoe)(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    if (this.prop) this.scene.add(this.prop);
  }
  update(dt, show, pxH) {
    const now = performance.now() / 1000, q = this._sample(now);
    const vis = show && !!q && this.visible;
    for (const o of [this.cm.root, this.cm.flame, this.cm.embers, this.tag]) o.visible = vis;
    if (this.prop) this.prop.visible = vis;
    if (!vis) { this.bubble.visible = false; return; }
    const s = q.s;
    const moved = Math.hypot(q.x - this.pos.x, q.z - this.pos.z);
    this.spd += ((dt > 0 ? moved / dt : 0) - this.spd) * Math.min(1, dt * 8);
    this.pos.set(q.x, q.y, q.z); this.yaw = q.yaw;
    this._prop(s);
    const feet = this.pos;
    const eye = new THREE.Vector3(feet.x, feet.y + 1.6, feet.z);
    this.cm.torchBoost = 1;
    this.cm.flame.visible = this.cm.embers.visible = s.torch !== 0;
    this.cm.setWeapon(s.w === 1 ? "bow" : "spear", !!s.armed);
    this.cm.update(dt, { feet, eye, yaw: this.yaw, pitch: s.pitch || 0, speed: Math.min(9, this.spd), runFrac: s.run || 0, stance: s.st || "stand", mounted: !!s.mounted, boat: !!s.boat, stroke: s.boat ? Math.min(1, this.spd / 3) : 0 });
    if (pxH) this.cm.setPixelHeight(pxH);
    // emotes on top of the walk pose
    if (this.emoteT > 0) {
      this.emoteT -= dt; const t = this.cm.time, aR = this.cm.armR;
      if (this.emote === "wave") { aR.sh.rotation.x = -2.7; aR.sh.rotation.z = -0.35 + Math.sin(t * 12) * 0.35; aR.el.rotation.x = -0.4; }
      else if (this.emote === "point") { aR.sh.rotation.x = -1.55; aR.el.rotation.x = 0; }
      else if (this.emote === "dance") { this.cm.root.rotation.y += t * 5; this.cm.root.position.y += Math.abs(Math.sin(t * 9)) * 0.22; aR.sh.rotation.x = -2.4 + Math.sin(t * 9) * 0.5; this.cm.armL.sh.rotation.x = -2.4 - Math.sin(t * 9) * 0.5; }
      if (this.emoteT <= 0) this.emote = null;
    }
    if (this.prop) {
      this.prop.position.set(feet.x, feet.y - (s.boat ? 0.12 + 0.2 : 0), feet.z); this.prop.rotation.set(0, this.yaw, 0);
      if (s.mounted) this.prop.position.y = feet.y;
    }
    const top = feet.y + (s.mounted ? 0.74 : 0) + (s.st === "crawl" ? 1.0 : s.st === "crouch" ? 1.55 : 2.15);
    this.tag.position.set(feet.x, top + 0.18, feet.z);
    if (this.bubbleT > 0) { this.bubbleT -= dt; this.bubble.position.set(feet.x, top + 1.05, feet.z); this.bubble.visible = this.bubbleT > 0; }
  }
  /** World-space torch head (for the pooled light). */
  torch() { return this.cm.light.position; }
  dispose() {
    for (const o of [this.cm.root, this.cm.flame, this.cm.embers, this.tag, this.bubble, this.prop]) if (o) this.scene.remove(o);
    this.tag.userData.tex.dispose(); this.bubble.userData.tex.dispose();
  }
}
