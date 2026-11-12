/**
 * Player character: an original stylized low-poly caveman built from primitives
 * (hide tunic, fur wraps, wild hair and beard, bare arms) holding a burning torch (left hand)
 * and a stone-tipped spear (right hand). Procedural walk / run / crouch / crawl / thrust animation.
 * The torch carries the only real light in the cave: a warm flickering point light + flame and
 * ember particles (one draw call each, animated in the vertex shader).
 */
import * as THREE from "three";
import { addDetail, smoothTree } from "./realism.js";

const SKIN = 0xb98461, HIDE = 0x5e4129, FUR = 0x3b2a1d, HAIR = 0x22170f, WOOD = 0x6e4b2c, STONE = 0x77726b;

function mat(color, rough = 0.85, extra = {}) {
  // faint warm self-glow stands in for torch bounce, so the back never reads as a pure black cut-out
  const c = new THREE.Color(color);
  // round 14: smooth shading + skin / hide / fur micro-variation, slightly muted
  return addDetail(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: false, emissive: new THREE.Color(0x3a2010).multiply(c.clone().addScalar(0.35)), emissiveIntensity: 0.55, ...extra }), { scale: 9, amt: 0.16, sat: 0.8, ao: 0.08, bump: 0.05 });
}
function shaggy(geo, amt, seed = 1) {
  // Roughen a primitive so it reads as fur / hair / stone (deterministic).
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = map.get(key);
    if (k === undefined) {
      const h = Math.sin((p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719 + seed) * 43758.5453);
      k = 1 + (h - Math.floor(h) - 0.5) * 2 * amt;
      map.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function limb(len, r0, r1, material) {
  // Pivot at top, hanging down -Y.
  const g = new THREE.CylinderGeometry(r0, r1, len, 7, 1);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, material);
  const pivot = new THREE.Group();
  pivot.add(m);
  pivot.userData.len = len;
  return pivot;
}

function flameMaterial(count, kind) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 800 }, uWind: { value: new THREE.Vector3() } },
    vertexShader: `
      uniform float uTime; uniform float uPx; uniform vec3 uWind;
      attribute float aSeed;
      varying float vLife; varying float vSeed;
      void main() {
        float rate = ${kind === "ember" ? "0.45" : "2.4"} + aSeed * ${kind === "ember" ? "0.35" : "1.2"};
        float life = fract(uTime * rate + aSeed * 7.13);
        vLife = life; vSeed = aSeed;
        vec3 p = position;
        ${kind === "ember"
          ? `p += vec3(sin(uTime * 2.0 + aSeed * 40.0) * 0.12 * life, life * 1.1, cos(uTime * 1.7 + aSeed * 31.0) * 0.12 * life) - uWind * life * 0.6;`
          : `float a = aSeed * 6.2831; float r = 0.045 * (1.0 - life) ;
             p += vec3(cos(a) * r + sin(uTime * 9.0 + aSeed * 20.0) * 0.012, life * 0.30, sin(a) * r) - uWind * life * 0.18;`}
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float sz = ${kind === "ember" ? "0.018 * (1.0 - life)" : "0.11 * sin(3.1416 * min(1.0, life * 1.25 + 0.05)) * (1.0 - life * 0.5)"};
        gl_PointSize = clamp(sz * uPx / max(-mv.z, 0.05), 1.0, 90.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vLife; varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        ${kind === "ember"
          ? `vec3 c = mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.25, 0.05), vLife); float a = (1.0 - d) * (1.0 - vLife) * step(0.25, fract(vSeed * 13.0 + vLife * 3.0));`
          : `vec3 c = mix(vec3(1.0, 0.92, 0.6), vec3(1.0, 0.38, 0.06), smoothstep(0.05, 0.6, vLife)); c = mix(c, vec3(0.5, 0.08, 0.02), smoothstep(0.6, 1.0, vLife));
             float a = pow(1.0 - d, 1.6) * (1.0 - vLife) * 0.9;`}
        gl_FragColor = vec4(c * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}
function particles(count, kind) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = (i + 0.5) / count + Math.sin(i * 91.7) * 0.003;
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const m = flameMaterial(count, kind);
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 12;
  return pts;
}

export class Caveman {
  constructor(scene) {
    const root = (this.root = new THREE.Group());
    root.name = "caveman";
    scene.add(root);
    const skin = mat(SKIN, 0.7), hide = mat(HIDE, 0.95), fur = mat(FUR, 1), hair = mat(HAIR, 1), wood = mat(WOOD, 0.8), stone = mat(STONE, 0.6);

    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    root.add(this.hips);
    // Fur skirt / loincloth.
    const skirt = new THREE.Mesh(shaggy(new THREE.CylinderGeometry(0.2, 0.27, 0.34, 9, 2, true), 0.12, 3), fur);
    skirt.position.y = -0.08;
    skirt.material.side = THREE.DoubleSide;
    this.hips.add(skirt);

    this.chest = new THREE.Group();
    this.chest.position.y = 0.06;
    this.hips.add(this.chest);
    const torso = new THREE.Mesh(shaggy(new THREE.CylinderGeometry(0.23, 0.2, 0.58, 9, 2), 0.06, 5), hide);
    torso.scale.z = 0.72;
    torso.position.y = 0.29;
    this.chest.add(torso);
    const pelt = new THREE.Mesh(shaggy(new THREE.SphereGeometry(0.17, 8, 6), 0.22, 9), fur); // shoulder pelt
    pelt.scale.set(1.1, 0.55, 0.9);
    pelt.position.set(0.15, 0.56, 0);
    this.chest.add(pelt);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 5, 12), mat(0x2c1d12, 1));
    belt.rotation.x = Math.PI / 2;
    belt.scale.y = 0.75;
    belt.position.y = 0.03;
    this.chest.add(belt);

    this.neck = new THREE.Group();
    this.neck.position.y = 0.6;
    this.chest.add(this.neck);
    const head = new THREE.Mesh(shaggy(new THREE.SphereGeometry(0.12, 10, 8), 0.05, 2), skin);
    head.scale.set(0.95, 1.08, 1);
    head.position.y = 0.14;
    this.neck.add(head);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.05), skin);
    brow.position.set(0, 0.19, -0.1);
    this.neck.add(brow);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 5), skin);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.13, -0.13);
    this.neck.add(nose);
    const mane = new THREE.Mesh(shaggy(new THREE.IcosahedronGeometry(0.16, 1), 0.35, 11), hair);
    mane.scale.set(1.05, 0.95, 1.05);
    mane.position.set(0, 0.2, 0.035);
    this.neck.add(mane);
    const beard = new THREE.Mesh(shaggy(new THREE.ConeGeometry(0.11, 0.24, 7, 2), 0.25, 13), hair);
    beard.rotation.x = Math.PI;
    beard.position.set(0, 0.0, -0.06);
    this.neck.add(beard);
    this.headParts = [head, brow, nose, mane, beard];
    this.bodyParts = [torso, pelt, belt, skirt];

    // Arms: pivots at shoulders.
    const mkArm = (side) => {
      const sh = limb(0.3, 0.06, 0.05, skin);
      sh.position.set(side * 0.27, 0.52, 0);
      this.chest.add(sh);
      const el = limb(0.28, 0.05, 0.042, skin);
      el.position.y = -0.3;
      sh.add(el);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 7, 5), skin);
      hand.position.y = -0.3;
      el.add(hand);
      const grip = new THREE.Group();
      grip.position.y = -0.3;
      el.add(grip);
      return { sh, el, grip };
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    // Legs.
    const mkLeg = (side) => {
      const th = limb(0.45, 0.085, 0.065, fur);
      th.position.set(side * 0.11, 0, 0);
      this.hips.add(th);
      const sh = limb(0.44, 0.06, 0.045, skin);
      sh.position.y = -0.45;
      th.add(sh);
      const foot = new THREE.Mesh(shaggy(new THREE.BoxGeometry(0.1, 0.07, 0.22), 0.1, side + 4), hide);
      foot.position.set(0, -0.46, -0.05);
      sh.add(foot);
      return { th, sh };
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    // Spear in right hand (points forward -Z when the forearm points forward).
    const spear = (this.spear = new THREE.Group());
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.9, 6), wood);
    shaft.position.y = -0.55;
    spear.add(shaft);
    const tip = new THREE.Mesh(shaggy(new THREE.OctahedronGeometry(0.06, 0), 0.15, 21), stone);
    tip.scale.set(0.7, 2.6, 0.35);
    tip.position.y = -1.6;
    spear.add(tip);
    const bind = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), mat(0x3a2716, 1));
    bind.position.y = -1.47;
    spear.add(bind);
    this.armR.grip.add(spear);
    this.spearTip = new THREE.Object3D();
    this.spearTip.position.y = -1.75;
    spear.add(this.spearTip);

    // Bow (round 9), in the same hand frame as the spear: a bent stave arcing up/down in front of
    // the fist with its string toward Kra. Hidden until the bow is selected.
    const bow = (this.bow = new THREE.Group());
    const stave = new THREE.TorusGeometry(0.55, 0.026, 5, 16, 1.8);
    stave.rotateZ(-Math.PI / 2 - 0.9); stave.rotateY(Math.PI / 2); stave.translate(0, 0.55, 0);
    // canted like a hunter's bow so its curve reads from behind (edge-on it was just a stick)
    const cant = new THREE.Group(); cant.rotation.z = 1.15; cant.scale.setScalar(1.15); bow.add(cant);
    cant.add(new THREE.Mesh(stave, wood));
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.86, 3), mat(0xd8cfb8, 1));
    str.rotation.x = Math.PI / 2; str.position.y = 0.21; cant.add(str);
    const nock = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 4), wood);
    nock.position.y = -0.12; cant.add(nock);
    bow.visible = false;
    this.armR.grip.add(bow);
    // Round 19: a paddle (in the same hand) shown while Kra is in a boat
    const paddle = (this.paddle = new THREE.Group());
    const pS = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.7, 5), wood); pS.position.y = -0.35; paddle.add(pS);
    const pB = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.48, 0.03), wood); pB.position.y = -1.1; paddle.add(pB);
    paddle.visible = false;
    this.armR.grip.add(paddle);
    this.weapon = "spear"; this.armed = true;

    // Torch in left hand: stick + charred head, flame + embers + light.
    const torch = (this.torch = new THREE.Group());
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.55, 6), wood);
    stick.position.y = -0.12;
    torch.add(stick);
    const head2 = new THREE.Mesh(shaggy(new THREE.CylinderGeometry(0.05, 0.04, 0.13, 7), 0.2, 17), mat(0x1c1410, 1, { emissive: 0x401204, emissiveIntensity: 0.6 }));
    head2.position.y = -0.42;
    torch.add(head2);
    this.flameAnchor = new THREE.Group();
    this.flameAnchor.position.y = -0.48;
    torch.add(this.flameAnchor);
    this.armL.grip.add(torch);
    smoothTree(root); // round 14: rounder, organic shading on Kra
    this.flame = particles(40, "flame");
    this.embers = particles(22, "ember");
    // Flame and embers live in world space under the scene so they rise straight up.
    scene.add(this.flame);
    scene.add(this.embers);

    this.light = new THREE.PointLight(0xffb37d, 26, 45, 1.0); // round 14: less orange, closer to real firelight on limestone
    scene.add(this.light);
    this.torchPos = new THREE.Vector3();

    this.phase = 0;
    this.time = 0;
    this.fp = false;
    this.attackT = -1;
    this._prevTorch = new THREE.Vector3();
    root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }

  /** Round 16: crafted clothing shows on Kra. gear: Set of "boots" | "cloak" | "hat" | "paint". */
  setGear(gear) {
    const key = [...gear].sort().join(",");
    if (key === this._gearKey) return; this._gearKey = key;
    if (!this.gear) {
      const hide = mat(0x6a4a30, 0.95), fur = mat(0x8a7356, 1);
      const g = (this.gear = {});
      // cloak: an open hide cone over the shoulders, hanging down the back
      const cl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.78, 12, 1, true, Math.PI * 0.18, Math.PI * 1.64), hide);
      cl.material = cl.material.clone(); cl.material.side = THREE.DoubleSide;
      cl.position.set(0, 0.25, 0.03); cl.scale.z = 0.8; this.chest.add(cl); g.cloak = [cl];
      // fur hat: a shaggy cap over the mane
      const hat = new THREE.Mesh(shaggy(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, 1.45), 0.25, 31), fur);
      hat.position.set(0, 0.22, 0.02); hat.scale.set(1.08, 0.95, 1.08); this.neck.add(hat); g.hat = [hat];
      // boots: fur wraps on the shins + feet
      g.boots = [];
      for (const L of [this.legL, this.legR]) { const b = new THREE.Mesh(shaggy(new THREE.CylinderGeometry(0.068, 0.075, 0.26, 8), 0.15, 33), fur); b.position.y = -0.33; L.sh.add(b); g.boots.push(b); }
      // face paint: red ochre stripes across the brow and cheeks
      const red = mat(0x9a1e12, 0.7, { emissive: 0x2a0402, emissiveIntensity: 0.4 });
      g.paint = [];
      for (const [y, w] of [[0.165, 0.2], [0.115, 0.18]]) { const st = new THREE.Mesh(new THREE.BoxGeometry(w, 0.022, 0.03), red); st.position.set(0, y, -0.115); this.neck.add(st); g.paint.push(st); }
      for (const m of [...g.cloak, ...g.hat, ...g.paint]) (g.cloak.includes(m) ? this.bodyParts : this.headParts).push(m);
      this.legBoots = g.boots;
    }
    for (const [k, list] of Object.entries(this.gear)) for (const m of list) m.visible = gear.has(k) && !(this.fp && k !== "boots");
  }

  setFirstPerson(fp) {
    this.fp = fp;
    for (const m of [...this.headParts, ...this.bodyParts]) m.visible = !fp;
    if (this.gear) { const on = new Set(this._gearKey ? this._gearKey.split(",") : []); this._gearKey = null; this.setGear(on); }
    this.legL.th.visible = !fp;
    this.legR.th.visible = !fp;
  }

  setWeapon(w, armed = this.armed) {
    this.weapon = w; this.armed = armed;
    this.spear.visible = armed && w === "spear";
    this.bow.visible = armed && w === "bow";
  }

  /** Start a spear thrust (0.38 s). */
  thrust() { this.attackT = 0; }

  /**
   * feet: world position of the feet; yaw/pitch of the view; speed m/s; runFrac 0..1; stance.
   */
  update(dt, { feet, yaw, pitch, speed, runFrac, stance, eye, mounted = false, boat = false, stroke = 0 }) {
    this.time += dt;
    const t = this.time;
    const r = this.root;
    r.position.copy(feet);
    r.rotation.set(0, yaw, 0);
    if (this.fp) {
      // Sit the body so the shoulders are just below / behind the eye: arms, torch and spear in view.
      const back = stance === "crawl" ? 0.05 : 0.18;
      r.position.x += Math.sin(yaw) * back;
      r.position.z += Math.cos(yaw) * back;
      r.position.y = eye.y - (stance === "crawl" ? 0.55 : stance === "crouch" ? 1.25 : 1.6) + 0.02;
    }
    if (mounted) r.position.y += 0.74; // round 12: astride the horse's back
    const amp = mounted || boat ? 0 : Math.min(1, speed / 2.3);
    const stride = stance === "crawl" ? 0.5 : stance === "crouch" ? 0.6 : 0.8 + runFrac * 2.1; // round 12: longer bounds at the 3x sprint
    this.phase += (speed * dt / stride) * Math.PI;
    const ph = this.phase;
    const sw = Math.sin(ph);
    const legAmp = amp * (0.55 + runFrac * 0.35);

    // Base pose per stance.
    let hipsY = 0.95, lean = -0.04 - runFrac * 0.18, thighBase = 0, kneeBase = 0;
    if (stance === "crouch") { hipsY = 0.6; lean = -0.45; thighBase = 1.1; kneeBase = -1.7; }
    if (stance === "crawl") { hipsY = 0.42; lean = -1.25; thighBase = 1.35; kneeBase = -1.55; }
    if (mounted) { hipsY = 0.95; lean = -0.1 - runFrac * 0.3 + Math.sin(t * Math.max(2, speed * 0.9)) * 0.04 * Math.min(1, speed / 6); thighBase = 1.2; kneeBase = -1.45; }
    if (boat) { hipsY = 0.36; lean = -0.12; thighBase = 1.45; kneeBase = -0.5; } // round 19: sitting in a boat, legs forward
    const spread = mounted ? 0.42 : boat ? 0.12 : 0;
    this.legL.th.rotation.z += (-spread - this.legL.th.rotation.z) * Math.min(1, dt * 10);
    this.legR.th.rotation.z += (spread - this.legR.th.rotation.z) * Math.min(1, dt * 10);
    this.hips.position.y += (hipsY + Math.abs(sw) * 0.045 * amp * (stance === "stand" ? 1 : 0.4) - this.hips.position.y) * Math.min(1, dt * 12);
    this.chest.rotation.x += (lean - this.chest.rotation.x) * Math.min(1, dt * 8);
    this.chest.rotation.y = sw * 0.08 * amp;
    // Keep the head level-ish while the torso leans; look up/down with the view in 3rd person.
    this.neck.rotation.x = -this.chest.rotation.x * 0.8 + (this.fp ? 0 : -pitch * 0.4);

    const crawl = stance === "crawl";
    this.legL.th.rotation.x = thighBase + sw * legAmp * (crawl ? 0.4 : 1);
    this.legR.th.rotation.x = thighBase - sw * legAmp * (crawl ? 0.4 : 1);
    this.legL.sh.rotation.x = kneeBase - Math.max(0, -Math.cos(ph)) * legAmp * 1.2;
    this.legR.sh.rotation.x = kneeBase - Math.max(0, Math.cos(ph)) * legAmp * 1.2;

    // Arms: torch held up and forward, spear low and forward; small swing with the gait.
    const lift = crawl ? 0.9 : 0; // crawling: arms reach down/forward relative to the leaning chest
    const look = this.fp ? -pitch * 0.6 : 0;
    this.armL.sh.rotation.set((this.fp ? 1.05 : 0.75) - lift * 0.3 + look + sw * 0.08 * amp, 0, this.fp ? -0.18 : -0.62);
    this.armL.el.rotation.x = 0.75 + Math.sin(t * 3.1) * 0.02;
    // Torch stays upright: counter-rotate the stick.
    this.torch.rotation.x = Math.PI - (this.armL.sh.rotation.x + this.armL.el.rotation.x + this.chest.rotation.x);
    this.torch.rotation.z = this.fp ? 0.18 : 0.62;

    let a = 0;
    if (this.attackT >= 0) {
      this.attackT += dt / 0.38;
      a = this.attackT < 1 ? Math.sin(Math.PI * Math.min(1, this.attackT * 1.15)) : 0;
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.armR.sh.rotation.set(0.55 + a * 0.85 + look - lift * 0.2 - sw * 0.1 * amp, 0, 0.12 - a * 0.1);
    this.armR.el.rotation.x = 1.05 - a * 0.95;
    // Spear aims along the view forward (-Z) and pushes forward on the thrust.
    const armPitch = this.armR.sh.rotation.x + this.armR.el.rotation.x + this.chest.rotation.x;
    this.spear.rotation.x = Math.PI / 2 - armPitch + (this.fp ? -pitch * 0.5 : 0);
    this.spear.position.y = -a * 0.25;
    this.bow.rotation.x = this.spear.rotation.x;
    this.bow.position.y = this.weapon === "bow" ? a * 0.12 : 0; // recoil on release
    // Round 19: paddling. Reach forward, pull back along the side; the torso twists with the stroke.
    if (boat !== !!this._boat) { this._boat = boat; this.paddle.visible = boat; if (boat) { this._sv = [this.spear.visible, this.bow.visible]; this.spear.visible = this.bow.visible = false; } else if (this._sv) { [this.spear.visible, this.bow.visible] = this._sv; } }
    if (boat) {
      this.padPh = (this.padPh || 0) + dt * (1.6 + Math.abs(stroke) * 2.4) * (stroke < 0 ? -1 : 1) * Math.min(1, Math.abs(stroke) * 3 + 0.05);
      const k = Math.min(1, Math.abs(stroke) * 2), sp = Math.sin(this.padPh);
      this.armR.sh.rotation.set(0.75 + sp * 0.55 * k, 0, 0.3 + 0.1 * k);
      this.armR.el.rotation.x = 0.55 - Math.cos(this.padPh) * 0.25 * k;
      this.chest.rotation.y = sp * 0.22 * k;
      const ap = this.armR.sh.rotation.x + this.armR.el.rotation.x + this.chest.rotation.x;
      this.paddle.rotation.set(-ap + 0.25 - sp * 0.35 * k, 0, 0.35);
    }

    // Torch light + flame follow the torch head (world space).
    this.root.updateMatrixWorld(true);
    this.flameAnchor.getWorldPosition(this.torchPos);
    const flick = 0.82 + 0.1 * Math.sin(t * 13.1) + 0.07 * Math.sin(t * 23.7 + 1.3) + 0.06 * Math.sin(t * 7.3 + Math.sin(t * 1.7) * 2);
    // round 24: the torch can be shaded (L / 🔥): the flame drops to a faint ember glow
    let tk = 1;
    if (this.torchDown !== undefined) {
      this._torchK = (this._torchK ?? 1) + ((this.torchDown ? 0.07 : 1) - (this._torchK ?? 1)) * Math.min(1, (dt || 0.016) * 6);
      tk = this._torchK; this.flame.visible = this.embers.visible = tk > 0.35;
    }
    this.light.intensity = this.baseIntensity * flick * (this.torchBoost || 1) * tk;
    this.light.position.set(this.torchPos.x + Math.sin(t * 11) * 0.02, this.torchPos.y + 0.12, this.torchPos.z + Math.cos(t * 9) * 0.02);
    this.flame.position.copy(this.torchPos);
    this.embers.position.copy(this.torchPos);
    const wind = this.flame.material.uniforms.uWind.value;
    if (dt > 0) wind.lerp(this._prevTorch.clone().sub(this.torchPos).multiplyScalar(-1 / Math.max(dt, 1e-3) * 0.25), Math.min(1, dt * 6));
    this._prevTorch.copy(this.torchPos);
    for (const p of [this.flame, this.embers]) p.material.uniforms.uTime.value = t;
  }

  get baseIntensity() { return this._base ?? 13; }
  set baseIntensity(v) { this._base = v; }

  setPixelHeight(px) {
    this.flame.material.uniforms.uPx.value = px;
    this.embers.material.uniforms.uPx.value = px;
  }

  /** World position of the spear tip (for hit tests / debug). */
  tipWorld(out = new THREE.Vector3()) { return this.spearTip.getWorldPosition(out); }
}
