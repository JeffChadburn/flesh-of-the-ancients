/**
 * Round 21: the glowing-mushroom trip. ~3.5 minutes: come-up (0-20 s), rising to a peak (45-120 s),
 * then a long fade. Drives a full-screen post pass (hue cycling, saturation, wavy / breathing UVs,
 * kaleidoscope pulses at the peak, tracers from a feedback buffer), "melting" vertex sway patched
 * into the world's lit materials, and a rainbow sky / fog. The HUD is DOM, so it stays sharp.
 */
import * as THREE from "three";

export const TRIP_LEN = 210;
const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function tripLevel(t) {
  if (t < 0) return 0;
  if (t < 20) return 0.45 * sm(t / 20);
  if (t < 45) return 0.45 + 0.55 * sm((t - 20) / 25);
  if (t < 120) return 1;
  if (t < TRIP_LEN) return 1 - sm((t - 120) / (TRIP_LEN - 120));
  return 0;
}
export function tripPhase(t) { return t < 20 ? "come-up" : t < 45 ? "rising" : t < 120 ? "peak" : t < TRIP_LEN ? "fade" : "over"; }

// ---- melting: a shared uniform patched into lit materials
export const MELT = { value: new THREE.Vector4(0, 0, 0, 0) };
const MELT_GLSL = `
  if (uMelt.x > 0.001) {
    vec4 wq = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wq = instanceMatrix * wq;
    #endif
    wq = modelMatrix * wq;
    float hh = clamp(transformed.y, 0.0, 12.0), a = uMelt.x, tt = uMelt.y;
    transformed.x += sin(wq.y * 0.6 + tt * 1.7 + wq.z * 0.13) * a * 0.11 * hh;
    transformed.z += cos(wq.y * 0.5 + tt * 1.3 + wq.x * 0.11) * a * 0.11 * hh;
    transformed.y -= a * (0.5 + 0.5 * sin(tt * 0.8 + wq.x * 0.21 + wq.z * 0.17)) * 0.1 * hh * hh / (1.0 + hh);
    transformed.y += a * 0.35 * sin(wq.x * 0.08 + tt * 1.1) * sin(wq.z * 0.07 + tt * 0.9);
  }`;
export function meltify(m) {
  if (!m || m.userData.melt || !(m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) return false;
  m.userData.melt = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    if (!s.vertexShader.includes("#include <begin_vertex>")) return;
    s.uniforms.uMelt = MELT;
    s.vertexShader = "uniform vec4 uMelt;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + MELT_GLSL);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|melt";
  m.needsUpdate = true;
  return true;
}
/** Patch every lit material under root (skip: a Set of objects not to touch). Returns how many were new. */
export function meltScene(root, skip) {
  let n = 0;
  root.traverse((o) => {
    if (skip?.has(o)) return;
    if (!o.isMesh || o.userData.noMelt) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (meltify(m)) n++;
  });
  return n;
}
function skipTree(objs) { const s = new Set(); for (const o of objs) o?.traverse((c) => s.add(c)); return s; }

// ---- the post pass
const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
uniform sampler2D tScene, tPrev; uniform float amt, time, calm, kale, aspect, dream; varying vec2 vUv;
vec3 hue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
void main() {
  vec2 c = vUv - 0.5;
  c /= 1.0 + 0.035 * amt * sin(time * 0.9);                       // breathing
  if (kale > 0.001) {                                             // kaleidoscope pulse
    vec2 p = c; p.x *= aspect; float r = length(p), an = atan(p.y, p.x), s = 6.2831853 / 6.0;
    float a2 = abs(mod(an + time * 0.15, s) - s * 0.5); vec2 k = vec2(cos(a2), sin(a2)) * r; k.x /= aspect;
    c = mix(c, k, kale);
  }
  float wv = amt * (1.0 - 0.6 * calm);
  c += wv * 0.011 * vec2(sin(c.y * 17.0 + time * 2.1), cos(c.x * 13.0 + time * 1.7));   // waves
  vec2 uv = clamp(c + 0.5, 0.001, 0.999);
  float ca = 0.006 * wv;
  vec3 col = vec3(texture2D(tScene, uv + vec2(ca, 0.0)).r, texture2D(tScene, uv).g, texture2D(tScene, uv - vec2(ca, 0.0)).b);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(mix(vec3(l), col, 1.0 + 1.3 * amt), 0.0);             // saturate
  float hs = time * (0.55 - 0.4 * calm) + wv * 1.6 * sin(uv.y * 5.0 + uv.x * 3.0 + time * 0.7);
  col = mix(col, max(hue(col, hs), 0.0), amt);                    // hue cycling, in bands
  vec2 pc = (vUv - 0.5) * (0.988 - 0.004 * sin(time)) + 0.5;      // tracers: last frame, slightly zoomed
  vec3 prev = texture2D(tPrev, pc).rgb;
  float tr = amt * (0.86 - 0.36 * calm);
  col = mix(col, max(col, prev * 0.97), tr);
  col = mix(col, prev, tr * 0.35);
  if (dream > 0.001) {                                            // round 23: the spirit vision's soft, warm dream light
    vec3 g = vec3(0.0);
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785 + 0.3; g += texture2D(tScene, uv + vec2(cos(a) / aspect, sin(a)) * 0.014).rgb; }
    g *= 0.125;
    vec3 warm = col * vec3(1.07, 1.0, 0.88) + max(g - 0.3, 0.0) * vec3(1.1, 0.9, 0.65);
    float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(aspect * 0.75, 1.0)));
    warm = mix(warm * 0.62, warm * 1.08, v) + vec3(0.03, 0.022, 0.045);
    col = mix(col, warm, dream);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const COPY = `uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = texture2D(tMap, vUv);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Trip {
  /** o: { renderer, scene, lite() -> bool (low graphics / phone), calm() -> bool, skip: [objects never melted] } */
  constructor(o) {
    this.o = o; this.t = -1; this.on = false; this.level = 0; this.time = 0; this.force = null; this.dream = 0;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = (mat) => { const s = new THREE.Scene(); const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; s.add(m); return s; };
    this.fx = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tPrev: { value: null }, amt: { value: 0 }, time: { value: 0 }, calm: { value: 0 }, kale: { value: 0 }, aspect: { value: 1 }, dream: { value: 0 } } });
    this.copy = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false, toneMapped: true, uniforms: { tMap: { value: null } } });
    this.fxScene = quad(this.fx); this.copyScene = quad(this.copy);
    this.rt = null; this.acc = [null, null]; this.meltT = 0;
    this.skyCol = new THREE.Color(); this.tmpC = new THREE.Color();
  }
  get phase() { return this.on ? tripPhase(this.t) : "none"; }
  start() { this.on = true; this.t = 0; this.force = null; this.meltT = 0; this.clear = true; this.log = (this.log || 0) + 1; }
  /** End early: fade out over `sec` seconds. */
  endSoon(sec = 6) { if (this.on) this.force = { left: sec, from: this.level, sec }; }
  stop() { this.on = false; this.t = -1; this.level = 0; this.force = null; MELT.value.x = 0; }
  update(dt) {
    this.time += dt;
    if (!this.on) { this.level = 0; MELT.value.x = 0; return 0; }
    this.t += dt;
    let L = tripLevel(this.t);
    if (this.force) { this.force.left -= dt; L = Math.min(L, this.force.from * Math.max(0, this.force.left / this.force.sec)); if (this.force.left <= 0) { this.stop(); return 0; } }
    if (this.t >= TRIP_LEN) { this.stop(); return 0; }
    this.level = L;
    const calm = this.o.calm();
    MELT.value.set(L * (calm ? 0.45 : 1), this.time, 0, 0);
    // patch new materials now and then (chunks stream in)
    if ((this.meltT -= dt) <= 0) { this.meltT = 4; meltScene(this.o.scene, skipTree(this.o.skip())); }
    return L;
  }
  /** Rainbow sky + fog (after the atmosphere has set them). */
  tintSky(scene) {
    if (!this.on || this.level <= 0) return;
    const L = this.level, calm = this.o.calm() ? 0.4 : 1;
    this.tmpC.setHSL((this.time * 0.05 * calm) % 1, 0.85, 0.55);
    if (scene.background?.isColor) scene.background.lerp(this.tmpC, L * 0.8);
    if (scene.fog) { this.skyCol.setHSL((this.time * 0.05 * calm + 0.33) % 1, 0.8, 0.5); scene.fog.color.lerp(this.skyCol, L * 0.7); }
  }
  _size(renderer) {
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = this.o.lite() ? 0.5 : 0.8, w = Math.max(2, Math.floor(v.x * k)), h = Math.max(2, Math.floor(v.y * k));
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    this.rt?.dispose(); this.acc.forEach((a) => a?.dispose());
    const opt = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.acc = [new THREE.WebGLRenderTarget(w, h, opt), new THREE.WebGLRenderTarget(w, h, opt)];
    this.clear = true;
  }
  /** Render the frame through the trip pass. */
  render(renderer, scene, camera) {
    this._size(renderer);
    if (!this.on) this.time += 1 / 60;
    const L = Math.max(this.on ? this.level : 0, 0.14 * this.dream), calm = this.o.calm() || this.dream > 0.3, peak = this.on && this.t > 45 && this.t < 120;
    renderer.setRenderTarget(this.rt); renderer.render(scene, camera);
    if (this.clear) { for (const a of this.acc) { renderer.setRenderTarget(a); renderer.clear(); } this.clear = false; }
    const U = this.fx.uniforms;
    U.tScene.value = this.rt.texture; U.tPrev.value = this.acc[0].texture; U.amt.value = L; U.time.value = this.time;
    U.dream.value = this.dream;
    U.calm.value = calm ? 1 : 0; U.aspect.value = this.rt.width / this.rt.height;
    // kaleidoscope pulses: a few seconds in every ~14 s at the peak (gentler / rarer with calm visuals)
    const ph = (this.time % 14) / 14, pulse = peak ? Math.max(0, Math.sin(Math.min(1, ph / 0.3) * Math.PI)) : 0;
    U.kale.value = pulse * (calm ? 0.25 : 0.85) * L;
    renderer.setRenderTarget(this.acc[1]); renderer.render(this.fxScene, this.cam);
    this.copy.uniforms.tMap.value = this.acc[1].texture;
    renderer.setRenderTarget(null); renderer.render(this.copyScene, this.cam);
    this.acc.reverse();
  }
}
