import * as THREE from "three";
import { generateCave, randomSeed, caveName, addWaterSystem } from "./generator.js";
import { parseJSONSurvey, parseCSVSurvey, longestPathIds, totalLength, depthRange, stationMap, stationWorld, neighborsOf } from "./cave-data.js";
import { buildCaveGroup, disposeGroup, rockMaterial, formationMaterial } from "./mesh.js";
import { WallCollider, ensureBVH } from "./wallcollide.js";
import { Player, isTouchDevice } from "./player.js";
import { Minimap } from "./minimap.js";
import { hashSeed } from "./rng.js";
import { addFormations } from "./formations.js";
import { addWater } from "./water.js";
import { CaveFauna } from "./cavefauna.js";
import { CaveAudio } from "./audio.js";
import { Caveman } from "./caveman.js";
import { Monster } from "./monster.js";
import { MonsterVoice } from "./monster-voice.js";
import { pointInside, PLAYER_RADIUS, STANCES, canFitStance, requiredStanceAt, queryVolume } from "./volume.js";
import { ChunkManager } from "./world/chunk-manager.js";
import { CaveStreamLayer } from "./world/cave-stream.js";
import { Terrain } from "./world/terrain.js";
import { OverworldLayer } from "./world/overworld.js";
import { Atmosphere, WEATHERS } from "./world/atmosphere.js";
import { Camp } from "./act1/camp.js";
import { Wildlife } from "./act1/animals.js";
import { Story } from "./act1/story.js";
import { StoryUI } from "./act1/ui.js";
import { readSave, clearSave } from "./act1/survival.js";

const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.message || e.error || e)));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

const canvas = document.getElementById("view");
const minimapCanvas = document.getElementById("minimap");
const depthEl = document.getElementById("depth");
const distEl = document.getElementById("dist");
const seedValueEl = document.getElementById("seed-value");
const seedInput = document.getElementById("seed-input");
const nameEl = document.getElementById("cave-name");
const hintEl = document.getElementById("hint");
const foundEl = document.getElementById("found");
const touchRoot = document.getElementById("touch");
const aboutEl = document.getElementById("about");
const muteBtn = document.getElementById("mute-btn");
const placeEl = document.getElementById("place");

const IS_TOUCH = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !IS_TOUCH,
  powerPreference: "high-performance",
});
// Phones: cap the pixel ratio (fill rate is the main cost of the rock shader), then adapt.
const DPR_CAP = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2);
let dprNow = DPR_CAP;
renderer.setPixelRatio(dprNow);
renderer.setClearColor(0x050308, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050308, 0.03);
scene.background = new THREE.Color(0x050308);

// `camera` is the player's eye (logic only: collision, look, audio). The scene is rendered
// through `viewCam`: an over-the-shoulder chase camera, or the eye itself in first person.
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 220);
const viewCam = new THREE.PerspectiveCamera(70, 1, 0.06, 160);
scene.add(camera);
scene.add(viewCam);
// No electric light, no headlamp: only the torch. A near-black floor so silhouettes barely read.
const ambient = new THREE.AmbientLight(0x0d0b10, 0.5);
scene.add(ambient);
const caveman = new Caveman(scene);
caveman.baseIntensity = 14;
// Dark lookup: nothing baked into the rock (no string lights / floods).
const DARK = { lights: [], at: () => 0, any: false };

// Moonlight + sky fill for the overworld. Always in the scene (intensity 0 underground) so
// switching worlds never changes the light count (which would recompile every shader).
const moonLight = new THREE.DirectionalLight(0x9fb4e0, 0);
moonLight.position.set(0.45, 0.5, -0.74).multiplyScalar(100);
scene.add(moonLight);
scene.add(moonLight.target);
const skyFill = new THREE.HemisphereLight(0x34446a, 0x0c0a08, 0);
scene.add(skyFill);

const URLP = new URLSearchParams(location.search);
const STREAM = URLP.get("stream") !== "0";
const chunks = new ChunkManager(scene, { budgetMs: 3.5 });
const world = {
  mode: "cave", terrain: null, over: null, caveLayer: null, entrance: null, exitArmed: false,
  discovered: new Set(), busy: false, enterCooldown: 0, transitions: [],
};

const material = rockMaterial();
const formMat = formationMaterial();
const minimap = new Minimap(minimapCanvas);
const audio = new CaveAudio();

let cave = null;
let caveGroup = null;
let waterHandle = null;
let caveFauna = null;
let formInfo = null;
let player = null;
let last = performance.now();
let ready = false;
let mainPath = [];
let depthSpan = 30;
let lightLookup = null;
let trailHandle = null;
let labeled = [];
let fogTarget = 0.085;
const FOG_DENSITY = 0.058;
let placeShown = "";
const lastPos = new THREE.Vector3();
let speedSmooth = 0;

function parseSeed(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return randomSeed();
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return hashSeed(s);
}

function unloadCaveContent() {
  if (caveGroup) {
    scene.remove(caveGroup);
    disposeGroup(caveGroup);
    caveGroup = null;
  }
  chunks.removeLayer("cave");
  world.caveLayer = null;
  waterHandle = null;
  if (caveFauna) { caveFauna.dispose(); caveFauna = null; }
  if (game.monster) { game.monster.dispose(); game.monster = null; }
}

function setCaveLighting() {
  moonLight.intensity = 0;
  skyFill.intensity = 0;
  ambient.intensity = 0.5;
  ambient.color.set(0x0d0b10);
  caveman.baseIntensity = 14;
  if (world.camp) world.camp.fireLight.intensity = 0;
  if (world.wildlife) world.wildlife.setVisible(false);
  storyUI.setClock("Underground");
  scene.fog.color.set(0x000000);
  scene.background.set(0x000000);
  renderer.setClearColor(0x000000, 1);
  viewCam.near = 0.06; viewCam.far = 160; viewCam.updateProjectionMatrix();
  audio.setOutdoor?.(false);
}

function leaveOverworld() {
  if (world.over) {
    chunks.removeLayer("terrain", { dispose: false });
    world.over.resident.visible = false;
  }
}

function loadCave(nextCave, { fromEntrance = null } = {}) {
  unloadCaveContent();
  leaveOverworld();
  world.mode = "cave";
  world.entrance = fromEntrance;
  world.exitArmed = false;
  setCaveLighting();
  cave = nextCave;
  const show = cave.style === "carlsbad";
  if (show && !cave.water) cave.water = { legs: [] };
  if (!cave.water) addWaterSystem(cave);
  // Show caves: creamy limestone, electric lighting baked in, long sight lines.
  material.color.set(show ? 0xf3e8d6 : 0xd2c4ae);
  formMat.color.set(show ? 0xf6ead6 : 0xcfc0a8);
  lightLookup = DARK;
  if (STREAM) {
    // Streaming: walls / formations are built per cell near the player (see world/cave-stream.js).
    const layer = new CaveStreamLayer(cave, { material, formMat, night: !!fromEntrance });
    world.caveLayer = layer;
    caveGroup = new THREE.Group();
    caveGroup.name = "cave-resident";
    caveGroup.add(layer.resident);
    const waterGroup = new THREE.Group();
    waterGroup.name = "water";
    waterHandle = addWater(waterGroup, cave);
    layer.attachWater(waterGroup);
    caveGroup.add(waterGroup);
    formInfo = { obstacles: layer.obstacles, counts: layer.form.counts };
    chunks.addLayer(layer);
  } else {
    caveGroup = buildCaveGroup(cave, material, lightLookup);
    formInfo = addFormations(caveGroup, cave, formMat, lightLookup);
    waterHandle = addWater(caveGroup, cave);
  }
  trailHandle = null;
  if (!show) caveFauna = new CaveFauna(scene, { lite: IS_TOUCH, seed: (cave.seed || 7) ^ 0xbad });
  // Torch-lit darkness everywhere: black, dense fog (useful light ~8-12 m).
  scene.fog.color.set(0x000000);
  scene.background.set(0x000000);
  renderer.setClearColor(0x000000, 1);
  camera.updateProjectionMatrix();
  labeled = cave.stations.filter((st) => st.label);
  scene.add(caveGroup);
  mainPath = longestPathIds(cave, cave.entranceId).path;
  const span = depthRange(cave);
  depthSpan = span.depth || 30;
  const length = totalLength(cave);
  fogTarget = FOG_DENSITY;
  scene.fog.density = fogTarget;

  if (!player) ensurePlayer(cave);
  else player.setCave(cave);
  player.setObstacles(formInfo.obstacles);
  if (STREAM) chunks.prime(streamCtx(), 25);
  syncStance(player.stance);

  seedValueEl.textContent = cave.seed ?? "—";
  seedInput.value = cave.seed ?? "";
  if (nameEl) nameEl.textContent = cave.name || caveName(cave.seed || 0);
  foundEl.classList.add("hidden");
  explored.clear();
  if (!story.active) game.health = game.maxHealth;
  game.dead = false;
  deathEl?.classList.add("hidden");
  renderStatus();
  spawnMonster();
  story.onCaveLoaded(cave.kind);
  ready = true;
  window.__CAVE__.ready = true;
  window.__CAVE__.seed = cave.seed;
  window.__CAVE__.mode = "cave";
  window.__CAVE__.info = {
    name: cave.name,
    stations: cave.stations.length,
    legs: cave.legs.length,
    length: Math.round(length * 10) / 10,
    depth: Math.round(span.depth * 10) / 10,
    formations: formInfo.counts,
    water: !!(cave.water && cave.water.legs && cave.water.legs.length),
    caverns: cave.stations.filter((s) => s.kind === "cavern").length,
    crouches: cave.stations.filter((s) => s.clearance === "crouch").length,
    crawls: cave.stations.filter((s) => s.clearance === "crawl").length,
  };
}

const wallMeshCache = { t: -1, list: [] };
function caveWallMeshes() {
  // Rendered passage rock currently loaded (streamed cells, or the whole-cave group); cached briefly.
  const now = performance.now();
  if (now - wallMeshCache.t < 200) return wallMeshCache.list;
  const list = [];
  const roots = [world.caveLayer?.root, caveGroup].filter(Boolean);
  for (const r of roots) r.traverse((o) => { if (o.isMesh && o.name === "passages") { ensureBVH(o.geometry); list.push(o); } });
  wallMeshCache.t = now; wallMeshCache.list = list;
  return list;
}
const walls = new WallCollider(caveWallMeshes);

function ensurePlayer(c) {
  player = new Player(camera, c, canvas);
  player.walls = walls;
  player.onStep = (amp, stance) => audio.step(amp, stance);
  player.onExit = () => {
    // Linked cave (entered from the hills): the far exit brings you back outside.
    if (world.entrance) { returnToOverworld(); return; }
    foundEl.classList.remove("hidden");
    hintEl.classList.add("hidden");
  };
  player.onStance = syncStance;
  const knob = document.getElementById("joy-knob");
  const joy = document.getElementById("joystick");
  if (joy && knob) player.attachJoystick(joy, knob);
}

let carlsbadData = null;
async function loadCarlsbad(opts = {}) {
  try {
    if (!carlsbadData) carlsbadData = await (await fetch("data/carlsbad.json")).json();
    loadCave(parseJSONSurvey(carlsbadData), opts);
    if (!opts.fromEntrance) history.replaceState(null, "", "?cave=carlsbad");
  } catch (err) {
    errors.push("carlsbad: " + err);
  }
}

// ---------------- Overworld ----------------
const fadeEl = document.getElementById("fade");
function streamCtx() {
  const fwd = new THREE.Vector3(-Math.sin(player?.yaw || 0), 0, -Math.cos(player?.yaw || 0));
  return { pos: camera.position, dir: fwd, manager: chunks };
}

/** Short fade to black around a world switch (loading happens while black). */
function transition(fn, instant = false) {
  if (instant || !fadeEl) { fn(); return Promise.resolve(); }
  world.busy = true;
  fadeEl.classList.add("on");
  return new Promise((res) => setTimeout(async () => {
    try { await fn(); } catch (err) { errors.push(String(err)); }
    world.busy = false;
    requestAnimationFrame(() => fadeEl.classList.remove("on"));
    res();
  }, 380));
}

function ensureWorld() {
  if (world.terrain) return;
  const seed = URLP.has("world") ? parseSeed(URLP.get("world")) : 20261111;
  world.terrain = new Terrain(seed);
  world.over = new OverworldLayer(world.terrain, { lite: IS_TOUCH });
  scene.add(world.over.resident);
  world.atmo = new Atmosphere({ lite: IS_TOUCH, seed });
  if (URLP.has("daymin")) world.atmo.dayMinutes = Math.max(0.5, +URLP.get("daymin") || 22);
  world.atmo.onThunder = (d, a) => audio.thunder?.(d, a);
  world.over.resident.add(world.atmo.group);
  if (world.terrain.act1) {
    world.camp = new Camp(world.terrain, { lite: IS_TOUCH });
    world.over.resident.add(world.camp.group);
    scene.add(world.camp.fireLight);
  }
  world.wildlife = new Wildlife(world.terrain, scene, { lite: IS_TOUCH });
}

/** Where Kra wakes in Act 1: beside the cold fire, facing Old Lume. */
function campSpawn() {
  const c = world.camp, C = c.site.camp, L = c.lume;
  // across the fire from Lume, a little to the side, so he is in view past Kra's shoulder
  const dx = C.x - L.x, dz = C.z - L.z, l = Math.hypot(dx, dz) || 1;
  const x = C.x + (dx / l) * 3.2 + (-dz / l) * 1.6, z = C.z + (dz / l) * 3.2 + (dx / l) * 1.6;
  return { x, z, yaw: Math.atan2(-(L.x - x), -(L.z - z)) - 0.18 };
}

function enterOverworld(entrance = null, opts = {}) {
  unloadCaveContent();
  world.mode = "overworld";
  world.entrance = null;
  cave = null;
  ensureWorld();
  const t = world.terrain;
  world.over.resident.visible = true;
  world.wildlife?.setVisible(true);
  chunks.addLayer(world.over);
  viewCam.near = 0.1; viewCam.far = 1000; viewCam.updateProjectionMatrix();
  audio.setOutdoor?.(true);
  let x = t.spawn.x, z = t.spawn.z, yaw = t.spawn.yaw;
  if (opts.at) ({ x, z, yaw } = opts.at);
  else if (!entrance && story.active && world.camp) ({ x, z, yaw } = campSpawn());
  if (entrance) {
    // Step out of the mouth, facing downhill (away from the hole).
    x = entrance.x + entrance.fx * 3.2 * entrance.scale;
    z = entrance.z + entrance.fz * 3.2 * entrance.scale;
    yaw = Math.atan2(-entrance.fx, -entrance.fz);
    world.enterCooldown = 2;
  }
  if (!player) ensurePlayer(null);
  player.setTerrain(t, x, z, yaw);
  explored.clear();
  if (!story.active) game.health = game.maxHealth;
  game.dead = false;
  deathEl?.classList.add("hidden");
  renderStatus();
  // light / fog for the current time of day right away (no flash of wrong lighting)
  world.atmo.update(0, { eye: camera.position, elevation: t.height(x, z), lights: { sun: moonLight, hemi: skyFill, ambient }, fog: scene.fog, renderer });
  chunks.prime(streamCtx(), 12);
  if (nameEl) nameEl.textContent = "The Hills";
  seedValueEl.textContent = "world " + t.seed;
  foundEl.classList.add("hidden");
  placeShown = "";
  ready = true;
  window.__CAVE__.ready = true;
  window.__CAVE__.mode = "overworld";
  window.__CAVE__.info = { name: "Overworld", entrances: t.entrances.map((e) => ({ id: e.id, name: e.name, cave: e.cave, x: +e.x.toFixed(1), z: +e.z.toFixed(1) })) };
  if (!entrance && location.search) history.replaceState(null, "", location.pathname);
}

function enterEntrance(e, instant = false) {
  world.transitions.push({ t: +game.time.toFixed(1), e: "enter", id: e.id, cave: e.cave });
  return transition(async () => {
    if (e.cave === "carlsbad") await loadCarlsbad({ fromEntrance: e });
    else if (e.cave === "hollow") loadCave(hollowCave(), { fromEntrance: e });
    else loadCave(generateCave(e.cave), { fromEntrance: e });
    if (nameEl) nameEl.textContent = e.name;
  }, instant);
}

function returnToOverworld(instant = false) {
  const e = world.entrance, kind = cave?.kind;
  world.transitions.push({ t: +game.time.toFixed(1), e: "exit", id: e ? e.id : null });
  return transition(() => { enterOverworld(e); story.onExitCave(kind); }, instant);
}

const HOLLOW_SEED = 70261111;
function hollowCave() {
  // Waterfall Hollow: a short, dark first cave (few legs, no squeezes) with a stream.
  const c = generateCave(HOLLOW_SEED, { targetLegs: 26, squeezeProbability: 0.0, chamberProbability: 0.22 });
  c.kind = "hollow"; c.name = "Waterfall Hollow";
  return c;
}

function stepWorld(dt) {
  world.enterCooldown = Math.max(0, world.enterCooldown - dt);
  if (world.busy || !player) return;
  if (world.mode === "overworld") {
    const p = camera.position;
    for (const e of world.terrain.entrances) if (Math.hypot(e.x - p.x, e.z - p.z) < 70) world.discovered.add(e.id);
    const e = world.enterCooldown <= 0 && !game.dead ? world.terrain.entranceAt(p.x, p.z) : null;
    if (e) enterEntrance(e);
  } else if (world.entrance && cave) {
    // Walk back out through the cave mouth -> outside at the same entrance.
    const s = stationMap(cave).get(cave.entranceId);
    if (s) {
      const w = stationWorld(s);
      const d = Math.hypot(camera.position.x - w.x, camera.position.z - w.z);
      if (d > 8) world.exitArmed = true;
      if (world.exitArmed && d < 2.5 && !game.dead) returnToOverworld();
    }
  }
}

function newCave(seed) {
  if (String(seed ?? "").trim().toLowerCase() === "carlsbad") { loadCarlsbad(); return "carlsbad"; }
  const s = seed == null ? randomSeed() : parseSeed(seed);
  loadCave(generateCave(s));
  return s;
}

function resize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewCam.aspect = w / h;
  viewCam.updateProjectionMatrix();
  const mapSize = Math.round(Math.min(200, Math.max(140, Math.min(w, h) * 0.28)) * (window.devicePixelRatio > 1.5 ? 2 : 1));
  if (minimapCanvas.width !== mapSize) {
    minimapCanvas.width = mapSize;
    minimapCanvas.height = mapSize;
  }
}
window.addEventListener("resize", resize);
resize();

if (isTouchDevice()) {
  touchRoot.classList.remove("hidden");
  hintEl.textContent = "Drag right to look · pad to move (edge = run) · Stab to fight";
} else {
  hintEl.textContent = "Click to look · WASD walk · Shift run · F stab · E use · I pack · Tab craft · K skills · T/Y time/weather";
}

const musicBtn = document.getElementById("music-btn");
function syncMute() {
  if (muteBtn) muteBtn.textContent = audio.muted ? "Sound off" : "Sound on";
  if (musicBtn) {
    musicBtn.textContent = audio.musicOn ? "Music on" : "Music off";
    musicBtn.classList.toggle("off", !audio.musicOn);
  }
}
syncMute();
function toggleMusic() {
  audio.toggleMusic();
  audio.resume();
  syncMute();
}
if (musicBtn) {
  musicBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMusic();
  });
  musicBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) toggleMusic();
});

const btnCrouch = document.getElementById("btn-crouch");
const btnCrawl = document.getElementById("btn-crawl");
const lowHint = document.getElementById("low-hint");

function syncStance(name) {
  const st = name || player?.stance || "stand";
  if (btnCrouch) btnCrouch.classList.toggle("active", st === "crouch");
  if (btnCrawl) btnCrawl.classList.toggle("active", st === "crawl");
}

function updateLowHint(info) {
  if (!lowHint || !player) return;
  const need = info.ahead || "stand";
  const st = player.stance;
  const ranks = { stand: 0, crouch: 1, crawl: 2 };
  if (ranks[need] > ranks[st]) {
    const phone = isTouchDevice();
    if (need === "crawl") {
      lowHint.textContent = phone ? "Tight squeeze — Crawl" : "Tight squeeze — Crawl (Z)";
    } else {
      lowHint.textContent = phone ? "Low passage — Crouch" : "Low passage — Crouch (C)";
    }
    lowHint.classList.remove("hidden");
  } else {
    lowHint.classList.add("hidden");
  }
}

if (btnCrouch) {
  btnCrouch.addEventListener("click", (e) => {
    e.stopPropagation();
    player?.setStance("crouch", { toggle: true });
    syncStance(player?.stance);
  });
}
if (btnCrawl) {
  btnCrawl.addEventListener("click", (e) => {
    e.stopPropagation();
    player?.setStance("crawl", { toggle: true });
    syncStance(player?.stance);
  });
}

document.getElementById("new-cave").addEventListener("click", () => newCave());
document.getElementById("carlsbad-btn")?.addEventListener("click", (e) => { e.stopPropagation(); loadCarlsbad(); });
document.getElementById("go-seed").addEventListener("click", () => newCave(seedInput.value));
seedInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") newCave(seedInput.value);
});
document.getElementById("again").addEventListener("click", () => newCave());
document.getElementById("about-btn").addEventListener("click", () => {
  aboutEl.classList.toggle("hidden");
});
document.getElementById("about-close").addEventListener("click", () => {
  aboutEl.classList.add("hidden");
});
if (muteBtn) {
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    audio.toggle();
    audio.resume();
    syncMute();
  });
}

const fileInput = document.getElementById("survey-file");
if (fileInput) {
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lower = file.name.toLowerCase();
      const data = lower.endsWith(".csv") ? parseCSVSurvey(text) : parseJSONSurvey(text);
      data.seed = data.seed ?? null;
      loadCave(data);
    } catch (err) {
      errors.push(String(err));
      alert("Could not read that survey: " + err.message);
    }
    e.target.value = "";
  });
}

function armAudio() {
  audio.resume();
}
canvas.addEventListener("click", () => {
  hintEl.classList.add("dim");
  armAudio();
});
document.addEventListener("pointerdown", armAudio, { once: false });
document.addEventListener("keydown", armAudio, { once: true });
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) hintEl.classList.add("hidden");
  else if (!player?.foundExit) hintEl.classList.remove("hidden");
});

function fmt(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

// Adaptive resolution: if frames are slow for ~2 s, drop the pixel ratio; recover when fast.
let perfAcc = 0, perfN = 0;
function adaptResolution(frameMs) {
  perfAcc += frameMs; perfN++;
  if (perfAcc < 2000) return;
  const avg = perfAcc / perfN;
  perfAcc = 0; perfN = 0;
  let next = dprNow;
  if (avg > 24 && dprNow > 0.7) next = Math.max(0.7, dprNow - 0.2);
  else if (avg < 14 && dprNow < DPR_CAP) next = Math.min(DPR_CAP, dprNow + 0.1);
  if (Math.abs(next - dprNow) > 0.01) { dprNow = next; renderer.setPixelRatio(dprNow); resize(); }
}

// ---------------- Survival: monster, combat, health, chase camera ----------------
const hpEl = document.getElementById("hp");
const killsEl = document.getElementById("kills");
const deathsEl = document.getElementById("deaths");
const vignetteEl = document.getElementById("vignette");
const killFlashEl = document.getElementById("kill-flash");
const deathEl = document.getElementById("death-screen");
const attackBtn = document.getElementById("attack-btn");
const viewBtn = document.getElementById("btn-view");
const menuBtn = document.getElementById("menu-btn");
const gameEl = document.getElementById("game");
const monsterVoice = new MonsterVoice(audio);
function loadNum(k) { try { return Math.max(0, parseInt(localStorage.getItem(k) || "0", 10) || 0); } catch { return 0; } }
const tally = { kills: loadNum("cavern.kills"), deaths: loadNum("cavern.deaths") };
function saveTally() {
  try { localStorage.setItem("cavern.kills", String(tally.kills)); localStorage.setItem("cavern.deaths", String(tally.deaths)); } catch {}
  renderStatus();
}
const game = {
  health: 3, maxHealth: 3, invuln: 0, dead: false, deadT: 0, attackCd: 0, attackPending: -1,
  noiseBurst: 0, lastDamage: 0, time: 0, monster: null, respawnAt: -1, shake: 0, vignette: 0,
  fp: false, noiseOverride: null, god: false, lastAttack: null, hitsTaken: 0, log: [],
};
const explored = new Set();

// ---------------- Act 1 story (Flesh of the Ancients) ----------------
const storyUI = new StoryUI(gameEl, { touch: IS_TOUCH });
const story = new Story({
  ui: storyUI, audio,
  time: () => game.time,
  player: () => player,
  feet: () => (player ? feetPos() : null),
  eye: () => camera.position,
  mode: () => world.mode,
  camp: () => world.camp,
  terrain: () => world.terrain,
  wildlife: () => world.wildlife,
  atmo: () => world.atmo,
  monster: () => game.monster,
  caveKind: () => cave?.kind || null,
  caveWater: () => (world.mode !== "overworld" ? waterHandle : null),
  volume: () => (player && !player.terrain ? player.volume : null),
  paused: () => storyUI.modal || game.dead,
  hurt: () => damagePlayer(),
  health: () => game.health,
  setArmed: (v) => { game.armed = !!v; caveman.spear.visible = !!v; },
  applyStats: () => applyStats(),
  addCaveObject: (o) => { if (caveGroup) caveGroup.add(o); else scene.add(o); },
  caveSpot: (frac) => {
    if (!cave || !mainPath.length) return null;
    const sm = stationMap(cave), id = mainPath[Math.min(mainPath.length - 1, Math.floor(mainPath.length * frac))];
    const s0 = sm.get(id), nid = mainPath[Math.min(mainPath.length - 1, mainPath.indexOf(id) + 1)];
    const w = stationWorld(s0), n = stationWorld(sm.get(nid) || s0);
    const side = Math.max(0, Math.min(s0.left, 1.2) - 0.5);
    const dx = n.x - w.x, dz = n.z - w.z, l = Math.hypot(dx, dz) || 1;
    return { x: w.x + (-dz / l) * side, y: w.y - s0.down + 0.02, z: w.z + (dx / l) * side, yaw: Math.atan2(dx, dz) };
  },
  savePos: () => {
    // saves always resume outdoors (at the camp fire, or just outside the cave you left)
    if (world.mode === "overworld" && player) return { x: camera.position.x, z: camera.position.z, yaw: player.yaw };
    const e = world.entrance;
    if (e) return { x: e.x + e.fx * 3.2 * e.scale, z: e.z + e.fz * 3.2 * e.scale, yaw: Math.atan2(-e.fx, -e.fz) };
    return world.camp ? campSpawn() : null;
  },
});
game.armed = true;
function applyStats() {
  const s = story.surv;
  const prev = game.maxHealth;
  game.maxHealth = 3 + (story.active ? s.faces + s.hpBonus : 0);
  if (game.maxHealth > prev) game.health += game.maxHealth - prev;
  game.health = Math.min(game.health, game.maxHealth);
  renderStatus();
}
/** Put the world back the way a save describes it (outdoors). */
function restoreFromSave(snap) {
  ensureWorld();
  const c = world.camp;
  if (c) {
    if (snap.camp?.fireLit && !c.fireLit) c.lightFire();
    if (snap.flags?.lumeDead) story.lumeDies();
    if (snap.camp?.tor && !c.tor.skinned) { c.tor.skinned = true; }
  }
  if (snap.hours != null) world.atmo.setTime(snap.hours);
  if (snap.weather) world.atmo.setWeather(snap.weather, true);
  game.armed = !!story.surv.tools.spear; caveman.spear.visible = game.armed;
  applyStats();
  game.health = game.maxHealth; renderStatus();
  enterOverworld(null, { at: snap.pos || undefined });
  storyUI.setStoryVisible(true);
}
function startNewGame() {
  clearSave();
  story.newGame();
  ensureWorld();
  world.atmo.setTime(6.0); world.atmo.setWeather("clear", true); world.atmo.nextChange = 2.5;
  game.armed = false; caveman.spear.visible = false;
  applyStats(); game.health = game.maxHealth; renderStatus();
  enterOverworld();
  storyUI.setStoryVisible(true);
  storyUI.titleCard("Flesh of the Ancients", "Act I &mdash; The Empty Camp", 4200);
  setTimeout(() => storyUI.toast("Dawn. The fire is cold. Nobody is singing."), 4800);
  story.save("auto");
}
function continueGame() {
  const snap = readSave(); if (!snap) return startNewGame();
  story.load(snap);
  restoreFromSave(snap);
  storyUI.toast("Welcome back, Kra.");
}
function startFreePlay() {
  story.active = false;
  storyUI.setStoryVisible(false);
  game.armed = true; caveman.spear.visible = true;
  applyStats(); game.health = game.maxHealth; renderStatus();
  ensureWorld();
  world.atmo.setTime(19.4);
  enterOverworld();
}
function showMainMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  storyUI.showMenu({ canContinue: !!readSave(), onContinue: () => transition(continueGame), onNew: () => transition(startNewGame), onFree: () => transition(startFreePlay) });
}

function renderStatus() {
  if (hpEl) hpEl.innerHTML = Array.from({ length: game.maxHealth }, (_, i) => `<span class="${i < game.health ? "" : "lost"}">&#9829;</span>`).join("");
  if (killsEl) killsEl.textContent = `Kills ${tally.kills}`;
  if (deathsEl) deathsEl.textContent = `Deaths ${tally.deaths}`;
}
renderStatus();
function glog(e) { game.log.push({ t: +game.time.toFixed(2), ...e }); if (game.log.length > 80) game.log.shift(); }

function feetPos(out = new THREE.Vector3()) {
  const st = player.stanceDef();
  return out.set(camera.position.x, camera.position.y - st.eye - (player.bobY || 0), camera.position.z);
}

function spawnMonster() {
  if (game.monster) { game.monster.dispose(); game.monster = null; }
  if (!player || !cave) return;
  const hollow = cave.kind === "hollow";
  if (hollow && story.active && story.flags.ratKilled) return; // the hollow's only creature is dead
  const m = new Monster(scene, cave, player.volume, Math.random, { kind: hollow ? "rat" : "crawler" });
  m.voice = monsterVoice;
  m.onHitPlayer = () => damagePlayer();
  m.onKilled = () => onMonsterKilled();
  m.spawnFar(feetPos(), hollow ? 22 : 40);
  game.monster = m;
  game.respawnAt = -1;
  glog({ e: "monsterSpawn", at: m.spawnNode });
}

function damagePlayer() {
  if (game.dead || game.invuln > 0 || game.god || storyUI.modal) return;
  game.health -= 1;
  game.hitsTaken += 1;
  game.invuln = 1.0;
  game.vignette = 1;
  game.shake = 0.35;
  game.lastDamage = game.time;
  glog({ e: "playerHit", health: game.health });
  audio.step(1, "stand");
  renderStatus();
  if (game.health <= 0) die();
}

function die() {
  game.dead = true;
  game.deadT = 0;
  tally.deaths += 1;
  saveTally();
  deathEl?.classList.remove("hidden");
  glog({ e: "death" });
  audio.music?.duckFor?.(2.5, 0.15);
}

function respawn() {
  // Story: death returns to the last save (faces / skills / Blood Memory are kept).
  if (story.active && readSave()) {
    game.dead = false; game.deadT = 0;
    deathEl?.classList.add("hidden");
    const snap = story.load(readSave(), { keep: true });
    applyStats(); game.health = game.maxHealth; renderStatus();
    transition(() => restoreFromSave(snap));
    glog({ e: "respawnFromSave" });
    return;
  }
  if (world.mode === "overworld") {
    game.dead = false; game.health = game.maxHealth; game.invuln = 2;
    deathEl?.classList.add("hidden"); renderStatus();
    transition(() => enterOverworld());
    return;
  }
  game.dead = false;
  game.health = game.maxHealth;
  game.invuln = 2;
  game.vignette = 0;
  player.setStance("stand");
  player.spawnAtEntrance();
  deathEl?.classList.add("hidden");
  // The creature loses you and drifts back into the deep.
  if (game.monster && game.monster.alive) game.monster.spawnFar(feetPos());
  renderStatus();
  glog({ e: "respawn" });
}

function attack() {
  if (!player || !ready || game.dead || game.attackCd > 0 || storyUI.modal) return false;
  if (story.active && !game.armed) { storyUI.toast("You have nothing to fight with yet."); return false; }
  game.attackCd = 0.6;
  game.attackPending = 0.14;
  game.noiseBurst = 0.45;
  caveman.thrust();
  attackBtn?.classList.add("hit");
  setTimeout(() => attackBtn?.classList.remove("hit"), 150);
  return true;
}

function resolveAttack() {
  const m = game.monster;
  const res = { hit: false };
  {
    const f = feetPos();
    let hitA = null;
    if (story.active) { if (story.onAttack(f, -Math.sin(player.yaw), -Math.cos(player.yaw))) hitA = story.lastHit; }
    else if (world.wildlife && world.mode === "overworld") {
      hitA = world.wildlife.tryHit(f, -Math.sin(player.yaw), -Math.cos(player.yaw), 1);
      if (hitA) storyUI.toast(hitA.alive ? `The ${hitA.kind} is wounded and bolts!` : `You killed a ${hitA.kind}`, hitA.alive ? undefined : "good");
    }
    if (!hitA && caveFauna && world.mode !== "overworld") {
      hitA = caveFauna.tryHit(f, -Math.sin(player.yaw), -Math.cos(player.yaw));
      if (hitA) { if (story.active && hitA.food) story.surv.add("meat", 1); storyUI.toast(`You killed a ${hitA.kind}`, "good"); }
    }
    if (hitA) {
      if (!hitA.alive) { tally.kills += 1; saveTally(); renderStatus(); }
      res.hit = true; res.animal = true; res.kind = hitA.kind; game.lastAttack = res; glog({ e: "attack", ...res }); return res;
    }
  }
  if (m && m.alive) {
    const f = feetPos();
    const dx = m.pos.x - f.x, dz = m.pos.z - f.z;
    const d = Math.hypot(dx, dz);
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const dot = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
    res.d = +d.toFixed(2); res.dot = +dot.toFixed(2);
    if (d < 2.7 && dot > Math.cos((50 * Math.PI) / 180) && Math.abs(m.pos.y - f.y) < 1.7) {
      res.hit = true;
      m.hit(f, 1 + (story.active ? story.surv.str : 0));
    }
  }
  game.lastAttack = res;
  glog({ e: "attack", ...res });
  return res;
}

function onMonsterKilled() {
  story.onMonsterKilled(game.monster);
  tally.kills += 1;
  saveTally();
  glog({ e: "kill", kills: tally.kills });
  if (killFlashEl) {
    killFlashEl.classList.remove("hidden");
    killFlashEl.style.animation = "none";
    void killFlashEl.offsetHeight;
    killFlashEl.style.animation = "";
    clearTimeout(onMonsterKilled._t);
    onMonsterKilled._t = setTimeout(() => killFlashEl.classList.add("hidden"), 1700);
  }
  game.respawnAt = cave && cave.kind === "hollow" ? -1 : game.time + 10;
}

function playerNoise() {
  if (game.noiseOverride != null) return game.noiseOverride;
  const sp = player.speedNow || 0;
  let n = 0;
  if (sp > 0.15) {
    if (player.stance === "crawl") n = 0.1;
    else if (player.stance === "crouch") n = 0.16;
    else n = 0.36 + 0.64 * (player.runFrac || 0);
  }
  return Math.max(n, game.noiseBurst);
}

/** All game rules for one step (used by the frame loop and by the fast test simulator). */
function stepGame(dt) {
  if (storyUI.modal) return;
  game.time += dt;
  game.invuln = Math.max(0, game.invuln - dt);
  game.attackCd = Math.max(0, game.attackCd - dt);
  game.noiseBurst = Math.max(0, game.noiseBurst - dt);
  game.vignette = Math.max(0, game.vignette - dt * 0.9);
  game.shake = Math.max(0, game.shake - dt * 1.2);
  if (game.attackPending >= 0) {
    game.attackPending -= dt;
    if (game.attackPending < 0) { game.attackPending = -1; resolveAttack(); }
  }
  if (game.dead) {
    game.deadT += dt;
    if (game.deadT > 3.2) respawn();
  } else if (game.health < game.maxHealth && game.time - game.lastDamage > 25) {
    game.health += 1;
    game.lastDamage = game.time;
    renderStatus();
  }
  const m = game.monster;
  if (m) {
    const f = feetPos();
    if (m.frozen) { m.distToPlayer = Math.hypot(m.pos.x - f.x, m.pos.z - f.z); m._animate(dt, 0); }
    else m.update(dt, { feet: f, eye: camera.position, noise: game.dead ? 0 : playerNoise(), torch: true, dead: game.dead });
    if (!m.alive && game.respawnAt > 0 && game.time >= game.respawnAt) spawnMonster();
  }
}

function threatLevel() {
  const m = game.monster;
  if (!m || !m.alive || game.dead) return 0;
  const d = m.distToPlayer ?? 99;
  if (m.state === "chase" || m.state === "lunge") return 1;
  if (m.state === "investigate") return d < 45 ? 0.62 : 0.45;
  if (m.state === "stagger" || m.state === "flee") return 0.7;
  return Math.max(0, 0.42 - d / 90);
}

// Chase camera: over the right shoulder, pulled in against walls / ceilings; close in crawls.
const _right = new THREE.Vector3(), _back = new THREE.Vector3(), _tmp = new THREE.Vector3();
let camDist = 2.4;
/** Fit a camera spot inside the passage: adjust its height under low ceilings; null if no room. */
function camSpotFit(p) {
  if (player.terrain) {
    p.y = Math.max(p.y, player.terrain.height(p.x, p.z) + 0.35);
    return p;
  }
  const q = queryVolume(player.volume, p.x, p.y, p.z, 0.18, 0.08);
  if (!q.inside) return null;
  const lo = q.floor + 0.25, hi = q.ceil - 0.2;
  if (hi < lo) return null;
  p.y = Math.min(hi, Math.max(lo, p.y));
  return p;
}
const _camOut = new THREE.Vector3();
function updateView(dt) {
  const eye = camera.position;
  camera.updateMatrixWorld();
  let fp = game.fp;
  if (!fp) {
    const st = player.stance;
    const want = st === "crawl" ? 1.4 : st === "crouch" ? 2.0 : 2.7;
    const sx = st === "crawl" ? 0.22 : 0.5, sy = st === "crawl" ? 0.3 : 0.32;
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _back.setFromMatrixColumn(camera.matrixWorld, 2);
    let allowed = want;
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      _tmp.copy(eye).addScaledVector(_right, sx * t).addScaledVector(_back, want * t);
      _tmp.y += sy * t;
      if (!camSpotFit(_tmp)) { allowed = Math.max(0.2, want * (i - 1) / 12 - 0.12); break; }
    }
    camDist += (allowed - camDist) * Math.min(1, dt * (allowed < camDist ? 20 : 2.5));
    const k = Math.min(1, camDist / want);
    _camOut.copy(eye).addScaledVector(_right, sx * k).addScaledVector(_back, camDist);
    _camOut.y += sy * k;
    camSpotFit(_camOut);
    // No room behind (very tight squeeze): fall back to first person for this moment.
    if (camDist < 0.75) fp = true;
    else {
      viewCam.position.copy(_camOut);
      // Look at a point ahead of the eye so the framing holds when the camera dips under a low roof.
      _tmp.copy(eye).addScaledVector(_back, -6);
      viewCam.up.set(0, 1, 0);
      viewCam.lookAt(_tmp);
    }
  }
  caveman.setFirstPerson(fp);
  if (fp) {
    viewCam.position.copy(eye);
    viewCam.quaternion.copy(camera.quaternion);
  }
  game.viewFP = fp;
  if (game.shake > 0) {
    const a = game.shake * 0.12;
    viewCam.position.x += (Math.random() - 0.5) * a;
    viewCam.position.y += (Math.random() - 0.5) * a;
    viewCam.rotateZ((Math.random() - 0.5) * a * 0.5);
  }
}
function setView(fp) {
  game.fp = !!fp;
  if (viewBtn) viewBtn.firstChild.textContent = game.fp ? "3rd person " : "1st person ";
}
function toggleView() { setView(!game.fp); }

attackBtn?.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); armAudio(); attack(); });
viewBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleView(); });
menuBtn?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.toggle("menu-open"); });
document.getElementById("reset-tally")?.addEventListener("click", (e) => {
  e.stopPropagation();
  tally.kills = 0; tally.deaths = 0; saveTally();
});
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0 && document.pointerLockElement === canvas) attack();
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (e.code === "KeyF") attack();
  if (e.code === "KeyV") toggleView();
  // Act 1: interact / inventory / skills / crafting; debug time + weather
  if (e.code === "KeyE" || (e.code === "Space" && !storyUI.dialog.classList.contains("hidden"))) { e.preventDefault(); story.interact(); }
  if (story.active && e.code === "KeyI") { storyUI.togglePanel("inv", story.surv); }
  if (story.active && e.code === "KeyK") { storyUI.togglePanel("skills", story.surv); }
  if (story.active && e.code === "Tab") { e.preventDefault(); storyUI.togglePanel("craft", story.surv); }
  if (e.code === "Escape") { storyUI.closePanel(); storyUI.closeChoice(); }
  if (e.code === "KeyT" && world.atmo) { world.atmo.skip(e.shiftKey ? -1 : 1); storyUI.toast(`Time: ${world.atmo.label().clock}`); }
  if (e.code === "KeyY" && world.atmo) { storyUI.toast(`Weather: ${world.atmo.cycleWeather()}`); }
});
storyUI.actBtn.addEventListener("click", () => { armAudio(); story.interact(); });
storyUI.invBtn.addEventListener("click", () => storyUI.togglePanel("inv", story.surv));
document.getElementById("menu-main-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); showMainMenu(); });
document.getElementById("pack-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); if (story.active) storyUI.openPanel("inv", story.surv); });

let animSpeed = 0;
function revealAround(p) {
  for (const s of cave.stations) {
    if (explored.has(s.id)) continue;
    const w = stationWorld(s);
    const r = Math.max(7, Math.max(s.left, s.right) + 4);
    if (Math.hypot(p.x - w.x, p.z - w.z) < r && Math.abs(p.y - w.y) < Math.max(8, s.up + 4)) explored.add(s.id);
  }
}

function tick(now) {
  const rawMs = now - last;
  // Frame-rate independent: up to 0.1 s per frame, simulated in <= 1/40 s substeps.
  const dt = Math.min(0.1, rawMs / 1000);
  last = now;
  if (rawMs > 0 && rawMs < 500 && !navigator.webdriver) adaptResolution(rawMs);
  if (storyUI.modal && document.pointerLockElement) document.exitPointerLock();
  if (player && ready) {
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    let info;
    const before = camera.position.clone();
    if (!game.dead && !storyUI.modal) for (let k = 0; k < steps; k++) info = player.update(dt / steps);
    else info = player.readout();
    stepGame(dt);
    stepWorld(dt);
    story.update(dt);
    if (STREAM || world.mode === "overworld") chunks.update(streamCtx());
    if (world.mode === "overworld") tickOverworld(dt, info, now);
    else if (cave) {
    depthEl.textContent = `Depth ${fmt(Math.max(0, info.depth))} m`;
    distEl.textContent = `Travelled ${fmt(info.travelled)} m`;
    revealAround(camera.position);
    minimap.draw(cave, camera.position, player.yaw, placeShown, explored);
    updateLowHint(info);
    if (waterHandle && waterHandle.update) waterHandle.update(now, scene.fog.color, scene.fog.density);
    if (waterHandle && waterHandle.snap && (game.snapT = (game.snapT || 0) - dt) <= 0) { game.snapT = 0.25; waterHandle.snap(caveWallMeshes(), camera.position); }
    if (caveFauna) caveFauna.update(dt, { pos: feetPos(), cam: camera.position, noise: playerNoise(), volume: player.volume, meshes: caveWallMeshes(), water: waterHandle });
    if (audio.started) {
      audio.setListener(camera.position, waterHandle && waterHandle.features);
      audio.setEars?.(camera.position, player.yaw);
    }
    const moved = Math.hypot(camera.position.x - lastPos.x, camera.position.z - lastPos.z) / Math.max(dt, 1e-3);
    lastPos.copy(camera.position);
    speedSmooth += (Math.min(moved, 5) - speedSmooth) * Math.min(1, dt * 3);
    animSpeed += (Math.min(moved, 6) - animSpeed) * Math.min(1, dt * 10);
    void before;
    const q = info.nearest;
    const roomH = q && q.ceil != null && q.floor != null ? q.ceil - q.floor : 2.5;
    // Nearest station: named place on the HUD, music zone.
    const cp = camera.position;
    let near = null, nearD = Infinity, lab = null, labD = Infinity;
    for (const st of cave.stations) {
      const w = stationWorld(st);
      const d = Math.hypot(cp.x - w.x, (cp.y - w.y) * 0.5, cp.z - w.z);
      if (d < nearD) { nearD = d; near = st; }
      if (st.label && d < Math.max(22, Math.max(st.left, st.right) + 12) && d < labD) { labD = d; lab = st; }
    }
    const place = lab ? lab.label : "";
    if (place !== placeShown) {
      placeShown = place;
      placeEl.textContent = place;
      placeEl.classList.toggle("show", !!place);
    }
    const roomW = q && q.best && q.best.s ? (q.best.s.left || 1) + (q.best.s.right || 1) : 2;
    const size = Math.max(roomH, roomW * 0.6);
    // Dense black fog: the torch reaches ~8-12 m; slightly thinner in huge rooms.
    // Halls: thinner haze and a longer torch throw so their scale reads (still torch-lit only).
    const hall = size > 18 ? 1 : size > 10 ? 0.45 : 0;
    const fogWant = FOG_DENSITY * (1 - 0.5 * hall);
    caveman.light.distance += (24.5 + 14 * hall - caveman.light.distance) * Math.min(1, dt * 1.5);
    if (!game.fogLock) {
      // A faint cold fill in halls (drip-wet rock catching the torch far off) so the room's size reads.
      game.hallFill = (game.hallFill || 0) + (hall - (game.hallFill || 0)) * Math.min(1, dt * 0.7);
      const hf = game.hallFill;
      ambient.color.setRGB(0.051 + 0.06 * hf, 0.043 + 0.055 * hf, 0.063 + 0.07 * hf);
      ambient.intensity = 0.5 + 1.1 * hf;
    }
    if (!game.fogLock) scene.fog.density += (fogWant - scene.fog.density) * Math.min(1, dt * 0.8);
    const m = game.monster;
    if (audio.started) {
      let zone = near && near.zone;
      const tight = player.stance !== "stand" || roomH < 1.9 || (near && near.clearance && near.clearance !== "stand");
      if (!zone) {
        if (tight) zone = "squeeze";
        else if (size > 6 || (near && near.kind === "cavern")) zone = "hall";
        else if (Math.max(0, info.depth) < 10) zone = "entrance";
        else zone = "corridor";
      } else if (tight && zone !== "hall") zone = "squeeze";
      audio.setScene({
        zone,
        move: Math.min(1, speedSmooth / 2.3),
        running: player.runFrac > 0.45 && speedSmooth > 2.6,
        runFrac: player.runFrac,
        depth: Math.max(0, info.depth) / Math.max(10, depthSpan),
        tight: !!tight,
        dark: 1,
        threat: threatLevel(),
        monster: !!m,
        dt,
      });
      if (m) monsterVoice.update(m.pos, m.distToPlayer ?? 50, game.time);
    }
    }
    // Character + torch.
    const st = player.stanceDef();
    caveman.update(dt, {
      feet: feetPos(),
      eye: camera.position,
      yaw: player.yaw,
      pitch: player.pitch,
      speed: game.dead ? 0 : animSpeed,
      runFrac: player.runFrac || 0,
      stance: player.stance,
    });
    caveman.root.visible = !game.dead;
    void st;
    // Hurt feedback.
    const low = !game.dead && game.health === 1 ? 0.28 + 0.12 * Math.sin(game.time * 4) : 0;
    if (vignetteEl) vignetteEl.style.opacity = String(Math.min(1, Math.max(game.vignette, low)));
    updateView(dt);
    if (game.camOverride) { const o = game.camOverride; viewCam.position.set(o[0], o[1], o[2]); viewCam.up.set(0, 1, 0); viewCam.lookAt(o[3], o[4], o[5]); }
  } else {
    viewCam.position.copy(camera.position);
    viewCam.quaternion.copy(camera.quaternion);
  }
  caveman.setPixelHeight(renderer.domElement.height);
  renderer.render(scene, viewCam);
  if (debugOn && now - debugLast > 250) { debugLast = now; renderDebug(); }
  requestAnimationFrame(tick);
}

// ---------------- Debug overlay (G) ----------------
const debugEl = document.getElementById("debug");
let debugOn = false, debugLast = 0;
function setDebug(on) {
  debugOn = !!on;
  debugEl?.classList.toggle("hidden", !debugOn);
  chunks.setDebug(debugOn);
  if (debugOn) renderDebug();
}
function renderDebug() {
  if (!debugEl) return;
  const s = chunks.summary(), inf = renderer.info;
  const per = Object.entries(s.per).map(([k, v]) => `${k} ${v.loaded}${v.queued ? "+" + v.queued : ""}`).join(" · ") || "none";
  const heap = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + " MB" : "n/a";
  const cells = world.caveLayer ? ` / ${world.caveLayer.totalCells} cells` : "";
  debugEl.textContent =
    `${world.mode}${STREAM ? "" : " (no streaming)"}  ·  chunks ${s.loaded}${cells} (${per})\n` +
    `chunk tris ${(s.tris / 1000).toFixed(0)}k  ·  loads ${s.loads}  unloads ${s.unloads}\n` +
    `draw calls ${inf.render.calls}  ·  tris drawn ${(inf.render.triangles / 1000).toFixed(0)}k\n` +
    `geometries ${inf.memory.geometries}  ·  textures ${inf.memory.textures}  ·  heap ${heap}\n` +
    `stream job max ${s.maxJobMs} ms  ·  frame ${s.lastFrameMs} ms (max ${s.maxFrameMs})  ·  over budget ${s.overBudget}`;
}
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (e.code === "KeyG") setDebug(!debugOn);
});
document.getElementById("debug-btn")?.addEventListener("click", (e) => { e.stopPropagation(); setDebug(!debugOn); });
document.getElementById("hills-btn")?.addEventListener("click", (e) => { e.stopPropagation(); transition(() => enterOverworld()); });

function tickOverworld(dt, info, now) {
  const p = camera.position, t = world.terrain, A = world.atmo;
  const elev = t.height(p.x, p.z);
  depthEl.textContent = `Elevation ${fmt(elev)} m`;
  distEl.textContent = `Travelled ${fmt(info.travelled)} m`;
  const camp = world.camp, site = t.act1;
  let extra = null;
  if (site) {
    const marks = [{ x: site.camp.x, z: site.camp.z, color: camp?.fireLit ? "#ffb050" : "#b08a60", label: story.active ? "Camp" : "" }];
    if (story.active && story.flags.lumeDead) marks.push({ x: site.pool.x, z: site.pool.z, color: "#9fd4ff", label: "Falls" });
    const dots = story.active && story.surv.skills.has("tracking") ? world.wildlife.list.filter((a) => a.alive && a.dist < 140).map((a) => ({ x: a.pos.x, z: a.pos.z, color: a.kind === "deer" || a.kind === "boar" || a.kind === "goat" ? "#e0a060" : "#d8d0c0" })) : [];
    extra = { stream: site.stream, marks, dots };
  }
  minimap.drawOverworld(t, p, player.yaw, world.discovered, extra);
  updateLowHint(info);
  const st = game.timeFrozen ? A.update(0, { eye: viewCam.position, elevation: elev, lights: { sun: moonLight, hemi: skyFill, ambient }, fog: scene.fog, renderer })
    : A.update(dt, { eye: viewCam.position, elevation: elev, lights: { sun: moonLight, hemi: skyFill, ambient }, fog: scene.fog, renderer });
  scene.background.copy(A.fogColor);
  world.over.tick(now / 1000, p, A);
  caveman.baseIntensity = 14 * st.torch;
  const lab = A.label();
  storyUI.setClock(`${lab.part} ${lab.clock} · ${lab.weather}`);
  let campD = Infinity, waterD = Infinity;
  if (camp) {
    camp.update(dt, now / 1000);
    campD = Math.hypot(p.x - site.camp.x, p.z - site.camp.z);
    waterD = Math.min(Math.hypot(p.x - camp.fallPos.x, p.z - camp.fallPos.z) / 3, t.streamDist(p.x, p.z) + 4);
  }
  if (world.wildlife) {
    const f = feetPos();
    world.wildlife.update(dt, { pos: f, speed: speedSmooth, crouched: player.stance !== "stand", running: player.runFrac > 0.4 }, now / 1000);
  }
  let near = null, nd = Infinity;
  for (const e of t.entrances) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < nd) { nd = d; near = e; } }
  const place = campD < 26 ? "River-Tooth Camp" : near && nd < 28 ? near.name : "";
  if (place !== placeShown) { placeShown = place; placeEl.textContent = place; placeEl.classList.toggle("show", !!place); }
  const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z) / Math.max(dt, 1e-3);
  lastPos.copy(p);
  speedSmooth += (Math.min(moved, 5) - speedSmooth) * Math.min(1, dt * 3);
  animSpeed += (Math.min(moved, 6) - animSpeed) * Math.min(1, dt * 10);
  if (audio.started) {
    audio.setEars?.(p, player.yaw);
    audio.setAmbience?.({ night: st.night, dawn: st.dawn, day: st.day, rain: st.rain + st.snow * 0.2, wind: st.wind, storm: st.storm, water: Math.max(0, 1 - waterD / 14) });
    const zone = campD < 45 ? (st.dawn > 0.4 ? "dawn" : "camp") : "outdoor";
    audio.setScene({ zone, move: Math.min(1, speedSmooth / 2.3), running: player.runFrac > 0.45 && speedSmooth > 2.6, runFrac: player.runFrac, depth: 0, tight: false, dark: 0.6, threat: 0, monster: false, dt });
  }
}

function lookAtFeature(kind) {
  if (!player || !cave) return false;
  const smap = stationMap(cave);
  if (kind === "waterfall" || kind === "pool") {
    const w = waterHandle?.features?.waterfall;
    const pool = waterHandle?.features?.pool;
    if (kind === "waterfall" && w) {
      const vx = w.lookX - w.x;
      const vz = w.lookZ - w.z;
      const len = Math.hypot(vx, vz) || 1;
      const nx = vx / len, nz = vz / len;
      const sx = -nz, sz = nx;
      player.placeWorld(w.lookX + nx * 1.6 + sx * 1.0, w.poolY + 1.45, w.lookZ + nz * 1.6 + sz * 1.0);
      player.lookAtPoint(w.x, (w.lipY + w.poolY) * 0.45, w.z);
      return true;
    }
    if (pool) {
      player.placeWorld(pool.x + pool.radius * 0.2, pool.y + 1.5, pool.z + pool.radius * 0.35);
      player.lookAtPoint(pool.x, pool.y, pool.z);
      return true;
    }
  }
  if (kind === "stream") {
    const s = waterHandle?.features?.stream;
    if (s) {
      const dx = (s.lookX ?? s.x) - s.x;
      const dz = (s.lookZ ?? s.z) - s.z;
      const len = Math.hypot(dx, dz) || 1;
      const sx = -dz / len, sz = dx / len;
      player.placeWorld(s.x - dx / len * 1.2 + sx * 0.35, s.y + 1.45, s.z - dz / len * 1.2 + sz * 0.35);
      player.lookAtPoint(s.lookX ?? s.x, (s.lookY ?? s.y) + 0.1, s.lookZ ?? s.z);
      return true;
    }
  }
  if (kind === "formations" || kind === "cavern") {
    const poolId = cave.water && cave.water.poolStationId;
    const room = (kind === "cavern" && poolId && cave.stations.find((s) => s.id === poolId && s.kind === "cavern"))
      || cave.stations.find((s) => s.kind === "cavern")
      || cave.stations.find((s) => s.kind === "chamber")
      || cave.stations[Math.min(8, cave.stations.length - 1)];
    if (room) {
      player.setStance("stand");
      const p = stationWorld(room);
      const nbrs = neighborsOf(cave);
      const nids = nbrs.get(room.id) || [];
      // Prefer the incoming stream/passage, not an alcove, so the open hall is in frame.
      const fromId = (cave.water && cave.water.waterfall && cave.water.waterfall.fromId)
        || nids.find((id) => smap.get(id) && smap.get(id).kind !== "cavern")
        || nids[0];
      const from = fromId && smap.get(fromId);
      const w = waterHandle?.features?.waterfall;
      const pool = waterHandle?.features?.pool;
      const waterHere = !!(w && pool && Math.hypot((pool.x - p.x), (pool.z - p.z)) < Math.max(10, room.left + room.right + 4));
      const alcove = nids.map((id) => smap.get(id)).find((s) => s && s.kind === "cavern" && s.id !== (from && from.id));
      let x = p.x, z = p.z;
      if (from) {
        const q = stationWorld(from);
        const dx = p.x - q.x, dz = p.z - q.z;
        const len = Math.hypot(dx, dz) || 1;
        // Stand on the far side of the hall, looking back at the mouth / waterfall,
        // so we are not inside the fall sheet and the open room is in frame.
        const back = kind === "cavern" ? -2.2 : 1.1;
        x = p.x - (dx / len) * back;
        z = p.z - (dz / len) * back;
      }
      player.placeWorld(x, p.y - room.down + 1.55, z);
      if (waterHere) {
        const lipY = w.lipY || (pool.y + 3);
        player.lookAtPoint(w.x, pool.y + Math.min(2.8, (lipY - pool.y) * 0.55 + 0.8), w.z);
        if (alcove && kind === "cavern") player.yaw += 0.28;
        player.applyLook();
      } else if (alcove) {
        const tgt = stationWorld(alcove);
        player.lookAtPoint(tgt.x, p.y + Math.min(3.4, room.up * 0.22), tgt.z);
      } else if (from) {
        const tgt = stationWorld(from);
        player.lookAtPoint(tgt.x, p.y + room.up * 0.2, tgt.z);
      } else {
        player.pitch = kind === "cavern" ? 0.22 : 0.35;
        player.yaw += 0.55;
        player.applyLook();
      }
      return true;
    }
  }
  if (kind === "fallclose") {
    const w = waterHandle?.features?.waterfall;
    if (w) {
      const pool = waterHandle.features.pool;
      const vx = w.lookX - w.x, vz = w.lookZ - w.z;
      const l = Math.hypot(vx, vz) || 1;
      const back = Math.min(5, Math.max(3, (w.lipY - w.poolY) * 0.8));
      const x = w.x + (vx / l) * back + (-vz / l) * 0.9;
      const z = w.z + (vz / l) * back + (vx / l) * 0.9;
      player.setStance("stand");
      player.placeWorld(x, w.poolY + STANCES.stand.eye, z);
      player.lookAtPoint(w.x, w.poolY + (w.lipY - w.poolY) * 0.5, w.z);
      player.applyLook();
      void pool;
      return true;
    }
  }
  if (kind === "junction") {
    const nbrs = neighborsOf(cave);
    const j = cave.stations.find((s) => (nbrs.get(s.id) || []).length >= 3 && s.kind !== "cavern" && s.kind !== "chamber")
      || cave.stations.find((s) => (nbrs.get(s.id) || []).length >= 3);
    if (j) {
      const ids = nbrs.get(j.id);
      const from = smap.get(ids[0]);
      const a = stationWorld(from);
      const b = stationWorld(j);
      const t = 0.45;
      player.setStance("stand");
      player.placeWorld(a.x * (1 - t) + b.x * t, (a.y - from.down) * (1 - t) + (b.y - j.down) * t + STANCES.stand.eye, a.z * (1 - t) + b.z * t);
      player.lookAtPoint(b.x, b.y - j.down + 1.2, b.z);
      return true;
    }
  }
  if (kind === "crawl") {
    const crawl = cave.stations.find((s) => s.clearance === "crawl" && s.kind !== "cavern")
      || cave.stations.find((s) => s.clearance === "crawl");
    if (crawl) {
      const nbrs = neighborsOf(cave);
      const nid = (nbrs.get(crawl.id) || []).find((id) => {
        const n = smap.get(id);
        return n && (n.clearance || "stand") === "stand";
      }) || (nbrs.get(crawl.id) || []).find((id) => (smap.get(id)?.clearance || "stand") !== "crawl") || (nbrs.get(crawl.id) || [])[0];
      const from = nid ? smap.get(nid) : crawl;
      const a = stationWorld(from);
      const b = stationWorld(crawl);
      const fromH = (from.up + from.down) || 2;
      const crawlH = (crawl.up + crawl.down) || 0.8;
      // Stand where the roof is still high enough to walk, close enough that the squeeze fills the view.
      const standH = STANCES.stand.eye + STANCES.stand.head + 0.2;
      let t = 0.55;
      if (fromH !== crawlH) t = Math.max(0.2, Math.min(0.72, (fromH - standH) / (fromH - crawlH)));
      t = Math.min(t, 0.62);
      const fromStance = from.clearance === "crawl" ? "crawl" : from.clearance === "crouch" ? "crouch" : "stand";
      player.setStance(fromStance);
      const px = a.x * (1 - t) + b.x * t;
      const pz = a.z * (1 - t) + b.z * t;
      const py = (a.y - from.down) * (1 - t) + (b.y - crawl.down) * t + STANCES[fromStance].eye;
      player.placeWorld(px, py, pz);
      player.lookAtPoint(b.x, b.y - crawl.down + 0.28, b.z);
      return true;
    }
  }
  return false;
}

function stressTest(opts = {}) {
  const seeds = opts.seeds || [1847265319, 90210, 42, 7, 99991];
  const seconds = opts.seconds || 6;
  const dt = opts.dt || 1 / 30;
  const saved = cave?.seed;
  const results = [];
  const patterns = [
    { x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 },
    { x: 1, z: -1 }, { x: -1, z: -1 }, { x: 0.4, z: -1 }, { x: -0.4, z: -1 },
  ];
  for (const seed of seeds) {
    newCave(seed);
    const nbrs = neighborsOf(cave);
    const junction = cave.stations.find((s) => (nbrs.get(s.id) || []).length >= 3);
    const starts = [
      () => player.spawnAtEntrance(),
      () => player.placeAlongMainPath(0.4, mainPath),
      () => player.placeAlongMainPath(0.75, mainPath),
    ];
    if (junction) {
      const p = stationWorld(junction);
      starts.push(() => player.placeWorld(p.x, p.y - junction.down + 1.5, p.z));
    }
    const rescues0 = player.rescues;
    let escapes = 0;
    let frames = 0;
    let maxOutside = 0;
    let standEnteredCrawl = 0;
    let crawlEntered = false;
    let crouchEntered = false;
    let exitPathOk = true;
    const slice = seconds / starts.length;
    for (const start of starts) {
      start();
      player.setStance("stand");
      let t = 0;
      let pi = 0;
      while (t < slice) {
        if (Math.floor(t / 0.55) !== Math.floor((t - dt) / 0.55)) {
          pi = (pi + 1) % patterns.length;
          player.yaw += 0.85;
        }
        player.update(dt, patterns[pi]);
        frames += 1;
        const pos = player.camera.position;
        const inside = pointInside(player.volume, pos.x, pos.y, pos.z, player.stanceDef().radius, 0.22);
        if (!inside) {
          escapes += 1;
          const q = player.readout().nearest;
          if (q && q.best && q.best.dist > maxOutside) maxOutside = q.best.dist;
        }
        t += dt;
      }
    }

    // Containment also in crouch, crawl, and a cavern.
    const cavernSt = cave.stations.find((s) => s.kind === "cavern");
    for (const stName of ["crouch", "crawl"]) {
      player.placeAlongMainPath(0.5, mainPath);
      player.setStance(stName);
      for (let i = 0; i < 70; i++) {
        if (i % 18 === 0) player.yaw += 0.9;
        player.update(dt, patterns[i % patterns.length]);
        frames += 1;
        const pos = player.camera.position;
        if (!pointInside(player.volume, pos.x, pos.y, pos.z, player.stanceDef().radius, 0.22)) escapes += 1;
      }
    }
    if (cavernSt) {
      const cp = stationWorld(cavernSt);
      player.setStance("stand");
      player.placeWorld(cp.x, cp.y - cavernSt.down + STANCES.stand.eye, cp.z);
      for (let i = 0; i < 70; i++) {
        if (i % 18 === 0) player.yaw += 0.7;
        player.update(dt, patterns[i % patterns.length]);
        frames += 1;
        const pos = player.camera.position;
        if (!pointInside(player.volume, pos.x, pos.y, pos.z, player.stanceDef().radius, 0.22)) escapes += 1;
      }
    }

    // Stance gates: standing must not fit a crawl; crawl/crouch must fit their passages.
    const crawlSt = cave.stations.find((s) => s.clearance === "crawl");
    const crouchSt = cave.stations.find((s) => s.clearance === "crouch");
    function eyeAt(st, stance) {
      const p = stationWorld(st);
      return { x: p.x, y: p.y - st.down + STANCES[stance].eye, z: p.z };
    }
    if (crawlSt) {
      const p = eyeAt(crawlSt, "stand");
      if (canFitStance(player.volume, p.x, p.y, p.z, "stand")) standEnteredCrawl += 1;
    }
    function approach(station, stance) {
      if (!station) return { entered: false };
      const p = eyeAt(station, stance);
      const fits = canFitStance(player.volume, p.x, p.y, p.z, stance);
      const nid = (nbrs.get(station.id) || []).find((id) => {
        const n = cave.stations.find((s) => s.id === id);
        return n && (n.clearance || "stand") !== "crawl";
      }) || (nbrs.get(station.id) || [])[0];
      const from = nid ? cave.stations.find((s) => s.id === nid) : station;
      const a = stationWorld(from);
      const b = stationWorld(station);
      player.setStance(from.clearance === "crouch" ? "crouch" : "stand");
      player.placeWorld(a.x * 0.7 + b.x * 0.3, a.y - from.down + 1.0, a.z * 0.7 + b.z * 0.3);
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      player.yaw = Math.atan2(-dx / len, -dz / len);
      player.setStance(stance);
      let entered = fits;
      for (let i = 0; i < 160; i++) {
        player.update(dt, { x: 0, z: -1 });
        frames += 1;
        const pos = player.camera.position;
        if (!pointInside(player.volume, pos.x, pos.y, pos.z, player.stanceDef().radius, 0.22)) escapes += 1;
        const dist = Math.hypot(pos.x - b.x, pos.z - b.z);
        if (dist < 1.25) entered = true;
        if (stance === "stand" && player.stance === "stand" && dist < 0.85) {
          standEnteredCrawl += 1;
        }
      }
      return { entered };
    }
    const crawlVsCrawl = approach(crawlSt, "crawl");
    crawlEntered = crawlVsCrawl.entered || !crawlSt;
    const crouchVsCrouch = approach(crouchSt, "crouch");
    crouchEntered = crouchVsCrouch.entered || !crouchSt;
    approach(crawlSt, "stand");

    // Exit route is passable at least in crawl.
    player.setStance("crawl");
    for (const id of mainPath) {
      const s = cave.stations.find((st) => st.id === id);
      if (!s) continue;
      const p = stationWorld(s);
      if (!canFitStance(player.volume, p.x, p.y - s.down + STANCES.crawl.eye, p.z, "crawl")) {
        exitPathOk = false;
        break;
      }
    }

    results.push({
      seed,
      name: cave.name,
      frames,
      escapes,
      rescues: player.rescues - rescues0,
      maxOutside: Math.round(maxOutside * 1000) / 1000,
      standEnteredCrawl,
      crawlEntered,
      crouchEntered,
      exitPathOk,
      caverns: cave.stations.filter((s) => s.kind === "cavern").length,
      crawls: cave.stations.filter((s) => s.clearance === "crawl").length,
    });
  }
  if (saved != null) newCave(saved);
  return {
    passed: results.every((r) => r.escapes === 0 && r.standEnteredCrawl === 0 && r.crawlEntered && r.crouchEntered && r.exitPathOk),
    results,
  };
}

function sceneStats() {
  let tris = 0, verts = 0, bytes = 0, meshes = 0;
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return;
    meshes++;
    const g = o.geometry; if (!g) return;
    const n = (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
    if (seen.has(g)) return; seen.add(g);
    verts += g.attributes.position?.count || 0;
    for (const k in g.attributes) bytes += g.attributes[k].array.byteLength;
    if (g.index) bytes += g.index.array.byteLength;
  });
  const inf = renderer.info;
  return { view: { calls: inf.render.calls, triangles: inf.render.triangles }, gpu: { geometries: inf.memory.geometries, textures: inf.memory.textures }, scene: { meshes, triangles: Math.round(tris), vertices: verts, geometryMB: +(bytes / 1048576).toFixed(1) }, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
}
window.__CAVE__ = {
  /** Act 1 test / debug hooks. */
  act1: {
    get story() { const st = story.currentStep(); return { active: story.active, flags: { ...story.flags }, step: st ? st.title : "done", lines: st ? st.lines : [], surv: story.surv.toJSON(), glyphs: story.glyphs.length, prompt: story.prompt?.label || null, log: story.log.slice(-40), modal: storyUI.modal, armed: game.armed, health: game.health, maxHealth: game.maxHealth }; },
    interact: () => story.interact(),
    give: (id, n = 1) => story.surv.add(id, n),
    choose: (id) => { const b = document.querySelector(`.choice .opt[data-id="${id}"]`); if (!b) return false; b.click(); return true; },
    panel: (tab) => (tab ? storyUI.openPanel(tab, story.surv) : storyUI.closePanel()),
    panelAction: (a, id) => story.panelAction(a, id),
    atmo: () => world.atmo && { ...world.atmo.state, nextChange: +world.atmo.nextChange.toFixed(2) },
    setTime: (h) => world.atmo?.setTime(h),
    setWeather: (w, instant = true) => world.atmo?.setWeather(w, instant),
    freezeTime: (v = true) => { game.timeFrozen = !!v; },
    rolls: () => world.atmo?.rolls,
    /** Screenshot camera: [x,y,z, tx,ty,tz] or null. "camp" = overview of the camp. */
    cam: (o) => {
      if (o === "camp") { const C = world.terrain.act1.camp, L = world.camp.lume; const h = world.terrain.height(C.x, C.z); o = [C.x + (C.x - L.x) * 4 + 3, h + 7, C.z + (C.z - L.z) * 4 + 3, C.x, h + 0.5, C.z]; }
      if (o === "lume") { const C = world.terrain.act1.camp, L = world.camp.lume; const h = world.terrain.height(L.x, L.z); const dx = C.x - L.x, dz = C.z - L.z, l = Math.hypot(dx, dz) || 1; o = [L.x + (dx / l) * 2.6 - (dz / l) * 2.2, h + 1.7, L.z + (dz / l) * 2.6 + (dx / l) * 2.2, L.x, h + 0.8, L.z]; }
      game.camOverride = o;
    },
    weathers: WEATHERS,
    site: () => world.terrain?.act1 && { camp: world.terrain.act1.camp, pool: world.terrain.act1.pool, hollow: { x: world.terrain.act1.caveEntrance.x, z: world.terrain.act1.caveEntrance.z, id: world.terrain.act1.caveEntrance.id }, stream: world.terrain.act1.stream, h: (x, z) => world.terrain.height(x, z), entrances: world.terrain.entrances },
    /** Teleport next to a named target outdoors, facing it. */
    goto: (what, dist = 1.6, side = 0) => {
      const c = world.camp, t = world.terrain, a = t.act1; let p = null;
      if (what === "lume") p = c.lume; else if (what === "fire") p = a.camp; else if (what === "tor") p = c.tor;
      else if (what === "bush") p = c.bushes.find((b) => b.ready && b.kind === "berries"); else if (what === "roots") p = c.bushes.find((b) => b.ready && b.kind === "roots");
      else if (what === "stream") { const q = a.stream[Math.floor(a.stream.length * 0.6)]; p = { x: q.x, z: q.z }; }
      else if (what === "falls") p = a.pool; else if (what === "hollow") { const e = a.caveEntrance; p = { x: e.x + e.fx * 8, z: e.z + e.fz * 8 }; }
      else if (what === "campview") p = a.camp;
      if (!p) return false;
      const an = what === "hollow" ? 0 : 0.8 + side;
      const x = p.x + Math.cos(an) * dist, z = p.z + Math.sin(an) * dist;
      let tx = p.x, tz = p.z;
      if (what === "hollow") { tx = a.caveEntrance.x; tz = a.caveEntrance.z; }
      player.setStance("stand");
      player.setTerrain(t, x, z, Math.atan2(-(tx - x), -(tz - z)));
      player.pitch = -0.1; player.applyLook();
      return true;
    },
    /** Stalk position: crouched, `d` m behind the nearest living animal of a kind, facing it. */
    stalk: (kind, d = 2.0) => {
      const n = world.wildlife.nearest(feetPos(), kind); if (!n) return null;
      const a = n.a; const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      const x = a.pos.x - fx * d, z = a.pos.z - fz * d;
      player.setTerrain(world.terrain, x, z, Math.atan2(-(a.pos.x - x), -(a.pos.z - z)));
      player.setStance("crouch");
      return { id: a.id, state: a.state };
    },
    wildlife: () => world.wildlife?.list.map((a) => ({ id: a.id, kind: a.kind, state: a.state, alive: a.alive, harvested: a.harvested, dist: +(a.dist ?? -1).toFixed(1), y: +(a.pos.y - world.terrain.height(a.pos.x, a.pos.z)).toFixed(2) })),
    wildlifeLog: () => world.wildlife?.log.slice(-30),
    /** In a cave: stand at a fraction of the main path, then face the closest wall. */
    caveGoto: (frac) => { const sp = window.__CAVE__.place(frac); return sp; },
    faceWall: () => {
      let best = null;
      for (let i = 0; i < 24; i++) { player.yaw = (i / 24) * Math.PI * 2; player.applyLook(); const w = story.wallAhead(); if (w) { const d = Math.hypot(w.x - camera.position.x, w.z - camera.position.z); if (!best || d < best.d) best = { d, yaw: player.yaw }; } }
      if (best) { player.yaw = best.yaw; player.pitch = 0; player.applyLook(); }
      return best;
    },
    toHunter: () => { const h = story.hunter; if (!h) return false; const yawTo = Math.atan2(-(h.x - camera.position.x), -(h.z - camera.position.z)); const q = window.__CAVE__.queryFloor(h.x, h.obj.position.y + 1.6, h.z); player.placeWorld(h.x + Math.sin(yawTo) * 1.2, h.obj.position.y + 1.55, h.z + Math.cos(yawTo) * 1.2); player.yaw = yawTo; player.applyLook(); return q; },
    ratState: () => { const m = game.monster; return m ? { kind: m.kind, alive: m.alive, health: m.health, state: m.state, dist: +(m.distToPlayer ?? -1).toFixed(2) } : null; },
    kill: () => { game.god = false; game.invuln = 0; game.health = 1; damagePlayer(); return game.dead; },
    toCarcass: () => { const f = feetPos(); const c = world.wildlife?.nearestCarcass(f, 9999); if (!c) return null; player.setTerrain(world.terrain, c.pos.x + 1, c.pos.z + 0.6, Math.atan2(1, 0.6)); return c.kind; },
    newGame: () => startNewGame(),
    continueGame: () => continueGame(),
    freePlay: () => startFreePlay(),
    menu: () => showMainMenu(),
    hasSave: () => !!readSave(),
    ui: () => ({ objective: storyUI.obj.textContent, prompt: storyUI.prompt.classList.contains("hidden") ? null : storyUI.prompt.textContent, dialog: storyUI.dialog.classList.contains("hidden") ? null : storyUI.dialog.textContent, toasts: [...storyUI.toasts.children].map((t) => t.textContent), clock: storyUI.clock.textContent }),
    audio: () => ({ zone: audio.music?.zone, laments: audio.music?.lamentCount || 0, amb: audio.amb }),
  },
  stats: () => sceneStats(),
  chunkStats: () => ({ ...chunks.summary(), phaseMax: world.caveLayer?.phaseMax }),
  resetChunkStats: () => chunks.resetStats(),
  setDebug: (on) => setDebug(on),
  get world() { return { mode: world.mode, entrance: world.entrance ? world.entrance.id : null, exitArmed: world.exitArmed, busy: world.busy, transitions: world.transitions.slice(), discovered: [...world.discovered], entrances: world.terrain ? world.terrain.entrances.map((e) => ({ id: e.id, name: e.name, cave: e.cave, x: e.x, z: e.z, fx: e.fx, fz: e.fz, scale: e.scale })) : [] }; },
  enterEntrance: (i, instant = true) => enterEntrance(world.terrain.entrances[i], instant),
  returnToOverworld: (instant = true) => returnToOverworld(instant),
  enterOverworld: () => enterOverworld(),
  terrainHeight: (x, z) => world.terrain?.height(x, z),
  streamCtx: () => streamCtx(),
  get mainPath() { return mainPath.slice(); },
  queryFloor: (x, y, z) => { const q = queryVolume(player.volume, x, y, z, STANCES.stand.radius, 0.1); return { inside: q.inside, floor: +q.floor.toFixed(2), ceil: +q.ceil.toFixed(2) }; },
  /** Overworld: walk a heading for `dist` m with streaming on; reports ground-following + chunk churn. */
  walkOverworld: (dist = 400, yaw = 0, opts = {}) => {
    const dt = opts.dt || 1 / 60, P = player, cam = P.camera, t = world.terrain;
    P.yaw = yaw; P.applyLook();
    let frames = 0, walked = 0, maxAbove = 0, maxBelow = 0, stuck = 0, maxLoaded = 0, maxStream = 0;
    const s0 = { ...chunks.summary() };
    while (walked < dist && frames < (dist / 0.5) / dt) {
      const px = cam.position.x, pz = cam.position.z;
      P.yaw = yaw + Math.sin(frames * dt * 0.4) * 0.35; // weave a bit
      P.joy.active = true; P.joy.dx = 0; P.joy.dy = -1; P.joy.mag = opts.mag ?? 1.15;
      P.update(dt);
      const t0 = performance.now();
      chunks.update(streamCtx());
      maxStream = Math.max(maxStream, performance.now() - t0);
      world.over.tick(frames * dt, cam.position);
      frames++;
      const mv = Math.hypot(cam.position.x - px, cam.position.z - pz);
      walked += mv;
      if (frames > 30 && mv < P.speedNow * dt * 0.2) stuck++;
      const g = t.height(cam.position.x, cam.position.z) + P.stanceDef().eye;
      const off = cam.position.y - (P.bobY || 0) - g;
      maxAbove = Math.max(maxAbove, off); maxBelow = Math.min(maxBelow, off);
      maxLoaded = Math.max(maxLoaded, chunks.summary().loaded);
    }
    P.joy.active = false; P.joy.mag = 0;
    const s1 = chunks.summary();
    return { frames, walked: +walked.toFixed(1), maxAboveGround: +maxAbove.toFixed(3), maxBelowGround: +maxBelow.toFixed(3), stuckFrames: stuck,
      loads: s1.loads - s0.loads, unloads: s1.unloads - s0.unloads, loaded: s1.loaded, maxLoaded, maxStreamMs: +maxStream.toFixed(2), maxJobMs: s1.maxJobMs, overBudget: s1.overBudget - s0.overBudget,
      pos: [cam.position.x, cam.position.z].map((v) => +v.toFixed(1)) };
  },
  ready: false,
  errors,
  seed: null,
  info: null,
  generate: (s) => newCave(s),
  place: (t) => player?.placeAlongMainPath(Number(t), mainPath),
  look: (yaw, pitch) => {
    if (!player) return;
    if (yaw != null) player.yaw = yaw;
    if (pitch != null) player.pitch = pitch;
    player.applyLook();
  },
  lookAtFeature,
  water: () => waterHandle?.features,
  placeAt: (id, lookId, pitch = 0.1, back = 0, side = 0) => {
    const smap = stationMap(cave);
    const s = smap.get(id);
    if (!s) return false;
    const p = stationWorld(s);
    const t = lookId ? stationWorld(smap.get(lookId)) : { x: p.x, y: p.y, z: p.z - 1 };
    const dx = t.x - p.x, dz = t.z - p.z, l = Math.hypot(dx, dz) || 1;
    player.setStance("stand");
    player.placeWorld(p.x - (dx / l) * back + (-dz / l) * side, p.y - s.down + STANCES.stand.eye, p.z - (dz / l) * back + (dx / l) * side);
    player.yaw = Math.atan2(-dx / l, -dz / l);
    player.pitch = pitch;
    player.applyLook();
    return true;
  },
  audioState: () => ({ started: audio.started, state: audio.ctx?.state, music: !!audio.music, musicOn: audio.musicOn, intensity: +audio.intensity.toFixed(3), move: +audio.moodMove.toFixed(2), depth: +audio.moodDepth.toFixed(2), zone: audio.music?.zone, bpm: audio.music ? audio.music.bpm : 0, chord: audio.music?.chord, braams: audio.music?.braamCount || 0, risers: audio.music?.riserCount || 0, nearEvents: audio.music?.nearCount || 0 }),
  musicMeter: () => new Promise((res) => {
    const m = audio.music; if (!m) return res(null);
    if (!m._an) { m._an = audio.ctx.createAnalyser(); m._an.fftSize = 2048; m.level.connect(m._an); }
    const buf = new Float32Array(2048); let peak = 0, sum = 0, n = 0, k = 0;
    const iv = setInterval(() => { m._an.getFloatTimeDomainData(buf); for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; } if (++k >= 20) { clearInterval(iv); res({ rmsDb: +(10 * Math.log10(sum / n + 1e-12)).toFixed(1), peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(1), voices: m.liveVoices }); } }, 50);
  }),
  pick: (nx, ny) => {
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), viewCam);
    return rc.intersectObjects(scene.children, true).slice(0, 4).map((h) => ({ name: h.object.name, type: h.object.type, parent: h.object.parent?.name, mat: h.object.material?.color?.getHexString?.(), mtype: h.object.material?.type, side: h.object.material?.side, d: +h.distance.toFixed(1), p: [h.point.x, h.point.y, h.point.z].map((v) => +v.toFixed(1)) }));
  },
  forceNear: () => audio.music && audio.music._somethingNear(),
  ray: (nx, ny) => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const mesh = caveGroup.getObjectByName("passages");
    const side = mesh.material.side;
    mesh.material.side = THREE.DoubleSide;
    const hits = rc.intersectObject(mesh, false).slice(0, 4).map((h) => ({ who: (mesh.userData.ranges || []).filter((r) => r.start <= h.face.a).pop()?.name, d: +h.distance.toFixed(2), f: h.faceIndex, a: h.face.a, front: h.face.normal.dot(rc.ray.direction) < 0, p: [h.point.x, h.point.y, h.point.z].map((v) => +v.toFixed(2)) }));
    mesh.material.side = side;
    return hits;
  },
  stressTest,
  getMeshCount: () => {
    let n = 0;
    caveGroup?.traverse(() => { n += 1; });
    return n;
  },
  get player() { return player; },
  /** Scripted walk along stations using the analog joystick; logs vertical spikes and stuck frames. */
  get game() { return game; },
  get tally() { return { ...tally }; },
  monsterState: () => {
    const m = game.monster;
    if (!m) return null;
    return { state: m.state, alive: m.alive, health: m.health, dist: +(m.distToPlayer ?? -1).toFixed(2), heard: m.heard, seen: m.seen,
      pos: [+m.pos.x.toFixed(1), +m.pos.y.toFixed(1), +m.pos.z.toFixed(1)], spawnNode: m.spawnNode, events: m.events.slice(-12), voice: monsterVoice.log.slice(-12) };
  },
  /** Put the monster `d` m in front of the player (snapped inside the passage), in a given state. */
  placeMonster: (d = 3, state = "roam") => {
    const m = game.monster; if (!m) return false;
    const f = feetPos();
    let best = null;
    for (let k = 0; k <= 8; k++) {
      const dd = d * (1 - k * 0.1);
      const x = f.x - Math.sin(player.yaw) * dd, z = f.z - Math.cos(player.yaw) * dd;
      const g = m.groundAt(x, z, f.y);
      if (g.inside) { best = { x, y: g.floor, z }; break; }
    }
    if (!best) return false;
    m.pos.set(best.x, best.y, best.z);
    m.alive = true; m.m.root.visible = true;
    m.setState(state);
    m.path = [];
    return true;
  },
  attack: () => attack(),
  /** Stand in a roomy spot (wide + tall) looking along the passage; for screenshots. */
  placeRoomy: (minW = 3.2, minH = 2.8, skip = 0) => {
    const nb = neighborsOf(cave), sm = stationMap(cave);
    const list = cave.stations.filter((s) => s.kind !== "entrance" && s.kind !== "cavern" && s.left + s.right >= minW && s.up + s.down >= minH && (nb.get(s.id) || []).length >= 1);
    const ent = stationWorld(sm.get(cave.entranceId));
    const dd = (st) => { const w = stationWorld(st); return Math.hypot(w.x - ent.x, w.y - ent.y, w.z - ent.z); };
    list.sort((p, q) => dd(q) - dd(p));
    const s = list[Math.min(list.length - 1, Math.floor(list.length * 0.25) + skip)];
    if (!s) return null;
    const n = sm.get(nb.get(s.id)[0]);
    const a = stationWorld(s), b = stationWorld(n);
    player.setStance("stand");
    player.placeWorld(a.x, a.y - s.down + STANCES.stand.eye, a.z);
    player.lookAtPoint(b.x, b.y - n.down + 1.2, b.z);
    player.pitch = -0.08; player.applyLook();
    return s.id;
  },
  viewInfo: () => {
    camera.updateMatrixWorld();
    const eye = camera.position.clone();
    const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), bk = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    const samples = [];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = eye.clone().addScaledVector(r, 0.5 * t).addScaledVector(bk, 2.7 * t); p.y += 0.32 * t;
      const q = queryVolume(player.volume, p.x, p.y, p.z, 0.3, 0);
      samples.push({ t, inside: q.inside, floor: +q.floor.toFixed(2), ceil: +q.ceil.toFixed(2), y: +p.y.toFixed(2) });
    }
    const q0 = queryVolume(player.volume, eye.x, eye.y, eye.z, 0.3, 0);
    return { camDist: +camDist.toFixed(2), fp: game.viewFP, eyeY: +eye.y.toFixed(2), eyeQ: { inside: q0.inside, floor: +q0.floor.toFixed(2), ceil: +q0.ceil.toFixed(2) }, pitch: +player.pitch.toFixed(2), samples };
  },
  freezeMonster: (v = true) => { if (game.monster) game.monster.frozen = !!v; },
  faceMonster: () => { const m = game.monster; if (!m) return; const f = feetPos(); m.yaw = Math.atan2(-(f.x - m.pos.x), -(f.z - m.pos.z)); m.screamT = 0.5; },
  spearDir: () => {
    const THREEv = caveman.tipWorld().clone();
    const g = new THREE.Vector3(); caveman.armR.grip.getWorldPosition(g);
    const t = new THREE.Vector3(); caveman.torchPos && t.copy(caveman.torchPos);
    const h = new THREE.Vector3(); caveman.armL.grip.getWorldPosition(h);
    const d = THREEv.sub(g).normalize();
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    return { spearDotFwd: +d.dot(fwd).toFixed(2), spearY: +d.y.toFixed(2), torchAboveHand: +(t.y - h.y).toFixed(2) };
  },
  setView: (fp) => setView(fp),
  setGod: (v) => { game.god = !!v; },
  setNoise: (v) => { game.noiseOverride = v; },
  /** Fast deterministic simulation of the game rules (no rendering). */
  sim: (seconds, opts = {}) => {
    const dt = opts.dt || 1 / 30;
    const n = Math.round(seconds / dt);
    let minDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (!game.dead) player.update(dt);
      if (opts.faceMonster && game.monster) {
        const mm = game.monster, f = feetPos();
        player.yaw = Math.atan2(-(mm.pos.x - f.x), -(mm.pos.z - f.z));
        player.applyLook();
      }
      if (opts.attackEvery && i % Math.round(opts.attackEvery / dt) === 0) attack();
      stepGame(dt);
      if (game.monster) minDist = Math.min(minDist, game.monster.distToPlayer ?? Infinity);
      if (opts.until && opts.until()) break;
    }
    return { t: +game.time.toFixed(1), minDist: +minDist.toFixed(2), health: game.health, dead: game.dead, tally: { ...tally }, monster: game.monster ? game.monster.state : null };
  },
  gameLog: () => game.log.slice(-30),
  explored: () => explored.size,
  /** Bots shove into walls from many stations; counts frames whose move crossed a visible wall. */
  wallPoke: (n = 40, frames = 150, seed = 1) => {
    let rs = seed; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const P = player, cam = P.camera, sts = cave.stations.filter((s) => s.kind !== "entrance");
    let crossings = 0, steps = 0, rescues0 = P.rescues || 0; const where = [];
    for (let k = 0; k < n; k++) {
      const s0 = sts[Math.floor(rnd() * sts.length)], p0 = stationWorld(s0);
      P.setStance("stand"); P.placeWorld(p0.x, p0.y - s0.down + STANCES.stand.eye, p0.z);
      if (STREAM && world.caveLayer) chunks.prime(streamCtx(), 25);
      wallMeshCache.t = -1;
      P.yaw = rnd() * Math.PI * 2;
      for (let f = 0; f < frames; f++) {
        if (f % 40 === 0) P.yaw += (rnd() - 0.5) * 2.5;
        if (P.blockedLow && P.stance !== "crawl") P.setStance(P.stance === "stand" ? "crouch" : "crawl");
        P.joy.active = true; P.joy.dx = 0; P.joy.dy = -1; P.joy.mag = 1;
        const a = cam.position.clone(), st = STANCES[P.stance];
        P.update(1 / 60); steps++;
        const b = cam.position;
        if (walls.crosses(a, b, a.y - st.eye, st)) { crossings++; if (where.length < 6) where.push({ st: s0.id, x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1) }); }
      }
    }
    P.joy.active = false; P.joy.mag = 0;
    return { steps, crossings, where, rescues: (P.rescues || 0) - rescues0, wallHits: walls.hits, pushes: walls.pushes };
  },
  /** Main path + a path from the entrance to every dead end (for walking tests). */
  paths: () => {
    const nb = neighborsOf(cave), par = new Map([[cave.entranceId, null]]), q = [cave.entranceId];
    while (q.length) { const u = q.shift(); for (const v of nb.get(u) || []) if (!par.has(v)) { par.set(v, u); q.push(v); } }
    const leaves = cave.stations.filter((s) => (nb.get(s.id) || []).length === 1 && s.id !== cave.entranceId).map((s) => s.id);
    const branches = leaves.map((id) => { const p = []; for (let u = id; u != null; u = par.get(u)) p.unshift(u); return p; });
    return { main: mainPath.slice(), branches };
  },
  wallProbe: () => { const st = STANCES[player.stance]; const c = player.camera.position; const vq = queryVolume(player.volume, c.x, c.y, c.z, st.radius, 0); const fwd = queryVolume(player.volume, c.x - Math.sin(player.yaw) * 0.3, c.y, c.z - Math.cos(player.yaw) * 0.3, st.radius, 0);
    const sum = (q) => ({ inside: q.inside, floor: +q.floor.toFixed(2), ceil: +q.ceil.toFixed(2), cont: q.containing.map((k) => k.type === "hub" ? `hub ${k.s.id} f${k.floor.toFixed(2)} c${k.ceil.toFixed(2)}` : `seg f${k.floor.toFixed(2)} c${k.ceil.toFixed(2)} t${k.t.toFixed(2)}`) });
    return { here: sum(vq), fwd: sum(fwd), yaw: +player.yaw.toFixed(2), blockedLow: player.blockedLow, ahead: player.ahead, pos: [c.x, c.y, c.z].map((v) => +v.toFixed(2)), stance: player.stance, feet: +(c.y - st.eye).toFixed(2), ground: player.groundEye, hits: walls.probe(c, c.y - st.eye, st) }; },
  moveProbe: (d = 0.05) => {
    const P = player, st = STANCES[P.stance], from = P.camera.position.clone();
    const to = from.clone().add(new THREE.Vector3(-Math.sin(P.yaw) * d, 0, -Math.cos(P.yaw) * d));
    const r = P._constrain(to, from, st.radius, st);
    return { from: [from.x, from.y, from.z].map((v) => +v.toFixed(2)), to: [r.x, r.z].map((v) => +v.toFixed(3)), moved: +Math.hypot(r.x - from.x, r.z - from.z).toFixed(3), floorEye: +(r._floor + r._eye).toFixed(2), groundEye: +(P.groundEye ?? 0).toFixed(2), inside: r._inside, blockedLow: r._blockedLow, need: r._needStance };
  },
  debugAmbient: (v) => { ambient.color.set(0xffffff); ambient.intensity = v; scene.fog.density = 0.004; game.fogLock = true; },
  hallCenter: (id) => { const s = stationMap(cave).get(id); const p = stationWorld(s); return { x: p.x, y: p.y, z: p.z, floor: p.y - s.down, R: Math.max(s.left, s.right) }; },
  halls: () => { const nb = neighborsOf(cave); return cave.stations.filter((s) => s.kind === "cavern").map((s) => ({ id: s.id, w: +(s.left + s.right).toFixed(1), h: +(s.up + s.down).toFixed(1), nb: nb.get(s.id) })); },
  fauna: () => caveFauna?.stats() || null,
  water: () => waterHandle && { path: waterHandle.path?.length || 0, snapped: waterHandle.path?.filter((q) => q.snapped).length || 0, pool: waterHandle.features.pool, first: waterHandle.path?.[Math.floor((waterHandle.path?.length || 0) / 2)], ids: cave?.water?.stationIds },
  faunaObj: () => caveFauna,
  setWalls: (on) => { player.walls = on ? walls : null; },
  walkRoute: (ids, opts = {}) => {
    const dt = opts.dt || 1 / 60, mag = opts.mag ?? 0.8, lateral = opts.lateral || 0;
    const smap = stationMap(cave);
    const pts = ids.map((id) => { const s = smap.get(id); const p = stationWorld(s); return { id, x: p.x, z: p.z }; });
    const P = player, cam = P.camera;
    const s0 = smap.get(ids[0]); const p0 = stationWorld(s0);
    if (!opts.noTeleport) { P.setStance("stand"); P.placeWorld(p0.x, p0.y - s0.down + STANCES.stand.eye, p0.z); }
    if (opts.stream && STREAM) chunks.prime(streamCtx(), 25); // teleport: load like a spawn
    const r0 = P.rescues || 0;
    let frames = 0, stuck = 0, maxStuckRun = 0, run = 0, maxUp = 0, maxDown = 0, maxAbove = 0, maxBelow = 0, airFrames = 0, dist = 0, speedSum = 0;
    const stuckAt = [], reached = []; let downAt = null; let streamMiss = 0, maxLoaded = 0;
    let prevY = cam.position.y;
    for (let w = 1; w < pts.length; w++) {
      const a = pts[w - 1], b = pts[w];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const tx = b.x + nx * lateral, tz = b.z + nz * lateral;
      let ok = false;
      for (let i = 0; i < (20 + L / 0.3) / dt; i++) {
        const px = cam.position.x, pz = cam.position.z;
        const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz);
        if (d < (opts.reach || 2.0)) { ok = true; break; }
        P.yaw = Math.atan2(-dx / d, -dz / d);
        // Blocked (e.g. a stalagmite in the line): sidestep like a player would.
        if (run > 12) P.yaw += (Math.floor(frames / 45) % 2 ? 1.1 : -1.1);
        P.joy.active = true; P.joy.dx = 0; P.joy.dy = -1; P.joy.mag = mag;
        if (opts.autoStance) {
          const rk = { stand: 0, crouch: 1, crawl: 2 }, need = P.ahead || "stand";
          if (rk[need] > rk[P.stance] || P.blockedLow) P.setStance(P.blockedLow && need === P.stance ? (P.stance === "stand" ? "crouch" : "crawl") : need);
          else if (rk[need] < rk[P.stance] && frames % 20 === 0) P.setStance(need);
        }
        const y0 = cam.position.y - (P.bobY || 0);
        P.update(dt);
        frames++;
        if (opts.stream && world.caveLayer) {
          chunks.update(streamCtx());
          // The segment you stand in must be built (visuals present) every frame.
          const { leg } = world.caveLayer._passageDistances(cam.position);
          if (leg && !chunks.isLoaded("cave", world.caveLayer.cellKey(leg.x, leg.y, leg.z))) streamMiss++;
          const n = chunks.summary().loaded; if (n > maxLoaded) maxLoaded = n;
        }
        const y1 = cam.position.y - (P.bobY || 0);
        const moved = Math.hypot(cam.position.x - px, cam.position.z - pz);
        dist += moved; speedSum += moved / dt;
        const dy = y1 - y0;
        maxUp = Math.max(maxUp, dy); if (dy < maxDown) { maxDown = dy; downAt = { near: b.id, x: +px.toFixed(1), z: +pz.toFixed(1), y: +y0.toFixed(2), moved: +moved.toFixed(3) }; }
        const g = P.groundEye ?? y1;
        maxAbove = Math.max(maxAbove, y1 - g); maxBelow = Math.min(maxBelow, y1 - g);
        if (P.grounded === false) airFrames++;
        if (frames > 20 && moved < P.speedNow * dt * 0.25) { stuck++; run++; if (run === 10) stuckAt.push({ near: b.id, x: +px.toFixed(1), z: +pz.toFixed(1) }); } else run = 0;
        maxStuckRun = Math.max(maxStuckRun, run);
      }
      reached.push(b.id + (ok ? "" : "(FAIL)"));
      if (!ok) break;
    }
    P.joy.active = false; P.joy.mag = 0;
    const r = (v) => +v.toFixed(3);
    return { frames, dist: r(dist), avgSpeed: r(speedSum / Math.max(1, frames)), maxUpPerFrame: r(maxUp), maxDownPerFrame: r(maxDown), downAt, maxAboveGround: r(maxAbove), maxBelowGround: r(maxBelow), airFrames, stuckFrames: stuck, maxStuckRun, stuckAt: stuckAt.slice(0, 8), rescues: (P.rescues || 0) - r0, reached: reached.join(" "), ...(opts.stream ? { streamMiss, maxLoaded } : {}) };
  },
  joySpeedTable: () => [0, 0.1, 0.2, 0.4, 0.6, 0.85, 0.95, 1.05, 1.2].map((m) => [m, +Player.joySpeed(m, STANCES.stand).toFixed(2), +Player.joySpeed(m, STANCES.crouch).toFixed(2), +Player.joySpeed(m, STANCES.crawl).toFixed(2)]),
  bakeStats: (id) => { const s = stationMap(cave).get(id); const p = stationWorld(s); const m = caveGroup.getObjectByName("passages"); const pa = m.geometry.attributes.position, b = m.geometry.attributes.aBake; let n = 0, sum = 0, mx = 0, hi = 0; for (let i = 0; i < pa.count; i++) { const dx = pa.getX(i) - p.x, dz = pa.getZ(i) - p.z; if (Math.hypot(dx, dz) < 60 && pa.getY(i) > p.y + 15) { n++; sum += b.getX(i); mx = Math.max(mx, b.getX(i)); hi = Math.max(hi, pa.getY(i) - p.y); } } return { n, avg: sum / Math.max(1, n), mx, hi }; },
  triBreakdown: () => { const out = {}; caveGroup?.traverse((o) => { if (!o.geometry) return; const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); const k = o.name || o.type; out[k] = (out[k] || 0) + Math.round(t); }); return out; },
  hasMesh: () => {
    let tris = 0;
    caveGroup?.traverse((o) => {
      if (o.isInstancedMesh) tris += (o.geometry?.index ? o.geometry.index.count / 3 : 0) * o.count;
      else if (o.geometry?.index) tris += o.geometry.index.count / 3;
      else if (o.geometry?.attributes?.position) tris += o.geometry.attributes.position.count / 3;
    });
    return tris;
  },
};

const params = new URLSearchParams(location.search);
if (params.get("debugside") === "1") { material.side = THREE.DoubleSide; material.needsUpdate = true; }
if (params.get("debugside") === "2") { material.side = THREE.BackSide; material.needsUpdate = true; }
const startSeed = params.has("seed") ? parseSeed(params.get("seed")) : 1847265319;
// Default start: outside, in the hills. ?seed=, ?cave=carlsbad (and test ?shot=) start in a cave.
const directCave = params.has("seed") || params.has("cave") || params.has("shot") || params.get("start") === "cave" || params.get("demo") === "1";
if (directCave) {
  newCave(startSeed);
  if (params.get("cave") === "carlsbad") loadCarlsbad();
} else {
  // Default: main menu (Continue / New Game / Free Play) over the dawn camp. ?play=new|free|continue skips it.
  const play = params.get("play");
  if (play === "new") startNewGame();
  else if (play === "free") startFreePlay();
  else if (play === "continue" && readSave()) continueGame();
  else {
    ensureWorld();
    world.atmo.setTime(6.15);
    story.active = false;
    enterOverworld(null, { at: world.camp ? campSpawn() : undefined });
    storyUI.setStoryVisible(false);
    showMainMenu();
  }
}

const shot = params.get("shot");
if (shot === "mid" || params.get("demo") === "1") player.placeAlongMainPath(0.42, mainPath);
if (shot === "exit") player.placeAlongMainPath(0.92, mainPath);
if (shot === "entrance") player.spawnAtEntrance();
if (shot === "waterfall" || shot === "pool" || shot === "stream" || shot === "formations" || shot === "cavern" || shot === "crawl" || shot === "junction" || shot === "fallclose") {
  lookAtFeature(shot);
}

requestAnimationFrame(tick);
