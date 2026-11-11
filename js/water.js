/** Stream, waterfall, and pool — shallow, walkable, animated. */

import * as THREE from "three";
import { stationMap, stationWorld } from "./cave-data.js";

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uFlow;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vFogDepth;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = vUv;
    float flow = uTime * uFlow;
    float n = noise(uv * vec2(4.0, 12.0) + vec2(0.0, -flow));
    n += 0.5 * noise(uv * vec2(9.0, 22.0) + vec2(flow * 0.4, -flow * 1.6));
    n /= 1.5;
    float foam = smoothstep(0.72, 0.95, n) * 0.5;
    float fres = pow(0.55 + 0.45 * n, 1.4);
    vec3 col = mix(uDeep, uShallow, fres);
    col += foam * 0.35;
    col += vec3(0.15, 0.2, 0.22) * pow(n, 3.0);
    // Only the headlamp lights the water: fade with distance so it never glows in the dark.
    float lit = clamp(2.4 / (1.0 + 0.045 * vFogDepth * vFogDepth), 0.06, 1.15);
    col *= lit;
    col += vec3(0.5, 0.55, 0.55) * pow(n, 7.0) * lit;
    float alpha = 0.5 + foam * 0.25;
    gl_FragColor = vec4(col, alpha);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(fogFactor, 0.0, 1.0));
  }
`;

function waterMaterial(flow = 0.35, deep = new THREE.Color(0x0b2a33), shallow = new THREE.Color(0x3d7a7a)) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: flow },
      uDeep: { value: deep },
      uShallow: { value: shallow },
      uFogColor: { value: new THREE.Color(0x050308) },
      uFogDensity: { value: 0.03 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function addWater(group, cave) {
  const water = cave.water;
  const handle = { materials: [], update() {}, features: { stream: null, waterfall: null, pool: null } };
  // Still pools from a traced survey (Devil's Spring, Mirror Lake, ...).
  if (Array.isArray(cave.pools) && cave.pools.length) {
    const smap0 = stationMap(cave);
    const mat = waterMaterial(0.05, new THREE.Color(0x0a1d22), new THREE.Color(0x3c6e6c));
    handle.materials.push(mat);
    for (const pl of cave.pools) {
      const s = smap0.get(pl.near);
      if (!s) continue;
      const p = stationWorld(s);
      const m = new THREE.Mesh(new THREE.CircleGeometry(pl.r || 3, 40), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x + (pl.dx || 0), p.y - s.down + 0.16, p.z - (pl.dy || 0));
      m.renderOrder = 2;
      group.add(m);
      if (!handle.features.pool) handle.features.pool = { x: m.position.x, y: m.position.y, z: m.position.z, radius: pl.r || 3 };
    }
    handle.update = (time, fogColor, fogDensity) => {
      mat.uniforms.uTime.value = time * 0.001;
      if (fogColor) mat.uniforms.uFogColor.value.copy(fogColor);
      if (fogDensity != null) mat.uniforms.uFogDensity.value = fogDensity;
    };
  }
  if (!water || !water.legs || !water.legs.length) return handle;

  const smap = stationMap(cave);
  const mats = handle.materials;
  const streamMat = waterMaterial(0.4, new THREE.Color(0x07161a), new THREE.Color(0x2c4e4c));
  const fallMat = waterMaterial(1.15, new THREE.Color(0x143c48), new THREE.Color(0x9ad0d0));
  const poolMat = waterMaterial(0.12, new THREE.Color(0x05131a), new THREE.Color(0x24484a));
  mats.push(streamMat, fallMat, poolMat);

  // Stream ribbon as one floor-hugging polyline along the water path.
  const positions = [];
  const uvs = [];
  const indices = [];
  const width = water.width || 0.42;
  const pts = [];
  const ids = (water.stationIds && water.stationIds.length >= 2)
    ? water.stationIds
    : null;
  if (ids) {
    for (let i = 0; i < ids.length - 1; i++) {
      const a = smap.get(ids[i]);
      const b = smap.get(ids[i + 1]);
      if (!a || !b) continue;
      const pa = stationWorld(a);
      const pb = stationWorld(b);
      const segs = Math.max(2, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z) * 1.5));
      for (let s = (i === 0 ? 0 : 1); s <= segs; s++) {
        const t = s / segs;
        const down = a.down + (b.down - a.down) * t;
        pts.push({
          x: pa.x + (pb.x - pa.x) * t,
          y: pa.y + (pb.y - pa.y) * t - down + 0.05,
          z: pa.z + (pb.z - pa.z) * t,
        });
      }
    }
  }
  // Smooth sideways vectors so the ribbon does not flip.
  let vlen = 0;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // right = up × tangent, then flatten slightly so it stays a stream, not a wall
    let rx = tz, ry = 0, rz = -tx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; rz /= rl;
    const w = width * (0.88 + 0.12 * Math.sin(vlen * 0.8));
    const u = vlen * 0.28;
    positions.push(pts[i].x - rx * w, pts[i].y, pts[i].z - rz * w);
    positions.push(pts[i].x + rx * w, pts[i].y, pts[i].z + rz * w);
    uvs.push(0, u, 1, u);
    if (i > 0) vlen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a0 = i * 2;
    indices.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
  }
  if (pts.length) {
    const mid = pts[Math.floor(pts.length * 0.45)] || pts[0];
    const ahead = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.45) + 2)] || pts[pts.length - 1];
    handle.features.stream = { x: mid.x, y: mid.y, z: mid.z, lookX: ahead.x, lookY: ahead.y, lookZ: ahead.z };
  }
  if (positions.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, streamMat);
    mesh.name = "stream";
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  // Find the real floor height of the rock mesh (walls are noise-displaced, so
  // station LRUD values alone can bury the pool or the waterfall base).
  const rockMesh = group.getObjectByName("passages");
  const ray = new THREE.Raycaster();
  const downV = new THREE.Vector3(0, -1, 0);
  function floorAt(x, z, yFrom, fallback) {
    if (!rockMesh) return fallback;
    ray.set(new THREE.Vector3(x, yFrom, z), downV);
    ray.far = 30;
    const hit = ray.intersectObject(rockMesh, false)[0];
    return hit ? hit.point.y : fallback;
  }

  const poolSt = smap.get(water.poolStationId);
  const wf = water.waterfall;
  let fallPlan = null;
  if (wf && poolSt) {
    // The fall pours from high on a side wall of the pool chamber (like water
    // emerging from a bedding plane or aven) and arcs out into the pool.
    const dest = stationWorld(poolSt);
    const from = smap.get(wf.fromId);
    const src = from ? stationWorld(from) : { x: dest.x - 1, y: dest.y, z: dest.z };
    const dx = dest.x - src.x;
    const dz = dest.z - src.z;
    const hl = Math.hypot(dx, dz) || 1;
    const fx = dx / hl, fz = dz / hl;
    const side = poolSt.right >= poolSt.left ? 1 : -1;
    const sx = fz * side, sz = -fx * side; // lateral, toward the wider side
    const wide = Math.max(poolSt.left, poolSt.right);
    const lat = wide * 0.82;
    const arcOut = Math.min(1.6, Math.max(0.45, wide * 0.24));
    const lipX = dest.x + sx * lat, lipZ = dest.z + sz * lat;
    const inX = -sx, inZ = -sz; // into the room
    const hitX = lipX + inX * arcOut, hitZ = lipZ + inZ * arcOut;
    const centerFloor = floorAt(dest.x, dest.z, dest.y, dest.y - poolSt.down);
    const hitFloor = floorAt(hitX, hitZ, dest.y, centerFloor);
    const room = poolSt.up + poolSt.down;
    const drop = Math.min(room * 0.72, Math.max(wf.lipHeight || 3.4, 3.2) + 1.6);
    fallPlan = {
      lipX, lipZ, inX, inZ, arcOut, hitX, hitZ,
      poolY: hitFloor + 0.05,
      lipY: hitFloor + Math.max(1.6, drop),
      centerFloor,
    };
  }

  // Pool in the chamber, stretched to reach under the waterfall.
  if (poolSt) {
    const p = stationWorld(poolSt);
    const cavern = poolSt.kind === "cavern";
    let radius = Math.min(cavern ? 4.2 : 1.8, Math.max(cavern ? 1.8 : 0.8, (poolSt.left + poolSt.right) * (cavern ? 0.28 : 0.32)));
    let cx = p.x, cz = p.z;
    let py = floorAt(p.x, p.z, p.y, p.y - poolSt.down) + 0.08;
    if (fallPlan) {
      // Centre between station and impact point; water level a touch above both floors.
      cx = (p.x + fallPlan.hitX) * 0.5;
      cz = (p.z + fallPlan.hitZ) * 0.5;
      radius = Math.max(radius, Math.hypot(fallPlan.hitX - cx, fallPlan.hitZ - cz) + 0.9);
      const fc = floorAt(cx, cz, p.y, py);
      py = Math.max(fc, fallPlan.poolY - 0.05) + 0.1;
      fallPlan.poolY = Math.max(fallPlan.poolY, py + 0.01);
    }
    const pool = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(cx, py, cz);
    pool.name = "pool";
    pool.renderOrder = 2;
    group.add(pool);
    handle.features.pool = { x: cx, y: py, z: cz, radius };
  }

  if (fallPlan) {
    const { lipX, lipZ, inX: inwardX, inZ: inwardZ, arcOut, poolY, lipY } = fallPlan;
    const widthW = wf.width || 0.85;
    const drop = Math.max(0.8, lipY - poolY);
    const midY = (lipY + poolY) * 0.5;
    const across = { x: -inwardZ, z: inwardX };
    const lip = { x: lipX, y: lipY, z: lipZ };
    const dest = { x: lipX + inwardX * 6, z: lipZ + inwardZ * 6 };

    const fallUniforms = () => ({
      uTime: { value: 0 },
      uDrop: { value: drop },
      uWidth: { value: widthW },
      uFogColor: { value: new THREE.Color(0x050308) },
      uFogDensity: { value: 0.03 },
    });
    const sheetFrag = /* glsl */ `
      uniform float uTime; uniform float uDrop; uniform float uWidth;
      uniform vec3 uFogColor; uniform float uFogDensity; uniform float uLayer;
      varying vec2 vUv; varying float vFogDepth;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float x = vUv.x * uWidth * (uLayer > 0.5 ? 10.0 : 16.0);
        // Accelerating fall: scroll faster lower down.
        float y = vUv.y * uDrop * 0.9;
        float sp = (uLayer > 0.5 ? 3.2 : 4.4);
        float t = uTime * sp;
        float s1 = noise(vec2(x, y * 0.35 - t * 0.6));
        float s2 = noise(vec2(x * 2.3 + 7.0, y * 0.9 - t * 1.1));
        float s3 = noise(vec2(x * 5.0 + 3.0, y * 2.2 - t * 1.7));
        float strands = smoothstep(0.35, 0.85, s1 * 0.55 + s2 * 0.3 + s3 * 0.15);
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        // Sheet breaks up into spray towards the bottom.
        float breakup = mix(1.0, smoothstep(0.25, 0.75, s3), smoothstep(0.55, 1.0, vUv.y));
        float topFade = smoothstep(0.0, 0.05, vUv.y);
        float a = (uLayer > 0.5 ? 0.22 : 0.55) * (0.25 + strands) * edge * breakup * topFade;
        vec3 col = mix(vec3(0.42, 0.55, 0.58), vec3(0.92, 0.97, 1.0), strands);
        float lit = clamp(2.6 / (1.0 + 0.04 * vFogDepth * vFogDepth), 0.07, 1.2);
        col *= lit;
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0)), a);
      }`;

    function sheet(layer) {
      const cols = 10, rows = 18;
      const pos = [], uv = [], idx = [];
      const w = widthW * (layer ? 1.35 : 1);
      const off = layer ? 0.05 : 0;
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        const out = arcOut * Math.sqrt(v) + off + 0.04;
        for (let c = 0; c <= cols; c++) {
          const u = c / cols;
          const a = (u - 0.5) * w * (1 + v * 0.35);
          const bulge = Math.cos((u - 0.5) * Math.PI) * 0.06;
          pos.push(
            lip.x + across.x * a + inwardX * (out + bulge),
            lip.y - v * drop,
            lip.z + across.z * a + inwardZ * (out + bulge),
          );
          uv.push(u, v);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i0 = r * (cols + 1) + c;
          idx.push(i0, i0 + cols + 1, i0 + 1, i0 + 1, i0 + cols + 1, i0 + cols + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.ShaderMaterial({
        uniforms: { ...fallUniforms(), uLayer: { value: layer } },
        vertexShader: VERT,
        fragmentShader: sheetFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.name = layer ? "waterfall-spray" : "waterfall";
      mesh.renderOrder = 3 + layer;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    sheet(0);
    sheet(1);

    // Particles: falling droplets + rising mist. Positions are computed on the GPU from
    // a per-particle seed and time, so there is no per-frame CPU work.
    const ptVert = /* glsl */ `
      uniform float uTime; uniform float uDrop; uniform float uWidth; uniform float uMode;
      uniform vec3 uLip; uniform vec3 uIn; uniform vec3 uAcross; uniform float uArc; uniform float uPx;
      attribute vec3 aSeed;
      varying float vAlpha; varying float vFogDepth;
      void main() {
        vec3 p;
        float size;
        if (uMode < 0.5) {
          // Droplet falling from the lip, with gravity-like easing.
          float ph = fract(aSeed.y + uTime * (0.55 + aSeed.z * 0.5) / max(1.0, sqrt(uDrop)));
          float v = ph * ph;
          float a = (aSeed.x - 0.5) * uWidth * (1.1 + v * 0.6);
          float outw = uArc * sqrt(v) + 0.05 + (aSeed.z - 0.5) * 0.25 * v;
          p = uLip + uAcross * a + uIn * outw - vec3(0.0, v * uDrop, 0.0);
          size = 0.025 + aSeed.z * 0.03;
          vAlpha = 0.75 * smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.92, 1.0, ph));
        } else {
          // Mist: slow puffs drifting up and out from the impact point.
          float ph = fract(aSeed.y + uTime * (0.05 + aSeed.z * 0.05));
          vec3 base = uLip + uIn * (uArc + 0.15) - vec3(0.0, uDrop, 0.0);
          float ang = aSeed.x * 6.2831;
          float r = 0.15 + ph * (0.6 + aSeed.z * 0.9);
          p = base + uAcross * cos(ang) * r + uIn * (sin(ang) * r * 0.7 + 0.2) + vec3(0.0, ph * (0.4 + aSeed.z * 1.2), 0.0);
          size = 0.45 + ph * 1.1;
          vAlpha = 0.11 * sin(ph * 3.14159);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z;
        gl_PointSize = clamp(size * uPx / max(0.2, -mv.z), 1.0, 256.0);
        gl_Position = projectionMatrix * mv;
      }`;
    const ptFrag = /* glsl */ `
      uniform float uMode; uniform vec3 uFogColor; uniform float uFogDensity;
      varying float vAlpha; varying float vFogDepth;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float a = uMode < 0.5 ? smoothstep(1.0, 0.3, d) : smoothstep(1.0, 0.0, d) * smoothstep(1.0, 0.0, d);
        float lit = clamp(2.6 / (1.0 + 0.04 * vFogDepth * vFogDepth), 0.06, 1.2);
        vec3 col = vec3(0.85, 0.92, 0.95) * lit;
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0)), a * vAlpha);
      }`;
    function points(mode, count) {
      const seeds = new Float32Array(count * 3);
      for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
      const m = new THREE.ShaderMaterial({
        uniforms: {
          ...fallUniforms(),
          uMode: { value: mode },
          uLip: { value: new THREE.Vector3(lip.x, lip.y, lip.z) },
          uIn: { value: new THREE.Vector3(inwardX, 0, inwardZ) },
          uAcross: { value: new THREE.Vector3(across.x, 0, across.z) },
          uArc: { value: arcOut },
          uPx: { value: 600 },
        },
        vertexShader: ptVert,
        fragmentShader: ptFrag,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      mats.push(m);
      handle.pointMats.push(m);
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      pts.name = mode ? "waterfall-mist" : "waterfall-drops";
      group.add(pts);
    }
    handle.pointMats = [];
    points(0, 140);
    points(1, 46);

    // Splash: expanding ripple rings + foam where the water lands.
    const splashMat = new THREE.ShaderMaterial({
      uniforms: fallUniforms(),
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
        varying vec2 vUv; varying float vFogDepth;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float ang = atan(c.y, c.x);
          float rings = pow(0.5 + 0.5 * sin(r * 34.0 - uTime * 7.0 + noise(vec2(ang * 3.0, uTime)) * 2.0), 6.0);
          float foam = smoothstep(0.45, 0.8, noise(vec2(ang * 4.0, r * 9.0 - uTime * 2.5))) * smoothstep(0.65, 0.1, r);
          float a = (rings * 0.35 * smoothstep(1.0, 0.3, r) + foam * 0.7) ;
          float lit = clamp(2.6 / (1.0 + 0.04 * vFogDepth * vFogDepth), 0.06, 1.2);
          vec3 col = vec3(0.85, 0.92, 0.95) * lit;
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          gl_FragColor = vec4(mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0)), a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    mats.push(splashMat);
    const splash = new THREE.Mesh(new THREE.PlaneGeometry(widthW * 2.6, widthW * 2.6), splashMat);
    splash.rotation.x = -Math.PI / 2;
    splash.position.set(lipX + inwardX * (arcOut + 0.08), poolY + 0.03, lipZ + inwardZ * (arcOut + 0.08));
    splash.renderOrder = 3;
    group.add(splash);
    handle.features.waterfall = {
      x: lipX + inwardX * arcOut * 0.6, y: midY, z: lipZ + inwardZ * arcOut * 0.6, lipY, poolY, width: widthW,
      lookX: dest.x, lookY: midY, lookZ: dest.z,
    };
  }

  handle.update = (time, fogColor, fogDensity) => {
    const t = time * 0.001;
    for (const m of mats) {
      m.uniforms.uTime.value = t;
      if (fogColor) m.uniforms.uFogColor.value.copy(fogColor);
      if (fogDensity != null) m.uniforms.uFogDensity.value = fogDensity;
    }
    // Point sprite sizes follow the render height so droplets look the same on phone and desktop.
    const px = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2) * 0.9;
    for (const m of handle.pointMats || []) m.uniforms.uPx.value = px;
  };
  return handle;
}
