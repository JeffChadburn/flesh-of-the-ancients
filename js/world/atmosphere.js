/**
 * Overworld atmosphere: continuous time of day (sun + moon arcs), sky gradient with sunrise /
 * sunset glow, procedural moving clouds (in the sky shader), stars, weather states with smooth
 * transitions (clear, overcast, fog, rain, snow, storm), rain / snow particles that wrap around
 * the camera (one draw call each, animated on the GPU), lightning flashes + thunder callbacks.
 * Drives the scene lights, fog and ambience levels. Caves never call this (they stay dark).
 */
import * as THREE from "three";
import { mulberry32 } from "../rng.js";

export const WEATHERS = ["clear", "overcast", "fog", "rain", "snow", "storm"];
// cover: cloud cover; light: sun/moon multiplier; fog: fog density multiplier; rain/snow: precipitation;
// wind: cloud speed + ambience; haze: fog colour pulled toward grey.
const WX = {
  clear:    { cover: 0.36, light: 1.0,  fog: 1.0, rain: 0, snow: 0,   wind: 0.35, haze: 0.0, storm: 0 },
  overcast: { cover: 0.82, light: 0.55, fog: 1.6, rain: 0, snow: 0,   wind: 0.55, haze: 0.5, storm: 0 },
  fog:      { cover: 0.6,  light: 0.62, fog: 7.5, rain: 0, snow: 0,   wind: 0.12, haze: 0.85, storm: 0 },
  rain:     { cover: 0.95, light: 0.42, fog: 2.6, rain: 1, snow: 0,   wind: 0.7,  haze: 0.7, storm: 0 },
  snow:     { cover: 0.9,  light: 0.6,  fog: 2.4, rain: 0, snow: 1,   wind: 0.45, haze: 0.75, storm: 0 },
  storm:    { cover: 1.0,  light: 0.26, fog: 3.0, rain: 1.6, snow: 0, wind: 1.0,  haze: 0.8, storm: 1 },
};
const WEIGHTS = { clear: 40, overcast: 20, fog: 10, rain: 15, snow: 6, storm: 9 };

// Keyframes on sun elevation (sun.y): night .. deep twilight .. sunrise .. golden .. day.
const KE = [-0.35, -0.12, -0.02, 0.06, 0.2, 0.5];
const hex = (a) => a.map((h) => new THREE.Color(h));
const K = {
  zen: hex([0x03050c, 0x0b1230, 0x2a3466, 0x3d5c9c, 0x3f72bd, 0x3a76c8]),
  hor: hex([0x0b111e, 0x2a2440, 0x9a6064, 0xf2a064, 0xe6cbaa, 0xb6cfe6]),
  sun: hex([0x8fa4d0, 0x8fa4d0, 0xff7a40, 0xffa060, 0xffdcb0, 0xfff4e4]),
  fog: hex([0x0b0f1a, 0x1c1c2e, 0x5a4450, 0xc39a84, 0xb7bab6, 0xa9bccc]),
  hemiS: hex([0x34446a, 0x434a6c, 0x9a7a8a, 0xc0a090, 0xa0b8d8, 0x9ec4ff]),
  hemiG: hex([0x0c0a08, 0x1a140f, 0x44322a, 0x55432e, 0x4a4030, 0x4c4232]),
  cLit: hex([0x1c2232, 0x3a3048, 0xe08a6a, 0xffc090, 0xfff0e0, 0xffffff]),
  cDark: hex([0x080a10, 0x15131f, 0x5a3a48, 0x8a6a70, 0x9ea6b6, 0xa6aebb]),
};
const KN = {
  light: [1.5, 0.8, 0.8, 1.8, 2.7, 3.1],
  hemi: [1.15, 1.15, 1.5, 1.5, 1.4, 1.4],
  amb: [0.42, 0.4, 0.42, 0.36, 0.3, 0.28],
  fogD: [0.0095, 0.008, 0.006, 0.0045, 0.0034, 0.003],
};
function keyIndex(e) {
  if (e <= KE[0]) return [0, 0];
  for (let i = 0; i < KE.length - 1; i++) if (e <= KE[i + 1]) return [i, (e - KE[i]) / (KE[i + 1] - KE[i])];
  return [KE.length - 2, 1];
}
const lerpC = (arr, i, f, out) => out.copy(arr[i]).lerp(arr[i + 1], f);
const lerpN = (arr, i, f) => arr[i] + (arr[i + 1] - arr[i]) * f;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const SKY_VS = "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }";
const SKY_FS = `varying vec3 vDir;
uniform vec3 uSun, uMoon, uZen, uHor, uSunCol, uFog, uCLit, uCDark;
uniform float uCover, uTime, uFogMix, uFlash, uDay, uMoonLit;
uniform vec2 uWind;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 c = mix(uHor, uZen, pow(max(h, 0.0), 0.5));
  // sunrise / sunset glow around the sun's azimuth, low in the sky
  float sd = max(dot(d, uSun), 0.0);
  float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-4)), 0.0);
  float low = 1.0 - smoothstep(-0.25, 0.35, uSun.y);
  c += uSunCol * pow(az, 5.0) * exp(-max(h, 0.0) * 5.0) * 0.45 * low * smoothstep(-0.3, -0.02, uSun.y);
  c += uSunCol * pow(sd, 8.0) * 0.25 * smoothstep(-0.1, 0.05, uSun.y);
  float disc = smoothstep(0.99955, 0.99975, sd) * smoothstep(-0.04, 0.02, uSun.y);
  float md = max(dot(d, uMoon), 0.0);
  float mdisc = smoothstep(0.99935, 0.99955, md) * smoothstep(-0.02, 0.05, uMoon.y);
  float mglow = pow(md, 70.0) * 0.18 * uMoonLit;
  // clouds: fbm on a plane projected onto the dome, drifting with the wind
  float cov = 0.0; vec3 cc = vec3(0.0);
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.15) * 1.3 + uWind * uTime;
    float n = fbm(uv);
    float edge = 1.0 - uCover;
    cov = smoothstep(edge - 0.08, edge + 0.32, n) * smoothstep(0.0, 0.16, d.y);
    float thick = fbm(uv * 1.9 + 3.1);
    cc = mix(uCDark, uCLit, clamp(0.35 + 1.2 * (n - edge) - thick * 0.35 + sd * 0.3, 0.0, 1.0));
    cc += uSunCol * pow(sd, 6.0) * 0.5 * (1.0 - cov) * smoothstep(-0.05, 0.1, uSun.y);
    cc = mix(cc, cc * 0.55, uCover * uCover * 0.6);
  }
  c += uSunCol * disc * 6.0 * (1.0 - cov * 0.95);
  c += vec3(0.85, 0.88, 0.95) * mdisc * (1.0 - cov) * (0.9 - uDay * 0.5) + vec3(0.6, 0.7, 0.9) * mglow * (1.0 - cov);
  c = mix(c, cc, cov);
  c += vec3(0.55, 0.6, 0.78) * uFlash * (0.35 + cov);
  if (h < 0.0) c = mix(uHor, uFog, 0.65) * (1.0 - min(-h * 2.0, 0.5));
  c = mix(c, uFog, clamp(uFogMix * (1.0 - smoothstep(-0.05, 0.45, h)) + uFogMix * uFogMix * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function precipMaterial(points) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: new THREE.Vector3(36, 22, 36) },
      uSpeed: { value: points ? 1.6 : 19 }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(points ? 0xf2f6ff : 0xaebfd6) }, uSize: { value: 44 },
    },
    vertexShader: `uniform vec3 uCam, uBox; uniform float uTime, uSpeed, uSize; uniform vec2 uWind;
      attribute float aTail; varying float vT;
      void main(){
        vec3 p = position;
        p.y -= uTime * uSpeed;
        p.xz += uWind * uTime ${points ? "+ vec2(sin(uTime * 0.9 + position.y * 1.7), cos(uTime * 0.7 + position.x)) * 0.6" : ""};
        p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
        ${points ? "" : "p.y += aTail * 0.55; p.xz -= aTail * uWind / uSpeed * 0.55;"}
        vT = aTail;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        ${points ? "gl_PointSize = clamp(uSize / max(-mv.z, 0.5), 1.0, 9.0);" : ""}
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vT;
      void main(){
        ${points ? "vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.2, length(q));" : "float a = mix(0.85, 0.15, vT);"}
        gl_FragColor = vec4(uColor, a * uAlpha);
      }`,
  });
}

export class Atmosphere {
  constructor({ lite = false, seed = 1 } = {}) {
    this.lite = lite;
    this.rng = mulberry32((seed ^ 0xa7305) >>> 0);
    this.hours = 19.5;
    this.dayMinutes = 22; // real minutes per full day
    this.weather = "clear";
    this.cur = { ...WX.clear };
    this.blend = 1 / 25; // per second, toward the target weather
    this.nextChange = 3 + this.rng() * 3; // in-game hours until the next weather roll
    this.autoWeather = true;
    this.flash = 0; this.flashT = 0; this.nextBolt = 8;
    this.onThunder = null;
    this.t = 0;
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3();
    this.fogColor = new THREE.Color(); this.state = {};
    this.group = new THREE.Group(); this.group.name = "atmosphere";
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uCLit: { value: new THREE.Color() }, uCDark: { value: new THREE.Color() },
        uCover: { value: 0.2 }, uTime: { value: 0 }, uFogMix: { value: 0 }, uFlash: { value: 0 }, uDay: { value: 0 }, uMoonLit: { value: 1 },
        uWind: { value: new THREE.Vector2(0.012, 0.004) },
      },
      vertexShader: SKY_VS, fragmentShader: SKY_FS,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 18), this.skyMat);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    this.group.add(this.dome);
    const r = mulberry32(seed ^ 0x57a5), n = lite ? 500 : 1100, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * Math.PI * 2, v = Math.pow(r(), 0.6) * 0.95 + 0.05, rr = Math.sqrt(1 - v * v);
      pos[i * 3] = Math.cos(u) * rr * 760; pos[i * 3 + 1] = v * 760; pos[i * 3 + 2] = Math.sin(u) * rr * 760;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xc8d4ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.group.add(this.stars);
    // precipitation (positions are wrapped around the camera in the vertex shader)
    const mk = (count, points) => {
      const g = new THREE.BufferGeometry(), per = points ? 1 : 2;
      const p = new Float32Array(count * per * 3), tail = new Float32Array(count * per), rr = mulberry32(points ? 77 : 99);
      for (let i = 0; i < count; i++) {
        const x = rr() * 36, y = rr() * 22, z = rr() * 36;
        for (let k = 0; k < per; k++) { p.set([x, y, z], (i * per + k) * 3); tail[i * per + k] = k; }
      }
      g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      g.setAttribute("aTail", new THREE.BufferAttribute(tail, 1));
      const m = points ? new THREE.Points(g, precipMaterial(true)) : new THREE.LineSegments(g, precipMaterial(false));
      m.frustumCulled = false; m.renderOrder = 5; m.visible = false;
      return m;
    };
    this.rain = mk(lite ? 900 : 2400, false);
    this.snow = mk(lite ? 600 : 1500, true);
    this.group.add(this.rain, this.snow);
    this.update(0, { eye: new THREE.Vector3(), elevation: 0 });
  }

  setTime(h) { this.hours = ((h % 24) + 24) % 24; }
  skip(h = 1) { this.setTime(this.hours + h); }
  setWeather(name, instant = false) {
    if (!WX[name]) return;
    this.weather = name;
    if (instant) this.cur = { ...WX[name] };
    this.nextChange = 3 + this.rng() * 4;
  }
  cycleWeather() {
    const i = WEATHERS.indexOf(this.weather);
    this.setWeather(WEATHERS[(i + 1) % WEATHERS.length]);
    this._fast = 6; // debug: blend quickly
    return this.weather;
  }
  _roll() {
    const night = this.sunDir.y < -0.1, dawn = this.hours > 4.5 && this.hours < 8;
    let tot = 0; const w = {};
    for (const k of WEATHERS) { w[k] = WEIGHTS[k] * (k === "fog" && (dawn || night) ? 2 : 1); tot += w[k]; }
    let x = this.rng() * tot;
    for (const k of WEATHERS) { x -= w[k]; if (x <= 0) return k; }
    return "clear";
  }
  label() {
    const h = this.hours;
    const part = h < 4.5 ? "Night" : h < 7.5 ? "Dawn" : h < 11 ? "Morning" : h < 14 ? "Midday" : h < 17.5 ? "Afternoon" : h < 20.5 ? "Dusk" : "Night";
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return { part, clock: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, weather: this.weather };
  }

  /**
   * Advance time / weather and return lighting + ambience. `ctx`: { eye, elevation } and optional
   * lights { sun (DirectionalLight), hemi, ambient }, fog (FogExp2), renderer.
   */
  update(dt, ctx) {
    this.t += dt;
    const prevH = this.hours;
    const dh = (dt * 24) / (this.dayMinutes * 60);
    this.setTime(this.hours + dh);
    if (this.autoWeather) {
      this.nextChange -= dh;
      if (this.nextChange <= 0) { const w = this._roll(); (this.rolls = this.rolls || []).push({ at: +this.hours.toFixed(2), prev: +prevH.toFixed(2), dh: +dh.toFixed(3), w }); this.setWeather(w); }
    }
    // weather blend
    const tgt = WX[this.weather];
    const k = Math.min(1, dt * this.blend * (this._fast ? 6 : 1));
    if (this._fast) this._fast = Math.max(0, this._fast - dt);
    for (const key in tgt) this.cur[key] += (tgt[key] - this.cur[key]) * k;
    const W = this.cur;
    // sun / moon arcs: sunrise in the east (+x) at 06:00, high in the south (+z) at noon
    const th = ((this.hours - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(th), Math.sin(th) * 0.92, 0.38 * Math.max(0.2, Math.sin(th)) + 0.1).normalize();
    const mth = th + Math.PI + 0.35;
    this.moonDir.set(Math.cos(mth) * 0.9, Math.sin(mth) * 0.85, -0.3).normalize();
    const e = this.sunDir.y;
    const [i, f] = keyIndex(e);
    const C = (name) => lerpC(K[name], i, f, new THREE.Color());
    const zen = C("zen"), hor = C("hor"), sunCol = C("sun"), fog = C("fog"), hs = C("hemiS"), hg = C("hemiG"), cl = C("cLit"), cd = C("cDark");
    let light = lerpN(KN.light, i, f), hemi = lerpN(KN.hemi, i, f), amb = lerpN(KN.amb, i, f), fogD = lerpN(KN.fogD, i, f);
    // weather: desaturate / darken toward grey, thicken fog
    const grey = (c, amt, lum = 1) => { const l = (c.r * 0.3 + c.g * 0.55 + c.b * 0.15) * lum; c.lerp(new THREE.Color(l, l, l * 1.04), amt); return c; };
    grey(zen, W.cover * 0.75, 0.9); grey(hor, W.cover * 0.6); grey(sunCol, W.cover * 0.5);
    grey(fog, W.haze * 0.7, 1.05); grey(hs, W.cover * 0.5);
    if (W.cover > 0.5) { zen.multiplyScalar(1 - (W.cover - 0.5) * 0.7); hor.multiplyScalar(1 - (W.cover - 0.5) * 0.45); }
    light *= W.light; hemi *= 0.55 + 0.45 * W.light; fogD *= W.fog;
    fog.multiplyScalar(0.7 + 0.3 * W.light);
    // lightning
    if (W.storm > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + this.rng() * 14;
        this.flashT = 0.6; const dist = 0.3 + this.rng() * 2.6;
        this.onThunder?.(dist, Math.max(0.3, 1.2 - dist * 0.3));
        this.bolts = (this.bolts || 0) + 1;
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const ph = 0.6 - this.flashT;
      this.flash = ph < 0.08 ? 1 : ph < 0.16 ? 0.25 : ph < 0.24 ? 0.8 : Math.max(0, 0.6 - ph * 1.5);
    } else this.flash = 0;
    const day = smooth(-0.05, 0.25, e), night = 1 - smooth(-0.15, -0.01, e);
    const u = this.skyMat.uniforms;
    u.uSun.value.copy(this.sunDir); u.uMoon.value.copy(this.moonDir);
    u.uZen.value.copy(zen); u.uHor.value.copy(hor); u.uSunCol.value.copy(sunCol); u.uFog.value.copy(fog);
    u.uCLit.value.copy(cl); u.uCDark.value.copy(cd);
    u.uCover.value = W.cover; u.uTime.value = this.t; u.uFlash.value = this.flash; u.uDay.value = day; u.uMoonLit.value = night;
    u.uFogMix.value = Math.min(1, (W.fog - 1) / 6.5);
    u.uWind.value.set(0.006 + W.wind * 0.02, 0.002 + W.wind * 0.006);
    this.starMat.opacity = 0.85 * night * (1 - W.cover * 0.95) * (1 - u.uFogMix.value);
    this.stars.visible = this.starMat.opacity > 0.01;
    this.stars.rotation.y = this.hours * 0.02;
    const eye = ctx.eye;
    this.group.position.set(0, 0, 0);
    this.dome.position.copy(eye); this.stars.position.copy(eye);
    // precipitation: rain above the snow line turns to snow; snow state is heavier up high
    const elev = ctx.elevation || 0;
    const snowLine = 70;
    let rainA = W.rain, snowA = W.snow * (0.55 + 0.45 * smooth(10, 60, elev));
    if (elev > snowLine) { snowA = Math.max(snowA, rainA * 0.9); rainA = 0; }
    this.precip = { rain: rainA, snow: snowA };
    for (const [m, a] of [[this.rain, rainA], [this.snow, snowA]]) {
      m.visible = a > 0.02;
      const mu = m.material.uniforms;
      mu.uCam.value.copy(eye); mu.uTime.value = this.t % 1000;
      mu.uAlpha.value = Math.min(1, a) * (m === this.rain ? 0.75 : 0.95) * (0.45 + 0.55 * Math.max(day, 0.35));
      mu.uWind.value.set(0.6 + W.wind * 3, 0.2 + W.wind);
    }
    this.rain.geometry.setDrawRange(0, Math.floor(this.rain.geometry.attributes.position.count * Math.min(1, rainA / 1.6 + 0.35)));
    // lights
    const L = ctx.lights;
    const useSun = e > -0.06;
    const body = useSun ? this.sunDir : this.moonDir;
    if (L) {
      L.sun.color.copy(useSun ? sunCol : K.sun[0]);
      L.sun.intensity = light * (useSun ? smooth(-0.06, 0.03, e) : smooth(-0.04, 0.12, this.moonDir.y) * smooth(-0.02, -0.12, e)) + this.flash * 5;
      if (!useSun) L.sun.intensity = Math.max(L.sun.intensity, 0) ;
      L.sun.position.copy(eye).addScaledVector(body, 100);
      L.sun.target.position.copy(eye);
      L.hemi.color.copy(hs); L.hemi.groundColor.copy(hg); L.hemi.intensity = hemi + this.flash * 2;
      L.ambient.color.set(0x0d0b10).lerp(new THREE.Color(0x8a96aa), day * 0.6);
      L.ambient.intensity = amb;
    }
    if (ctx.fog) { ctx.fog.color.copy(fog); ctx.fog.density = fogD; }
    if (ctx.renderer) ctx.renderer.setClearColor(fog, 1);
    this.fogColor.copy(fog);
    this.horizonLight = (this.horizonLight || new THREE.Color()).copy(hs).multiplyScalar(hemi * 0.42)
      .add(new THREE.Color().copy(sunCol).multiplyScalar(light * 0.22 * smooth(-0.05, 0.2, e))).addScalar(this.flash * 0.4);
    const dawnF = smooth(4.6, 5.8, this.hours) * (1 - smooth(7.2, 8.6, this.hours));
    this.state = {
      hours: +this.hours.toFixed(2), weather: this.weather, sunY: +e.toFixed(3), day: +day.toFixed(2), night: +night.toFixed(2), dawn: +dawnF.toFixed(2),
      rain: +rainA.toFixed(2), snow: +snowA.toFixed(2), storm: +W.storm.toFixed(2), wind: +W.wind.toFixed(2), cover: +W.cover.toFixed(2), flash: this.flash,
      light: +light.toFixed(2), fogD: +fogD.toFixed(4),
      // torch matters more at night (and in storms); in daylight it is a small warm accent
      torch: +Math.max(0.3, 1 - day * 0.7 * W.light).toFixed(2),
      light01: Math.min(1, light / 3 + hemi / 6),
    };
    return this.state;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
}
