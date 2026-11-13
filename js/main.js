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
import { walkCave, meshProbe } from "./cave/cavetest.js";
import { REAL_CAVES, REAL_IDS, realCaveFor, buildRealCave, loadLayout, layoutSync, preloadLayouts, realFromSeed } from "./cave/realcaves.js";
import { CaveFauna } from "./cavefauna.js";
import { Archery } from "./archery.js";
import { CaveAudio } from "./audio.js";
import { Caveman } from "./caveman.js";
import { Monster } from "./monster.js";
import { MonsterVoice } from "./monster-voice.js";
import { pointInside, PLAYER_RADIUS, STANCES, canFitStance, requiredStanceAt, queryVolume } from "./volume.js";
import { ChunkManager } from "./world/chunk-manager.js";
import { CaveStreamLayer } from "./world/cave-stream.js";
import { Terrain, colCore } from "./world/terrain.js";
import { OverworldLayer } from "./world/overworld.js";
import { Atmosphere, WEATHERS } from "./world/atmosphere.js";
import { Camp } from "./act1/camp.js";
import { Wildlife } from "./act1/animals.js";
import { SettlementLayer, SETTLE_KIND, indoorAt } from "./world/settlements.js";
import { People } from "./world/people.js";
import { Story } from "./act1/story.js";
import { StoryUI } from "./act1/ui.js";
import { gfxQuality, setGfxQuality } from "./realism.js";
import { readSave, clearSave, ITEMS } from "./act1/survival.js";
import { planPlaces, makeNPC, NPCS } from "./act1/quests.js";
import { WorldMap } from "./worldmap.js";
import { mapFilters, toggleFilters } from "./mapfilters.js";
import { Boats } from "./world/boats.js";
import { Colony, AGES as COL_AGES, INSIGHTS } from "./world/colony.js"; // round 20
import { SpiritVision } from "./act1/spirit.js"; // round 23
import { VISIONS, echo as visionEcho } from "./act1/spirit-texts.js";
import { TownTalk } from "./act1/talk.js";
import { ColonyUI } from "./act1/colony-ui.js";
import { Trip, MELT } from "./trip.js"; // round 21
const trip_MELT = () => MELT.value.x;
import { Visions } from "./world/visions.js";
import { TripMusic } from "./tripmusic.js";
import { Shrooms } from "./world/shrooms.js";
import { WildBerries, BERRY_KINDS } from "./world/berries.js";
import { Multiplayer } from "./mp/mp.js"; // round 22
import { AudioPanel } from "./audio-ui.js"; // round 23
import { Beacon } from "./beacon.js"; // round 23
import { Cutscene } from "./cine/cutscene.js"; // round 24
import { Tutorial, CHAPTERS } from "./tutorial.js";
import { ControlsSheet, currentDevice } from "./controls.js";
import { Finder, fmt as findFmt } from "./find.js"; // round 24b
import { Overlays } from "./overlays.js"; // round 24c
import { Fighters, markHostile, HORN_CD } from "./act1/fighters.js"; // round 24b
import { INTRO, MEMORIES, AGE_LINES, fillMemory } from "./cine/scripts.js";

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
// Round 24: robust start. Try the WebGL renderer with fewer demands each time (some desktop drivers
// refuse antialias / high-performance), and if High graphics breaks (shader error, a crash in the first
// frames, the world failing to build), switch to Low once and reload. The boot-check in index.html shows
// any error that still gets through.
function makeRenderer() {
  const tries = [{ antialias: !IS_TOUCH, powerPreference: "high-performance" }, { antialias: false, powerPreference: "default" }, { antialias: false, powerPreference: "low-power", precision: "mediump" }];
  let last = null;
  for (const o of tries) { try { return new THREE.WebGLRenderer({ canvas, ...o }); } catch (e) { last = e; console.warn("WebGL renderer failed with", o, e); } }
  throw last || new Error("WebGL is not available");
}
function gfxFallback(why) {
  if (gfxQuality() !== "high") return false;
  try { if (sessionStorage.getItem("fota-gfx-fb")) return false; sessionStorage.setItem("fota-gfx-fb", String(why).slice(0, 120)); } catch { return false; }
  console.warn("Graphics: High failed (" + why + "), switching to Low");
  setGfxQuality("low"); setTimeout(() => location.reload(), 50); return true;
}
const renderer = makeRenderer();
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (sh) => (gl.getShaderInfoLog(sh) || "").trim();
  console.error("Shader error:", log(vs) || log(fs) || gl.getProgramInfoLog(program));
  gfxFallback("shader error");
};
let glLost = false;
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault(); glLost = true; console.warn("WebGL context lost");
  try { storyUI?.toast("The graphics driver reset. Restoring…", "bad"); } catch {}
}, false);
canvas.addEventListener("webglcontextrestored", () => {
  glLost = false; console.warn("WebGL context restored");
  try { storyUI?.toast("Graphics restored."); } catch {}
}, false);
// Phones: cap the pixel ratio (fill rate is the main cost of the rock shader), then adapt.
// Round 14: Graphics quality. Low (phone default) caps the pixel ratio lower and skips surface relief.
let DPR_CAP = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? (gfxQuality() === "high" ? 1.75 : 1.3) : 2);
let dprNow = DPR_CAP;
renderer.setPixelRatio(dprNow);
renderer.setClearColor(0x050308, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const EXPOSURE = 1.2; // caves and menus; the overworld eases this with the time of day (round 26)
renderer.toneMappingExposure = EXPOSURE;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050308, 0.03);
scene.background = new THREE.Color(0x050308);

// `camera` is the player's eye (logic only: collision, look, audio). The scene is rendered
// through `viewCam`: an over-the-shoulder chase camera, or the eye itself in first person.
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 220);
const viewCam = new THREE.PerspectiveCamera(70, 1, 0.06, 160);
scene.add(camera);
scene.add(viewCam);
// Round 10: soft spill from the torch around the chase camera. Rock that faces the camera but
// away from the torch (rims, junction lips, passage necks) otherwise renders pitch black and reads
// as a hole / black shard. Short range, cave only (intensity set in setCaveLighting / overworld).
const camFill = new THREE.PointLight(0xffa868, 0, 8, 1.0);
viewCam.add(camFill);
// No electric light, no headlamp: only the torch. A near-black floor so silhouettes barely read.
const ambient = new THREE.AmbientLight(0x0d0b10, 0.5);
scene.add(ambient);
const caveman = new Caveman(scene);
caveman.baseIntensity = 26;
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
// Round 27: torch bounce under high ceilings. A torch-lit floor throws a little warm light back up,
// so a 15-25 m hall roof reads as faint rock instead of pitch black. Always in the scene (0 when
// unused) so the light count never changes; follows the torch's flicker, so caves stay torch-lit.
const ceilBounce = new THREE.PointLight(0xffb27a, 0, 30, 1.25);
scene.add(ceilBounce);

const URLP = new URLSearchParams(location.search);
// Round 24: the tutorial plays in its own sandbox. Before it starts, the few shared keys it can touch are
// copied aside; leaving (or the next normal launch, if the tab was closed mid-tutorial) puts them back.
const TUT_SNAP = "fota-tut-snapshot-v1", TUT_KEYS = ["flesh.save.v1", "fota-talk-v1", "fota-berry-taken-v1", "fota-shroom-seen-v1", "fota-shroom-taken-v1", "cavern.kills", "cavern.deaths", "fota-mapfilters-v1"];
function tutSnapshot() { try { const o = {}; for (const k of TUT_KEYS) o[k] = localStorage.getItem(k); localStorage.setItem(TUT_SNAP, JSON.stringify(o)); } catch {} }
function tutRestore() {
  try {
    const raw = localStorage.getItem(TUT_SNAP); if (!raw) return false;
    const o = JSON.parse(raw); for (const k of TUT_KEYS) { if (o[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, o[k]); }
    for (const k of Object.keys(localStorage)) if (/-tut-\d+$/.test(k)) localStorage.removeItem(k);
    localStorage.removeItem(TUT_SNAP); return true;
  } catch { return false; }
}
if (URLP.get("play") !== "tutorial") tutRestore();
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
/** Round 25e: One-finger steering (phones; on by default, ☰ → Controls to switch). */
function oneFingerOn() { try { return localStorage.getItem("fota-onefinger") !== "0"; } catch { return true; } }
function setOneFinger(v) {
  try { localStorage.setItem("fota-onefinger", v ? "1" : "0"); } catch {}
  if (player) { player.oneFinger = IS_TOUCH && !!v; if (!v && player.camOff) { player.yaw += player.camOff; player.camOff = 0; player.applyLook(); } }
  storyUI?.toast?.(v ? "👆 One-finger steering on: left / right on the stick turns Kra." : "✌️ Two-finger mode: the stick moves, drag on the right to turn.");
}

let cave = null;
let caveGroup = null;
let waterHandle = null;
let caveFauna = null;
let archery = new Archery(scene);
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
const FOG_DENSITY = 0.032; // round 9: was 0.058 (torch reach was fog-limited)
const TORCH_BASE = 26; // round 9: was 14 with decay 1.5; now decay 1.0 -> ~5x at 8 m, ~7x at 16 m, only ~1.9x at arm length
const TORCH_REACH = 45; // m (was 24.5)
// Cave background: only ever seen through a seam/hole in the rock mesh; dark rock-brown instead
// of black so any remaining sliver reads as shadowed rock rather than a void.
const CAVE_BG = 0x0d0907; // round 11: darker, so a distant gap reads like fogged rock (fog is black)
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
  archery?.clear();
  if (game.monster) { game.monster.dispose(); game.monster = null; }
}

function setCaveLighting() {
  moonLight.intensity = 0;
  skyFill.intensity = 0;
  ambient.intensity = 0.5;
  ambient.color.set(0x0d0b10);
  caveman.baseIntensity = TORCH_BASE;
  camFill.intensity = 6;
  if (world.camp) world.camp.fireLight.intensity = 0;
  if (world.wildlife) world.wildlife.setVisible(false);
  if (world.settleRoot) world.settleRoot.visible = false;
  compassEl?.classList.add("hidden");
  storyUI.setClock("Underground");
  scene.fog.color.set(0x000000);
  scene.background.set(CAVE_BG);
  renderer.toneMappingExposure = EXPOSURE;
  renderer.setClearColor(CAVE_BG, 1);
  viewCam.near = 0.06; viewCam.far = 160; viewCam.updateProjectionMatrix();
  audio.setOutdoor?.(false);
}

function leaveOverworld() {
  archery?.clear();
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
  scene.background.set(CAVE_BG);
  renderer.toneMappingExposure = EXPOSURE;
  renderer.setClearColor(CAVE_BG, 1);
  camera.updateProjectionMatrix();
  labeled = cave.stations.filter((st) => st.label);
  world.mouth = caveMouthPlane(cave);
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
  story.onCaveLoaded(cave.kind, fromEntrance ? "e" + fromEntrance.id : "s" + (cave.seed ?? cave.name ?? "x"));
  ready = true;
  window.__CAVE__.ready = true;
  window.__CAVE__.seed = cave.seed;
  window.__CAVE__.mode = "cave";
  window.__CAVE__.info = {
    name: cave.name,
    real: cave.real ? cave.real.id : null,
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
const formMeshCache = { t: -1e9, list: [] };
function caveFormMeshes() {
  const now = performance.now();
  if (now - formMeshCache.t < 500) return formMeshCache.list;
  const list = [];
  for (const r of [world.caveLayer?.root, caveGroup].filter(Boolean)) r.traverse((o) => { if (o.isInstancedMesh && o.userData.formation && o.visible && o.count > 0) { if (!o.boundingSphere) o.computeBoundingSphere(); list.push(o); } });
  formMeshCache.t = now; formMeshCache.list = list;
  return list;
}
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

let savedPace = 1, paceEl = null, paceT = 0;
/** Round 17: small HUD readout when the desktop pace changes (1/2/3 or the mouse wheel). */
function showPace(pc) {
  if (!paceEl) { paceEl = document.createElement("div"); paceEl.className = "pace-hud"; gameEl.appendChild(paceEl); }
  paceEl.textContent = ["", "🚶 Walk", "🏃 Jog", "💨 Run"][pc] + "  ·  pace " + pc + "/3  (Shift = run)";
  paceEl.classList.remove("fade");
  clearTimeout(paceT); paceT = setTimeout(() => paceEl.classList.add("fade"), 1600);
}
window.addEventListener("gamepadconnected", () => { try { storyUI.toast("🎮 Gamepad: left stick moves (push further = faster), right stick looks."); } catch {} });
function ensurePlayer(c) {
  player = new Player(camera, c, canvas);
  player.oneFinger = IS_TOUCH && oneFingerOn(); // round 25e
  player.walls = walls;
  player.onStep = (amp, stance) => (player.mounted ? audio.hoof?.(Math.min(1, (player.speedNow || 0) / 12)) : audio.step(amp, stance));
  player.onExit = () => {
    // Linked cave (entered from the hills): the far exit brings you back outside.
    if (world.entrance) { returnToOverworld(); return; }
    foundEl.classList.remove("hidden");
    hintEl.classList.add("hidden");
  };
  player.onStance = syncStance;
  player.pace = savedPace; // round 17: desktop walk / jog / run pace
  player.onPace = (pc) => { savedPace = pc; showPace(pc); };
  player.onLand = (amp) => (player.mounted ? audio.hoof?.(Math.max(0.7, amp)) : audio.step(Math.max(0.6, amp), "stand"));
  const knob = document.getElementById("joy-knob");
  const joy = document.getElementById("joystick");
  if (joy && knob) player.attachJoystick(joy, knob);
}

let carlsbadData = null;
async function loadCarlsbad(opts = {}) {
  try {
    if (!carlsbadData) carlsbadData = await (await fetch("data/carlsbad.json")).json();
    const c = parseJSONSurvey(carlsbadData);
    const M = REAL_CAVES.carlsbad;
    c.real = { id: "carlsbad", name: M.name, full: M.full, credit: M.credit };
    loadCave(c, opts);
    if (!opts.fromEntrance) history.replaceState(null, "", "?cave=carlsbad");
  } catch (err) {
    errors.push("carlsbad: " + err);
  }
}

// Round 27: every cave is a real cave (data/real-caves, assembled by js/cave/modules.js).
preloadLayouts();
function realCave(id, seed, opts = {}) {
  const L = layoutSync(id);
  if (!L) return null;
  const c = buildRealCave(L, id, seed >>> 0, opts);
  if (opts.name) c.name = opts.name;
  return c;
}
async function loadRealCave(id, seed, opts = {}) {
  if (id === "carlsbad") return loadCarlsbad(opts);
  try {
    await loadLayout(id);
    const c = realCave(id, seed, opts);
    loadCave(c, opts);
    if (!opts.fromEntrance) history.replaceState(null, "", `?cave=${id}&seed=${seed >>> 0}`);
    return c;
  } catch (err) { errors.push("real cave " + id + ": " + err); return null; }
}
function announceReal() {
  const r = cave?.real;
  if (!r) return;
  try { storyUI.toast(`Inspired by ${r.name}`); } catch {}
  const sub = document.getElementById("cave-real");
  if (sub) { sub.textContent = `Inspired by ${r.full}`; sub.classList.remove("hidden"); }
}
function storyCaveId() { return world.places?.cave?.id ?? null; }

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
  // Round 12: settlements + their people (one group so caves can hide them in one go)
  world.settleRoot = new THREE.Group(); world.settleRoot.name = "settlements";
  scene.add(world.settleRoot);
  world.settle = new SettlementLayer(world.terrain, world.settleRoot, { lite: IS_TOUCH });
  world.people = new People(world.terrain, world.settleRoot, { lite: IS_TOUCH });
  world.boats = new Boats(world.terrain, world.settleRoot, { lite: IS_TOUCH }); // round 19
  world.settle.onBuild = (s) => world.people.spawnFor(s);
  world.settle.onDrop = (s) => world.people.despawnFor(s);
  // Round 20: Kra's own settlements, townsfolk who talk and remember him
  const pack = () => story.active || story.sandbox;
  world.colony = new Colony({ terrain: world.terrain, parent: world.settleRoot, people: world.people, toast: (m, k) => storyUI.toast(m, k),
    skills: () => (pack() ? story.surv.skills : new Set()), key: () => `fota-colony-v1-${story.tutorial ? "tut" : story.sandbox ? (mpActive ? "mp" : "free") : "story"}-${seed}` }); // round 22: multiplayer keeps its own
  world.talk = new TownTalk({ ui: storyUI, voice: storyUI.voice, surv: () => (pack() ? story.surv : null), terrain: () => world.terrain, atmo: () => world.atmo,
    people: () => world.people, colony: () => world.colony, story: () => story.active, wildlife: () => world.wildlife, discovered: () => world.discovered,
    kills: () => { const st = story.surv.stats; return (st.small || 0) + (st.deer || 0); }, questsDone: () => (story.active ? story.quests.completed().length : 0), time: () => game.time,
    markHint: (x, z, label) => { game.hint = { x, z, label, text: label, mode: "overworld", until: game.time + 40 }; compassKey = ""; } });
  // Round 24b: hostile towns that fight back, loot, Call to Arms; predators that bite
  markHostile(world.terrain.settlements || [], world.terrain.act1?.camp || { x: 0, z: 0 });
  world.fighters = new Fighters({ scene: world.settleRoot, terrain: () => world.terrain, people: () => world.people, towns: () => world.terrain.settlements || [],
    colonies: () => world.colony?.list || [], feet: () => (world.mode === "overworld" && player && ready ? feetPos() : null), safe: () => fightSafe(),
    hurt: (n, src) => damagePlayer(n, src), toast: (m, k) => storyUI.toast(m, k), log: (e) => glog(e), sound: (k, pos) => audio.fight?.(k, pos), lite: IS_TOUCH,
    key: () => `fota-fallen-v1-${story.tutorial ? "tut" : story.sandbox ? (mpActive ? "mp" : "free") : "story"}-${seed}` });
  world.people.skip = (k) => world.talk.joined(k) || world.fighters.isFallen(k);
  Object.defineProperty(world.wildlife, "noPredators", { get: () => story.tutorial || URLP.has("nopred") });
  world.wildlife.onBite = (a, dmg) => { if (damagePlayer(dmg, a.kind)) storyUI.toast(a.kind === "bear" ? "🐻 The bear mauls you!" : a.kind === "boar" ? "🐗 The boar gores you!" : `🐺 The ${a.kind} bites you!`, "bad"); };
  world.wildlife.onStalk = (a) => { if (game.time - (game.stalkToast || -99) > 25) { game.stalkToast = game.time; storyUI.toast(a.kind === "bear" ? "🐻 A bear has your scent. Back off, or stand and fight." : "🐺 Wolves are stalking you. Keep moving, or face them with your spear.", "bad"); } };
  world.shrooms = new Shrooms(world.terrain, world.settleRoot); // round 21
  world.berries = new WildBerries(world.terrain, world.settleRoot); // round 23
  colonyUI = new ColonyUI({ root: gameEl, stanceBar: document.getElementById("stance-bar"), colony: world.colony, feet: () => feetPos(), yaw: () => player.yaw,
    surv: () => (pack() ? story.surv : null), toast: (m, k) => storyUI.toast(m, k), debug: URLP.has("debug") || URLP.has("play"),
    mode: () => world.mode, busy: () => world.mode !== "overworld" || !!game.boat || !!player?.mounted || !!storyUI.modal || game.dead,
    unlocked: () => colonyLock(), onChange: () => {} });
  syncColony();
  // Round 16: the named people who give quests (one small mesh each, near their fire)
  world.places = planPlaces(world.terrain);
  world.npcs = {};
  if (world.places) for (const [id, n] of Object.entries(world.places.npc)) {
    const g = makeNPC(n.look); g.name = "npc-" + id;
    g.position.set(n.x, world.terrain.height(n.x, n.z), n.z); g.rotation.y = n.yaw; g.visible = false;
    world.settleRoot.add(g); world.npcs[id] = g;
  }
}

let colonyUI = null;
// ---------------- Round 21: glowing mushrooms + the trip ----------------
let calmOn = localStorage.getItem("fota-calm") === "1";
const trip = new Trip({ renderer, scene, lite: () => gfxQuality() !== "high", calm: () => calmOn, skip: () => [caveman.root, visions.group, world.shrooms?.group] });
const visions = new Visions({ scene, ground: (x, z) => (world.terrain ? world.terrain.height(x, z) : 0), lite: () => IS_TOUCH || gfxQuality() !== "high" });
const tripMusic = new TripMusic(audio);
const calmBtn = document.createElement("button");
calmBtn.id = "calm-btn"; calmBtn.type = "button"; calmBtn.title = "Tone down flashing and colour cycling (mushroom visions)";
const syncCalm = () => { calmBtn.textContent = "Calm visuals: " + (calmOn ? "on" : "off"); };
function setCalm(v) { calmOn = !!v; localStorage.setItem("fota-calm", calmOn ? "1" : "0"); syncCalm(); }
syncCalm();
document.getElementById("gfx-btn")?.after(calmBtn);
calmBtn.addEventListener("click", (e) => { e.stopPropagation(); setCalm(!calmOn); });
calmBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
const tripBtn = document.createElement("button");
tripBtn.id = "trip-btn"; tripBtn.type = "button"; tripBtn.className = "hidden"; tripBtn.textContent = "🍄 End vision";
tripBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
tripBtn.addEventListener("click", (e) => { e.stopPropagation(); endTrip(); });
document.getElementById("game").appendChild(tripBtn);
function eatShroom() {
  if (!story.surv.count("shroom")) return;
  if (trip.on) { storyUI.toast("The vision is already on you."); return; }
  const go = (calm) => {
    if (calm) setCalm(true);
    localStorage.setItem("fota-flash-ok", "1");
    story.surv.remove("shroom", 1); storyUI.closePanel(); startTrip();
  };
  if (!localStorage.getItem("fota-flash-ok")) {
    storyUI.ask("⚠ Flashing lights", "This starts a 3–4 minute vision with strong colour cycling, flashing and kaleidoscope effects. If flashing lights bother you, pick calm visuals (also in ☰ → Calm visuals). You can end it at any time: 🍄 End vision, or in the Pack.",
      [{ id: "go", label: "Eat it" }, { id: "calm", label: "Eat it with calm visuals" }], (id) => go(id === "calm"), true);
  } else go(false);
}
function startTrip() {
  trip.start(); visions.clear();
  if (audio.ctx) tripMusic.start();
  audio.duckMusic(true);
  storyUI.toast("It tastes of earth and copper. The ground begins to breathe…", "skill");
  glog({ e: "trip", on: true });
}
// ---------------- Round 23: spirit visions + insights ----------------
let spirit = null, spiritCam = null, visionPending = 0;
const getSpirit = () => spirit || (spirit = new SpiritVision({ root: gameEl, voice: storyUI.voice, touch: IS_TOUCH }));
function visionContext() {
  const C = world.colony, s = story.surv, st = s.stats || {}, list = C?.list || [];
  const big = list.slice().sort((a, b) => b.vill.length - a.vill.length)[0], mem = Object.values(world.talk?.mem || {}), age = C ? C.maxAge() : 0;
  return { faces: s.faces || 0, glyphs: story.glyphs?.length || 0, kills: (st.small || 0) + (st.deer || 0), towns: list.length, biggest: big?.name || "", pop: list.reduce((a, c) => a + c.vill.length, 0),
    age, ageName: COL_AGES[age].name, helped: mem.filter((m) => (m.rel || 0) >= 1).length, joined: mem.filter((m) => m.joined).length };
}
function pickInsights(k) {
  const C = world.colony, age = C.maxAge(), unk = Object.keys(INSIGHTS).filter((i) => !C.knows(i));
  let pool = unk.filter((i) => INSIGHTS[i].age <= age).sort(() => Math.random() - 0.5);
  if (pool.length < k) pool = pool.concat(unk.filter((i) => INSIGHTS[i].age > age).sort((a, b) => INSIGHTS[a].age - INSIGHTS[b].age));
  return pool.slice(0, k);
}
function beginSpirit(lines, opts) {
  const S = getSpirit(); if (S.on) return false;
  storyUI.closePanel(); storyUI.closeChoice?.(); storyUI.visionOn = true;
  spiritCam = { yaw0: bestVisionAngle(), t: 0, fp: caveman.fp };
  gameEl.classList.add("spirit-on");
  S.run(lines, { ...opts, onDone: (sk) => { storyUI.visionOn = false; gameEl.classList.remove("spirit-on"); spiritCam = null; glog({ e: "vision", n: opts.n, skipped: sk }); opts.onDone?.(sk); } });
  return true;
}
/** Start the next vision (or replay journal entry n). */
function startVision(replay = null) {
  const C = world.colony; if (!C || getSpirit().on) return false;
  if (replay != null) { const e = C.know.journal.find((j) => j.n === replay); return e ? beginSpirit(e.lines, { n: e.n, title: e.title, replay: true }) : false; }
  const n = C.know.seen, V = VISIONS[n] || null, ctx = visionContext();
  const lines = V ? V.lines(ctx) : visionEcho(ctx, n);
  const title = V ? V.title : "An Echo";
  const choices = pickInsights(V?.choice ? 2 : 1).map((id) => ({ id, ...INSIGHTS[id] }));
  if (choices.length === 1) lines.push({ who: "Kra", text: choices[0].idea });
  const entry = { n: n + 1, id: V?.id || "echo", title, lines, ins: null, at: Date.now() };
  return beginSpirit(lines, { n: n + 1, title, choices, onPick: (id) => {
    if (!C.learn(id)) return;
    entry.ins = INSIGHTS[id].name; applyInsight(id);
    storyUI.toast(`💡 Insight: ${INSIGHTS[id].icon} ${INSIGHTS[id].name}${INSIGHTS[id].policy ? (C.know.policies.includes(id) ? " (policy, adopted)" : " (policy: adopt it in the Town panel)") : ""}`, "skill");
  }, onDone: () => { C.know.seen = n + 1; C.know.journal.push(entry); C.save(); if (colonyUI?.isOpen()) colonyUI.render(); } });
}
function applyInsight(id) { if (id === "scouting") scoutReveal(); }
function scoutReveal() {
  const C = world.colony; if (!C?.knows("scouting") || !world.terrain) return 0;
  let n = 0;
  for (const c of C.list) { n += wmap.revealAt(c.x, c.z, 400); for (const e of world.terrain.entrances) if (Math.hypot(e.x - c.x, e.z - c.z) < 400) world.discovered.add(e.id); }
  return n;
}
/** The camera direction (around Kra) with the clearest view: fewest trees / rocks along the pull-back. */
function bestVisionAngle() {
  if (!player || world.mode !== "overworld" || !world.terrain) return player?.yaw || 0;
  const f = feetPos(), T = world.terrain, near = T.collidersNear(f.x, f.z, 14);
  let best = player.yaw, bs = Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2; let s = 0;
    for (let r = 1.5; r <= 11; r += 0.75) for (const da of [-0.18, 0, 0.18]) {
      const x = f.x + Math.sin(a + da) * r, z = f.z + Math.cos(a + da) * r;
      for (const k of near) { const q = colCore(k, x, z); if (Math.hypot(q.x - x, q.z - z) < (q.t || k.r || 0.5) + 2.4) s += k.top != null ? 1 : 3; }
      if (T.height(x, z) > f.y + 0.6 + r * 0.35) s += 2; // a hill in the way
    }
    s += Math.abs(Math.atan2(Math.sin(a - player.yaw), Math.cos(a - player.yaw))) * 0.01; // prefer in front
    if (s < bs) { bs = s; best = a; }
  }
  return best;
}
function spiritTick(dt) {
  if (visionPending > 0 && (visionPending -= dt) <= 0) { if (game.dead || storyUI.modal || !player) visionPending = 1; else startVision(); }
  spirit?.update(dt);
  trip.dream += ((spirit?.on ? 1 : 0) - trip.dream) * Math.min(1, dt * 0.9); if (trip.dream < 0.003) trip.dream = 0;
  if (spiritCam && player) {
    const c = spiritCam; c.t += dt; const f = feetPos(), ow = world.mode === "overworld";
    const ang = c.yaw0 + 0.18 * Math.sin(c.t * 0.05), r = ow ? Math.min(10, 3.4 + c.t * 0.15) : 2.3, h = ow ? Math.min(4.5, 0.8 + c.t * 0.07) : 0.5; // slow pull-back and rise
    viewCam.position.set(f.x + Math.sin(ang) * r, f.y + 1.2 + h, f.z + Math.cos(ang) * r);
    if (ow) { const g = world.terrain.height(viewCam.position.x, viewCam.position.z); if (viewCam.position.y < g + 1.2) viewCam.position.y = g + 1.2; }
    viewCam.lookAt(f.x, f.y + 1.25 + (ow ? Math.min(1.2, c.t * 0.03) : 0), f.z);
  }
}
// ---------------- Round 24: cutscenes (the intro + "Memories") ----------------
let cine = null; // created in wireMemoriesUI (after the UI exists)
let cineCam = null, cineOpts = {};
const QIDS = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
const _spots = {};
/** Intro locations: the camp, a cave mouth, the western sea, the red canyons, the cold north. */
function introSpot(at) {
  const T = world.terrain, B = T.bio, site = world.camp?.site;
  if (_spots[at]) return _spots[at];
  let s = null;
  if (at === "camp" && world.camp) { const c = campSpawn(); s = { x: c.x, z: c.z, yaw: c.yaw, look: site.camp }; }
  else if (at === "cave") {
    const cx = site?.camp.x ?? 0, cz = site?.camp.z ?? 0;
    const e = T.entrances.filter((q) => !q.hollow).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0] || site?.caveEntrance;
    if (e) { const L = landingNear(e.x + e.fx * 16, e.z + e.fz * 16, 2) || { x: e.x + e.fx * 16, z: e.z + e.fz * 16 }; s = { ...L, look: { x: e.x, z: e.z } }; }
  } else if (at === "ocean" && B) {
    const z = site?.camp.z ?? 0, x = B.coastX(z) + 90, L = landingNear(x, z, 4); if (L) s = { ...L, look: { x: L.x - 400, z: L.z } };
  } else if ((at === "red" || at === "north") && B) {
    let best = null, bd = Infinity;
    for (let z = -3000; z <= 3000; z += 70) for (let x = -1600; x <= 1600; x += 90) {
      const w = B.weights(x, z); if (w.sea > 0.05) continue;
      if ((at === "red" ? w.red : w.alpine + w.tundra) < 0.75) continue;
      const d = Math.hypot(x, z); if (d < bd) { bd = d; best = { x, z }; }
    }
    if (best) { const L = landingNear(best.x, best.z, 3); if (L) s = { ...L, look: { x: L.x + 200, z: L.z + (at === "red" ? 120 : -120) } }; }
  }
  return (_spots[at] = s);
}
function cinePrepare(sc) {
  const ow = world.mode === "overworld" && world.terrain && player;
  if (cineOpts.teleport && sc.time != null) world.atmo.setTime(sc.time);
  let s = null;
  if (cineOpts.teleport && ow && sc.at && sc.at !== "here") s = introSpot(sc.at);
  caveman.root.visible = !cineOpts.teleport || !!sc.kra || !s || sc.at === "here";
  let far = 0;
  if (s) {
    far = Math.hypot(s.x - feetPos().x, s.z - feetPos().z);
    player.placeWorld(s.x, 0, s.z);
    if (s.yaw != null) player.yaw = s.yaw; else if (s.look) player.yaw = Math.atan2(-(s.look.x - s.x), -(s.look.z - s.z));
    player.applyLook?.();
  }
  cineCam = { f: player ? feetPos().clone() : viewCam.position.clone(), yaw: player?.yaw || 0, look: s?.look || null, a0: bestVisionAngle() };
  return new Promise((r) => setTimeout(r, !s ? 250 : far > 400 ? 2800 : 1400)); // let the terrain stream in
}
const _cv = new THREE.Vector3();
function cineCamUpdate(sc, t, dt, dur) {
  const c = cineCam; if (!c) return;
  const ow = world.mode === "overworld" && world.terrain, f = c.f;
  const u = dur ? Math.min(1, t / dur) : 0, e = u * u * (3 - 2 * u);
  const fa = c.look ? Math.atan2(c.look.x - f.x, c.look.z - f.z) : c.yaw + Math.PI; // the way Kra / the scene faces
  const dx = Math.sin(fa), dz = Math.cos(fa), sx = dz, sz = -dx;
  const G = (x, z) => (ow ? world.terrain.height(x, z) : f.y);
  let P, L;
  if (!ow) { const a = c.a0 + t * 0.08; P = [f.x + Math.sin(a) * 2.3, f.y + 1.7, f.z + Math.cos(a) * 2.3]; L = [f.x, f.y + 1.2, f.z]; }
  else if (sc.cam === "fly") {
    const k = -40 + 80 * e, x = f.x + dx * k + sx * 14, z = f.z + dz * k + sz * 14;
    const alt = sc.alt || 24; P = [x, Math.max(G(x, z), f.y) + alt + 10 * (1 - e), z]; const lx = x + dx * (45 + alt), lz = z + dz * (45 + alt); L = [lx, G(lx, lz) + 3, lz];
  } else if (sc.cam === "orbit") { const a = c.a0 + t * 0.09; P = [f.x + Math.sin(a) * 9, f.y + 3.4, f.z + Math.cos(a) * 9]; L = [f.x, f.y + 1.3, f.z]; }
  else if (sc.cam === "rise") { const a = c.a0, r = 3 + 12 * e; P = [f.x + Math.sin(a) * r, f.y + 0.9 + 9 * e, f.z + Math.cos(a) * r]; L = [f.x, f.y + 1.3, f.z]; }
  else if (sc.cam === "push") {
    const tg = c.look || { x: f.x + dx * 14, z: f.z + dz * 14 }, ty = G(tg.x, tg.z), d = 30 - 18 * e;
    const x = tg.x - dx * d + sx * 3, z = tg.z - dz * d + sz * 3; P = [x, Math.max(G(x, z), ty) + 3.5, z]; L = [tg.x, ty + 2.2, tg.z];
  } else { // "low": behind Kra's shoulder, looking past him at the sky
    P = [f.x - dx * (3.4 + e) + sx * 0.9, f.y + 1.15, f.z - dz * (3.4 + e) + sz * 0.9]; L = [f.x + dx * 25, f.y + 3.5, f.z + dz * 25];
  }
  if (ow) { const g = world.terrain.height(P[0], P[2]); if (P[1] < g + 1.2) P[1] = g + 1.2; const wl = world.terrain.waterLevel?.(P[0], P[2]); if (wl != null && P[1] < wl + 1) P[1] = wl + 1; }
  viewCam.position.set(P[0], P[1], P[2]); viewCam.up.set(0, 1, 0); viewCam.lookAt(_cv.set(L[0], L[1], L[2]));
}
/** Play a script (intro or a memory). opts.teleport: fly the player around (the intro), put him back after. */
function beginCine(script, opts = {}) {
  if (!cine || cine.on || !player) return false;
  if (document.pointerLockElement) document.exitPointerLock();
  armAudio(); storyUI.closePanel(); storyUI.closeChoice?.(); wmap.close?.();
  const canTp = !!opts.teleport && world.mode === "overworld" && !game.horse && !game.boat && !player.mounted && !travelling;
  const back = canTp ? { x: feetPos().x, z: feetPos().z, yaw: player.yaw, time: world.atmo.time } : null;
  cineOpts = { ...opts, teleport: canTp };
  storyUI.cineOn = true; gameEl.classList.add("cine-on"); cineCam = null;
  glog({ e: "cine", id: script.id });
  return cine.play(script, { prepare: cinePrepare, cam: cineCamUpdate, done: (sk) => {
    cineCam = null; storyUI.cineOn = false; gameEl.classList.remove("cine-on"); caveman.root.visible = true;
    if (back) { player.placeWorld(back.x, 0, back.z); player.yaw = back.yaw; player.applyLook?.(); if (back.time != null) world.atmo.setTime(back.time); }
    glog({ e: "cineEnd", id: script.id, skipped: sk }); opts.done?.(sk);
  } });
}
function playIntro(fromMenu = false) {
  if (fromMenu) storyUI.hideMenu();
  return beginCine(INTRO, { teleport: true, done: () => { try { localStorage.setItem("fota-firstrun-v1", "1"); } catch {} if (fromMenu) { world.atmo.setTime(6.15); showMainMenu(); } } });
}
// --- the memories store: once per save (story: cleared on New Game; free play / multiplayer: per world) ---
const memKey = () => (story.tutorial ? null : `fota-memories-v1-${story.active ? "story" : story.sandbox ? (mpActive ? "mp" : "free") : null}`);
function memLoad() { const k = memKey(); if (!k || k.endsWith("null")) return null; try { return JSON.parse(localStorage.getItem(k)) || { seen: [] }; } catch { return { seen: [] }; } }
function memSave(m) { const k = memKey(); if (k && m) try { localStorage.setItem(k, JSON.stringify(m)); } catch {} }
function memScript(key) {
  const [id, n] = key.split(":");
  if (id === "intro") return INTRO;
  const m = MEMORIES.find((q) => q.id === id); if (!m) return null;
  if (id === "age") { const a = COL_AGES[+n] || COL_AGES[1]; return fillMemory(m, { title: `The ${a.name} Age`, age: `The ${a.name} Age`, ageLine: AGE_LINES[+n] || a.lore || "" }); }
  return m;
}
const memTitle = (key) => memScript(key)?.title || key;
/** Pack → Journal → Memories: the intro is always there, then every memory seen in this save. */
function wireMemoriesUI() {
  cine = new Cutscene({ root: gameEl, audio, voice: storyUI.voice, touch: IS_TOUCH });
  storyUI.memories = () => [{ key: "intro", title: "The River-Tooth (the intro)" }, ...(memLoad()?.seen || []).map((k) => ({ key: k, title: memTitle(k) }))];
  storyUI.onMemoryReplay = (key) => { const s = memScript(key); if (s) beginCine(s, { teleport: key === "intro", replay: true }); };
}
const memQueue = [];
/** A story beat happened: queue its cutscene (once per save). */
function memory(key, delay = 2) {
  if (story.tutorial || game.noMemories) return false;
  const m = memLoad(); if (!m || m.seen.includes(key) || memQueue.some((q) => q.key === key)) return false;
  memQueue.push({ key, t: delay }); return true;
}
const memWatch = { prev: null, key: null, t: 0 };
function memPoll() {
  const k = memKey();
  if (k !== memWatch.key) { memWatch.key = k; memWatch.prev = null; }
  if (!k || k.endsWith("null") || !ready || !player || game.dead) return;
  const C = world.colony, sq = story.quests;
  let deep = 0;
  if (world.mode === "cave" && cave && mainPath.length) {
    const cp = camera.position; let near = null, nd = Infinity;
    for (const st of cave.stations) { const w = stationWorld(st), d = Math.hypot(cp.x - w.x, cp.y - w.y, cp.z - w.z); if (d < nd) { nd = d; near = st; } }
    deep = near ? Math.max(0, mainPath.indexOf(near.id)) / mainPath.length : 0;
  }
  const st = { cave: world.mode === "cave", kills: tally.kills, face: !!story.flags?.faceTaken, q: QIDS.map((id) => !!(story.active && sq?.done(id))), towns: C?.list.length || 0, age: C?.maxAge?.() || 0, trip: trip.on,
    mouth: world.mode === "cave" && story.active && !!(sq?.state("m5") || sq?.done("m5")) && cave?.kind !== "hollow" && deep > 0.85 };
  const p = memWatch.prev; memWatch.prev = st;
  if (!p) return;
  if (st.cave && !p.cave) memory("cave1", 2.5);
  if (st.kills > p.kills) memory("kill1", 2.2);
  if (st.face && !p.face) memory("face1", 1.2);
  QIDS.forEach((id, i) => { if (st.q[i] && !p.q[i]) memory("q_" + id, 2.5); });
  if (st.towns > 0 && p.towns === 0) memory("settle1", 3);
  if (st.age > p.age && st.age > 0) memory("age:" + st.age, 3);
  if (st.trip && !p.trip) memory("shroom1", 3.5);
  if (st.mouth && !p.mouth) memory("mouth1", 0.8);
}
function cineTick(dt) {
  if (!cine) return;
  if ((memWatch.t -= dt) <= 0) { memWatch.t = 0.5; memPoll(); }
  if (memQueue.length && !cine.on) {
    const q = memQueue[0];
    if (game.dead || storyUI.modal || travelling || world.busy || spirit?.on || !player || storyUI.menuOpen?.()) q.t = Math.max(q.t, 1);
    else if ((q.t -= dt) <= 0) {
      memQueue.shift();
      const m = memLoad(), s = memScript(q.key);
      if (m && s && !m.seen.includes(q.key)) { m.seen.push(q.key); memSave(m); beginCine(s, {}); }
    }
  }
  cine.update(dt);
}
function endTrip() { if (!trip.on) return; trip.endSoon(5); storyUI.toast("You breathe slowly. The colours drain away."); }
function tripTick(dt) {
  const was = trip.on, L = trip.update(dt);
  if (was && !trip.on) {
    tripMusic.stop(); audio.duckMusic(false);
    audio.setDuck(1);
    storyUI.toast("The vision fades. The world is only the world again.");
    if ((story.active || story.sandbox) && world.colony) visionPending = 1.6; // round 23: the spirits speak
    glog({ e: "trip", on: false });
    if (storyUI.tab === "inv") storyUI.renderPanel();
  }
  if (trip.on && !tripMusic.on && audio.ctx) tripMusic.start();
  if (trip.on || visions.list.length) { const f = player ? feetPos() : viewCam.position; visions.update(dt, L, viewCam.position, f, world.mode !== "overworld", trip.t, trip.phase === "peak"); }
  if (tripMusic.on) tripMusic.update(L, trip.phase === "peak" ? L : 0, audio.muted);
  if (trip.on && audio.ctx) { const k = 1 - 0.55 * L; if (Math.abs(k - audio.duck) > 0.01) audio.setDuck(k); }
  if (trip.on && world.mode === "overworld") trip.tintSky(scene);
  if (tripBtn._on !== trip.on) { tripBtn._on = trip.on; tripBtn.classList.toggle("hidden", !trip.on); }
}

/** Round 20: (re)load the settlements saved for this mode (story / free play) and world seed. */
function syncColony(fresh = false) {
  const C = world.colony; if (!C) return;
  const k = C.env.key();
  if (C._k !== k || fresh) { C._k = k; if (fresh) { C.clear(); C.save(); world.talk.mem = {}; world.talk.save(); } else C.loadSaved(); }
}
/** Round 20: when Kra may found a settlement (null = yes). Free play: always; story: after the
 *  "m2" quest or once he knows a Survival / Industry skill. */
function colonyLock() {
  if (story.sandbox && !story.active) return null;
  if (!story.active) return "Start the story or free play to found settlements";
  const s = story.surv.skills;
  if (story.quests.done("m2") || s.has("surv1") || s.has("wood1")) return null;
  return "Not yet: finish the second task in the story, or learn a Survival skill (Herb Lore), to lead your own people.";
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
  camFill.intensity = 0;
  ceilBounce.intensity = 0;
  world.entrance = null;
  cave = null;
  ensureWorld();
  const t = world.terrain;
  world.over.resident.visible = true;
  world.wildlife?.setVisible(true);
  if (world.settleRoot) world.settleRoot.visible = true;
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
  // Round 10: a fresh spawn looks a little down so the camp / Lume / the cave mouth fill the frame
  // on a wide desktop view instead of the sky (the chase camera aims at a point ahead of the eye).
  if (!entrance && !opts.at) { player.pitch = -0.2; player.applyLook(); }
  explored.clear();
  if (!story.active) game.health = game.maxHealth;
  game.dead = false;
  deathEl?.classList.add("hidden");
  renderStatus();
  // light / fog for the current time of day right away (no flash of wrong lighting)
  world.atmo.update(0, { eye: camera.position, elevation: t.height(x, z), lights: { sun: moonLight, hemi: skyFill, ambient }, fog: scene.fog, renderer });
  chunks.prime(streamCtx(), 12);
  if (nameEl) nameEl.textContent = "The Hills";
  document.getElementById("cave-real")?.classList.add("hidden");
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
  if (game.horse) toggleMount(true); // leave the horse at the mouth
  world.transitions.push({ t: +game.time.toFixed(1), e: "enter", id: e.id, cave: e.cave });
  return transition(async () => {
    const id = realCaveFor(e, world.terrain.entrances, storyCaveId());
    if (e.cave === "carlsbad") await loadCarlsbad({ fromEntrance: e });
    else if (e.cave === "hollow") { await loadLayout("lascaux"); loadCave(hollowCave(), { fromEntrance: e }); }
    else await loadRealCave(id, Number(e.cave) >>> 0, { fromEntrance: e, name: e.name });
    if (nameEl) nameEl.textContent = e.name;
    announceReal();
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
  // Round 27: modeled on Lascaux (the painted cave: Hall of the Bulls, Axial Gallery, Nave, the Shaft).
  const c = realCave("lascaux", HOLLOW_SEED, { story: "hollow" }) || generateCave(HOLLOW_SEED, { targetLegs: 26, squeezeProbability: 0.0, chamberProbability: 0.22 });
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
  // Round 27: seeds pick one of the real caves ("lehman:5" picks Lehman with seed 5)
  const R = realFromSeed(seed, s), c = realCave(R.id, R.seed);
  if (c) { loadCave(c); announceReal(); return R.seed; }
  loadCave(generateCave(s)); // layouts not fetched yet (first instant after boot)
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
  hintEl.textContent = oneFingerOn() ? "Stick: up = walk, left / right = turn · drag to look around · Stab to fight" : "Drag right to look · pad to move (edge = run) · Stab to fight";
} else {
  hintEl.textContent = "Click to look · WASD walk · Shift run · click stab · E use · I pack · M map · ☰ Menu → Controls for all keys";
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
// Round 13: spoken story voices + subtitles toggles (saved in localStorage).
const gfxBtn = document.getElementById("gfx-btn");
function syncGfx() { if (gfxBtn) gfxBtn.textContent = "Graphics: " + (gfxQuality() === "high" ? "High" : "Low"); document.getElementById("game")?.classList.toggle("gfx-high", gfxQuality() === "high"); }
syncGfx();
if (gfxBtn) {
  gfxBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const q = setGfxQuality(gfxQuality() === "high" ? "low" : "high");
    DPR_CAP = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? (q === "high" ? 1.75 : 1.3) : 2);
    dprNow = DPR_CAP; renderer.setPixelRatio(dprNow); resize(); syncGfx();
  });
  gfxBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}
const voiceBtn = document.getElementById("voice-btn"), subsBtn = document.getElementById("subs-btn");
function syncVoice() {
  const v = storyUI.voice;
  if (voiceBtn) { voiceBtn.textContent = !v.available || v.broken ? "No voices" : v.enabled ? "Voices on" : "Voices off"; voiceBtn.classList.toggle("off", !v.active); voiceBtn.disabled = !v.available; }
  if (subsBtn) { subsBtn.textContent = v.subtitles ? "Subtitles on" : "Subtitles off"; subsBtn.classList.toggle("off", !v.subtitles); }
  if (!v.active) storyUI.textOnly();
  else storyUI.dialog.classList.toggle("nosubs", storyUI.dialog.classList.contains("spoken") && !v.subtitles);
}
for (const [b, f] of [[voiceBtn, () => storyUI.voice.setEnabled(!storyUI.voice.enabled)], [subsBtn, () => storyUI.voice.setSubtitles(!storyUI.voice.subtitles)]]) {
  if (!b) continue;
  b.addEventListener("click", (e) => { e.stopPropagation(); storyUI.voice.prime(); f(); syncVoice(); });
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
}
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
  storyUI?.voice.prime(); // round 13: iOS only speaks after a gesture
}
// Round 10: the control hint shows for a few seconds after a game starts (after any title card),
// then hides for good; first movement / look input hides it sooner. It never sits under the title.
let hintTimer = 0;
function showHint(ms = 9000, delay = 0) {
  clearTimeout(hintTimer);
  hintEl.classList.add("hidden");
  hintTimer = setTimeout(() => {
    if (document.pointerLockElement === canvas || player?.foundExit) return;
    hintEl.classList.remove("hidden", "dim");
    hintTimer = setTimeout(() => hintEl.classList.add("hidden"), ms);
  }, delay);
}
function hideHintSoon(ms = 2500) {
  if (hintEl.classList.contains("hidden")) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.add("hidden"), ms);
}
canvas.addEventListener("click", () => {
  hideHintSoon(2500);
  armAudio();
});
document.addEventListener("keydown", (e) => { if (/^(Key[WASD]|Arrow)/.test(e.code)) hideHintSoon(2500); });
document.getElementById("joystick")?.addEventListener("pointerdown", () => hideHintSoon(2500));
document.addEventListener("pointerdown", armAudio, { once: false });
document.addEventListener("keydown", armAudio, { once: true });
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) { clearTimeout(hintTimer); hintEl.classList.add("hidden"); }
  else if (!player?.foundExit && world.mode) showHint(4000, 0);
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
  tc: {}, // round 24: tutorial counters (stabs, arrows, crafts…)
  weapon: "spear",
  health: 3, maxHealth: 3, invuln: 0, dead: false, deadT: 0, attackCd: 0, attackPending: -1,
  noiseBurst: 0, lastDamage: 0, time: 0, monster: null, respawnAt: -1, shake: 0, vignette: 0,
  fp: false, noiseOverride: null, god: false, lastAttack: null, hitsTaken: 0, log: [],
};
const explored = new Set();

// ---------------- Act 1 story (Flesh of the Ancients) ----------------
const storyUI = new StoryUI(gameEl, { touch: IS_TOUCH });
// round 25: one voice, nothing else over it. Round 25b: the duck is capped per line (text length) and
// a watchdog below lifts it whenever no speech is really playing, so sound can never stay muted.
storyUI.voice.onDuck = (on, text = "") => { audio.duckMusic(on); audio.setSpeech(on, 2500 + String(text).length * 110); };
storyUI.voice.onBroken = () => { audio.noSpeechDuck = true; audio.setSpeech(false); audio.duckMusic(false); syncVoice(); };
{
  let idleSince = 0;
  setInterval(() => {
    if (!audio.speech) { idleSince = 0; return; }
    let busy = !!storyUI.voice.speaking;
    try { const ss = window.speechSynthesis; if (ss && !ss.speaking && !ss.pending) busy = false; } catch {}
    if (busy) { idleSince = 0; return; }
    if (!idleSince) idleSince = performance.now();
    else if (performance.now() - idleSince > 1000) { idleSince = 0; audio.setSpeech(false); audio.duckMusic(false); }
  }, 250);
  const lift = () => { audio.setSpeech(false); audio.duckMusic(false); audio.unlock(); };
  document.addEventListener("visibilitychange", lift);
  addEventListener("pagehide", lift); addEventListener("pageshow", lift); addEventListener("focus", lift);
  // any tap / key re-unlocks the context on iOS (capture phase: buttons stop propagation)
  for (const ev of ["pointerdown", "touchend", "keydown"]) document.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
}
syncVoice();
window.__VOICE__ = storyUI.voice;
storyUI.voice.getVolume = () => audio.speechVol; // round 23: speech follows the Voices slider
storyUI.tripOn = () => trip.on; // round 21
wireMemoriesUI(); // round 24
storyUI.visionJournal = () => world.colony?.know.journal || []; storyUI.onVisionReplay = (n) => startVision(n); // round 23
// Round 22: multiplayer (rooms, avatars, chat, voice). Idle until you open ☰ → Multiplayer.
// the room to join: from an invite link, or this tab's room after a reload (the address bar is tidied on load)
const MP_ROOM = URLP.get("room") || (performance.getEntriesByType?.("navigation")[0]?.type === "reload" ? sessionStorage.getItem("fota-mp-room") : null);
let mpActive = !!MP_ROOM;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const mp = new Multiplayer({
  scene, root: gameEl, isTouch: IS_TOUCH, isIOS: IS_IOS, items: ITEMS,
  toast: (m) => storyUI.toast(m), ask: (...a) => storyUI.ask(...a),
  seed: () => world.terrain?.seed ?? (URLP.has("world") ? parseSeed(URLP.get("world")) : 20261111),
  inFreePlay: () => story.sandbox && !story.active,
  gotoFree: (code, seed) => { const u = new URL(location.origin + location.pathname); for (const k of ["net", "srv", "gfx", "daymin"]) if (URLP.has(k)) u.searchParams.set(k, URLP.get(k)); u.searchParams.set("play", "free"); u.searchParams.set("room", code); if (seed != null && seed !== 20261111) u.searchParams.set("world", seed); location.href = u.toString(); },
  area: () => (world.mode === "overworld" ? "o" : cave ? "c:" + (cave.seed ?? cave.name ?? "x") : ""),
  me: () => {
    if (!player || !ready || game.dead) return null;
    const f = feetPos();
    return { x: f.x, y: f.y, z: f.z, yaw: game.boat ? game.boat.yaw : player.yaw, pitch: player.pitch, run: player.runFrac || 0, st: player.stance, mounted: !!player.mounted, boat: game.boat ? game.boat.kind || "canoe" : 0, torch: caveman.flame.visible !== false, armed: !!game.armed, w: game.weapon };
  },
  gear: () => [...(story.surv?.wear || [])],
  surv: () => (story.sandbox || story.active ? story.surv : null),
  colony: () => world.colony,
  makeGuestColony: () => { const c = new Colony({ terrain: world.terrain, parent: world.settleRoot, people: world.people, toast: () => {}, skills: () => new Set(), key: () => "fota-guest-colony-unsaved" }); c.save = () => {}; c._colliders = () => {}; return c; },
  groundAt: (p) => (world.mode === "overworld" && world.terrain ? world.terrain.height(p.x, p.z) : null),
  audioCtx: () => audio.ctx, armAudio: () => armAudio(), voiceOut: () => audio.voiceBus || null,
  pxH: () => renderer.domElement.height, torchBase: () => caveman.baseIntensity,
  exitLock: () => { if (document.pointerLockElement) document.exitPointerLock(); },
  changed: () => { try { storyUI.renderPanel?.(); } catch {} },
  onActive: (on) => { if (mpActive !== on) { mpActive = on; syncColony(); } },
});
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
  get talk() { return world.talk || null; }, // round 20
  nearWater: (f) => world.mode === "overworld" && !!world.terrain && world.terrain.streamDist(f.x, f.z) < 2.1, // round 24 (tutorial)
  berryNear: (f) => (world.mode === "overworld" ? world.berries?.near(f) || null : null), // round 23: wild berry bushes
  pickBerry: (b) => {
    const got = story.surv.add("berries", 3);
    if (!got) { storyUI.toast("No room in your pack", "bad"); return; }
    world.berries.take(b); const herb = story.surv.skills.has("surv1") && Math.random() < 0.4 ? story.surv.add("herbs", 1) : 0;
    storyUI.toast(`+${got} Berries (${BERRY_KINDS[b.kind].name.toLowerCase()})` + (herb ? ", +1 Healing herbs" : ""), "good");
  },
  shroomNear: (f) => (world.mode === "overworld" ? world.shrooms?.near(f) || null : null), // round 21
  pickShroom: (sp) => { if (!story.surv.add("shroom", 2)) { storyUI.toast("No room in your pack", "bad"); return; } world.shrooms.take(sp); storyUI.toast("+2 Glowing mushroom. They pulse faintly in your hand.", "good"); },
  eatShroom: () => eatShroom(),
  endTrip: () => endTrip(),
  colonyJSON: () => world.colony?.toJSON() || null,
  talkJSON: () => world.talk?.toJSON() || null,
  colonyRestore: (o) => { if (world.colony && !world.colony.list.length && o?.list?.length) { world.colony.load(o, false); } },
  container: (f) => (world.mode === "overworld" && world.settle ? world.settle.containerNear(f.x, f.z) : null),
  lootNear: (f) => (world.mode === "overworld" ? world.fighters?.lootNear(f) : null), // round 24b
  lootTake: (b) => { world.fighters.lootTake(b, story.surv); renderStatus(); },
  onTheft: (f) => { const s = world.settle?.at(f.x, f.z); if (s?.hostile) world.fighters.aggro(s, "They caught you raiding their stores."); },
  places: () => world.places || null,
  caveEntryId: () => (world.mode !== "overworld" && world.entrance ? world.entrance.id : null),
  explored: () => explored.size,
  heal: (n) => { if (game.health >= game.maxHealth) return false; game.health = Math.min(game.maxHealth, game.health + n); renderStatus(); return true; },
  caveWater: () => (world.mode !== "overworld" ? waterHandle : null),
  // round 19: a crafted raft goes into the nearest water (check = true: only test there is some)
  launchRaft: (check = false) => {
    if (world.mode !== "overworld" || !world.boats || !player) return false;
    const f = feetPos(), sp = world.boats.spot(f.x, f.z, 24, 0.45);
    if (!sp || check) return !!sp;
    const b = world.boats.add("raft", sp.x, sp.z, Math.atan2(-(sp.x - f.x), -(sp.z - f.z)), { home: "yours" });
    b.dock = { x: sp.shore.x, z: sp.shore.z };
    game.myBoat = b;
    return true;
  },
  floorAt: (x, y, z) => { if (!player?.volume) return null; const q = queryVolume(player.volume, x, y, z, 0.05, 0); return q.inside ? q.floor : null; },
  caveExit: () => { if (!cave) return null; const st = stationMap(cave).get(cave.entranceId); if (!st) return null; const w = stationWorld(st); return { x: w.x, z: w.z }; },
  volume: () => (player && !player.terrain ? player.volume : null),
  paused: () => storyUI.modal || game.dead,
  hurt: () => damagePlayer(),
  health: () => game.health,
  setArmed: (v) => { game.armed = !!v; caveman.setWeapon(game.weapon || "spear", !!v); },
  applyStats: () => applyStats(),
  addCaveObject: (o) => { if (caveGroup) caveGroup.add(o); else scene.add(o); },
  caveSpotRoomy: (f0, f1) => {
    if (!cave || !mainPath.length || !player?.volume) return null;
    const sm = stationMap(cave), n = mainPath.length, rk = { stand: 0, crouch: 1, crawl: 2 };
    // reachable without crawling from the entrance up to here
    let best = null, worst = 0;
    for (let i = 0; i < n; i++) {
      const s0 = sm.get(mainPath[i]), w = stationWorld(s0), f = i / n;
      const need = requiredStanceAt(player.volume, w.x, w.y - s0.down + STANCES.stand.eye, w.z);
      if (f > f1) break;
      if (f >= f0 && need === "stand" && worst < 2 && s0.up + s0.down < 8 && (!best || s0.up + s0.down > best.h)) best = { f, h: s0.up + s0.down };
      worst = Math.max(worst, rk[need] ?? 0);
    }
    return best ? story.env.caveSpot(best.f + 0.5 / n) : null;
  },
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
  const pack = story.active || story.sandbox;
  game.maxHealth = 3 + (story.active ? s.faces + s.hpBonus : 0) + (pack ? s.bonusHearts() : 0);
  caveman.setGear(pack ? s.wear : new Set()); // round 16: clothing shows on Kra
  caveman.torchBoost = pack && s.crafted.has("torch") ? 1.3 : 1;
  if (caveman.light) caveman.light.distance = pack && s.crafted.has("torch") ? 58 : 45;
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
  try { localStorage.removeItem("fota-memories-v1-story"); } catch {} // round 24: a new journey, new memories
  if (world.terrain) wmap.clear(mapKey()); else wmap.pendingClear = true; // a new journey: the map starts dark again
  story.newGame();
  ensureWorld();
  syncColony(true); // a new journey: no settlements yet
  world.atmo.setTime(6.0); world.atmo.setWeather("clear", true); world.atmo.nextChange = 2.5;
  game.armed = false; caveman.spear.visible = false;
  applyStats(); game.health = game.maxHealth; renderStatus();
  enterOverworld();
  storyUI.setStoryVisible(true);
  storyUI.titleCard("Flesh of the Ancients", "Act I &mdash; The Empty Camp", 4200);
  showHint(8000, 5000); // after the title card
  setTimeout(() => storyUI.toast("Dawn. The fire is cold. Nobody is singing."), 4800);
  story.save("auto");
}
function continueGame() {
  const snap = readSave(); if (!snap) return startNewGame();
  story.load(snap);
  ensureWorld(); syncColony(); if (snap.colony && world.colony && !world.colony.list.length) world.colony.load(snap.colony, false);
  restoreFromSave(snap);
  storyUI.toast("Welcome back, Kra.");
  showHint(8000, 600);
}
function startFreePlay() {
  story.startSandbox(); // round 16: a pack + crafting + baskets in free play too
  storyUI.setStoryVisible(false); storyUI.setSandbox(true);
  game.armed = true; caveman.spear.visible = true;
  applyStats(); game.health = game.maxHealth; renderStatus();
  ensureWorld(); syncColony();
  world.atmo.setTime(19.4);
  enterOverworld();
  showHint(9000, 600);
}
function showMainMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  let first = false; try { first = !localStorage.getItem("fota-firstrun-v1") && !readSave(); } catch {}
  storyUI.showMenu({ canContinue: !!readSave(), onContinue: () => transition(continueGame), onNew: () => transition(startNewGame), onFree: () => transition(startFreePlay),
    onIntro: () => playIntro(true), onTutorial: () => openTutorial(), firstRun: first && !URLP.has("nofirst"), onFirstDone: () => { try { localStorage.setItem("fota-firstrun-v1", "1"); } catch {} } }); // round 24
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

function damagePlayer(n = 1, src = "") {
  if (game.dead || game.invuln > 0 || game.god || storyUI.modal) return false;
  // round 24b: worn armour (shield, jerkin, helm, mail) may turn a blow aside
  const arm = (story.active || story.sandbox) ? story.surv.armor() : 0;
  if (src && n > 0 && arm > 0 && Math.random() < arm * 0.15) { game.invuln = 0.6; storyUI.toast(`🛡 Your armour turns the ${src || "blow"} aside`); glog({ e: "blocked", src }); return false; }
  game.health -= n;
  game.hitsTaken += 1;
  game.invuln = 1.0;
  game.vignette = 1;
  game.shake = 0.35;
  game.lastDamage = game.time;
  glog({ e: "playerHit", health: game.health });
  audio.step(1, "stand");
  renderStatus();
  if (game.health <= 0) die();
  return true;
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
  if (game.weapon === "bow") return shootArrow();
  game.attackCd = 0.6;
  game.attackPending = 0.14;
  game.noiseBurst = 0.45;
  caveman.thrust();
  mp.fx("thrust"); tc("spear");
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
    // round 24b: hostile townsfolk / fighters first
    if (world.fighters && world.mode === "overworld") {
      const pk = story.active || story.sandbox, hf = world.fighters.tryHit(f, -Math.sin(player.yaw), -Math.cos(player.yaw), 1 + (story.active ? story.surv.str : 0) + (pk ? story.surv.spearBonus() : 0));
      if (hf) { if (hf.alive) storyUI.toast(`You wound the ${hf.kind} (${hf.hp}/${hf.max})`); audio.fight?.("strike"); res.hit = true; res.fighter = true; res.kind = hf.kind; res.alive = hf.alive; game.lastAttack = res; glog({ e: "attack", ...res }); return res; }
    }
    if (story.active) { if (story.onAttack(f, -Math.sin(player.yaw), -Math.cos(player.yaw))) hitA = story.lastHit; }
    else if (world.wildlife && world.mode === "overworld") {
      hitA = world.wildlife.tryHit(f, -Math.sin(player.yaw), -Math.cos(player.yaw), 2);
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
      m.hit(f, 1 + (story.active ? story.surv.str : 0) + (story.active || story.sandbox ? story.surv.spearBonus() : 0));
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
/** Entrance station + outward direction: the chase camera never backs out through the open mouth. */
/** Round 11: the entrance's daylight disc is only drawn near the mouth (full < 7 m, gone by 15 m). */
function updateDaylight() {
  const p = viewCam.position;
  for (const r of [world.caveLayer?.resident, caveGroup]) if (r) for (const o of r.children) {
    if (o.name !== "daylight" || !o.userData.mouth) continue;
    const m = o.userData.mouth, d = Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z);
    const a = Math.min(1, Math.max(0, (15 - d) / 8));
    o.material.opacity = a;
    o.visible = a > 0.01;
  }
}
function caveMouthPlane(c) {
  const sm = stationMap(c), s = sm.get(c.entranceId);
  if (!s) return null;
  const leg = c.legs.find((l) => l.from === s.id || l.to === s.id);
  const o = leg && sm.get(leg.from === s.id ? leg.to : leg.from);
  if (!o) return null;
  const p = stationWorld(s), q = stationWorld(o);
  const n = new THREE.Vector3(p.x - q.x, 0, p.z - q.z);
  if (n.lengthSq() < 1e-6) return null;
  return { p: new THREE.Vector3(p.x, p.y, p.z), n: n.normalize() };
}
const _camRC = new THREE.Raycaster(), _camDir = new THREE.Vector3(), _camO = new THREE.Vector3();
_camRC.firstHitOnly = true;
/** Max chase distance (along _back) before the eye->camera segment meets rendered rock. Several
 *  parallel rays (near-plane footprint) so the frustum corners don't poke through either. */
function camWallLimit(eye, sx, sy, want) {
  const meshes = caveWallMeshes().slice();
  // Round 13: formations (stalagmites / columns, instanced per cell) count too, so the chase
  // camera pulls in front of a column instead of putting it between you and Kra.
  for (const o of caveFormMeshes()) {
    const bs = o.boundingSphere; if (!bs) continue;
    if (bs.center.distanceTo(eye) < bs.radius + want + 1) meshes.push(o);
  }
  // The entrance's daylight disc stands just outside the mouth: never let the camera back through it.
  for (const r of [world.caveLayer?.resident, caveGroup]) if (r) for (const o of r.children) if (o.name === "daylight" || o.name === "mouth-cap") meshes.push(o);
  if (!meshes.length) return want;
  _camDir.copy(_right).multiplyScalar(sx).addScaledVector(_back, want);
  _camDir.y += sy;
  const len = _camDir.length();
  _camDir.divideScalar(len);
  let best = want;
  for (const [ox, oy] of [[0, 0], [0.16, 0], [-0.16, 0], [0, 0.14], [0, -0.14]]) {
    _camO.copy(eye).addScaledVector(_right, ox);
    _camO.y += oy;
    _camRC.set(_camO, _camDir);
    _camRC.near = 0; _camRC.far = len + 0.35;
    const h = _camRC.intersectObjects(meshes, false)[0];
    if (h) best = Math.min(best, want * Math.max(0, h.distance - 0.35) / len);
  }
  // Open cave mouth: stop 0.4 m inside the entrance station's plane.
  const M = world.mouth;
  if (M) {
    const den = _camDir.x * M.n.x + _camDir.z * M.n.z;
    if (den > 1e-3) {
      const dist = ((M.p.x - eye.x) * M.n.x + (M.p.z - eye.z) * M.n.z - 0.4) / den;
      best = Math.min(best, want * Math.max(0, dist) / len);
    }
  }
  return Math.max(0.2, best);
}
/** Round 12 (playtest r3 minor): outdoors, keep the chase camera out of hut / tent hides (cones)
 *  and the longhouse; sample the eye -> camera segment and stop just before the first hide. */
function camHideLimit(eye, sx, sy, want) {
  const t0 = world.terrain; if (!t0) return want;
  const cones = t0.conesNear(eye.x, eye.z, want + 1.5).concat(t0.treeCones(eye.x, eye.z, want + 1.5)); // round 19: tree crowns too
  if (!cones.length) return want;
  const N = 16;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    _tmp.copy(eye).addScaledVector(_right, sx * t).addScaledVector(_back, want * t);
    _tmp.y += sy * t;
    for (const c of cones) {
      const dy = _tmp.y - c.y;
      if (dy > c.h + 0.25 || (c.under && dy < -0.3)) continue;
      const rad = (c.cyl ? c.r : c.r * Math.max(0, 1 - Math.max(0, dy) / c.h)) + 0.3;
      if ((_tmp.x - c.x) ** 2 + (_tmp.z - c.z) ** 2 < rad * rad) return Math.max(0.2, want * (i - 1) / N - 0.1);
    }
  }
  return want;
}
function updateView(dt) {
  const eye = camera.position;
  camera.updateMatrixWorld();
  let fp = game.fp && !player.mounted && !game.boat; // round 12: always third person on horseback (round 19: and in a boat)
  if (!fp) {
    const st = player.stance, mt = !!player.mounted || !!game.boat;
    const want = game.boat ? (game.boat.kind === "umiak" ? 6.2 : 5.2) : mt ? 4.9 : st === "crawl" ? 1.4 : st === "crouch" ? 2.0 : 2.7;
    const sx = mt ? 0.3 : st === "crawl" ? 0.22 : 0.5, sy = mt ? 1.3 : st === "crawl" ? 0.3 : 0.32;
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _back.setFromMatrixColumn(camera.matrixWorld, 2);
    let allowed = want;
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      _tmp.copy(eye).addScaledVector(_right, sx * t).addScaledVector(_back, want * t);
      _tmp.y += sy * t;
      if (!camSpotFit(_tmp)) { allowed = Math.max(0.2, want * (i - 1) / 12 - 0.12); break; }
    }
    // Round 10: the analytic volume is wider than the lumpy rendered rock, so also ray-cast the
    // eye->camera segment against the passage mesh (BVH) and pull the camera in front of any wall.
    if (world.mode === "cave") allowed = Math.min(allowed, camWallLimit(eye, sx, sy, want));
    else if (world.mode === "overworld") allowed = Math.min(allowed, camHideLimit(eye, sx, sy, want));
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
  if (spiritCam || cineCam) fp = false; // round 23/24: the vision / cutscene camera shows Kra
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
// ---------------- bow (round 9) ----------------
const weaponBtn = document.getElementById("btn-weapon");
const reticleEl = document.getElementById("reticle");
function setWeapon(w) {
  game.weapon = w;
  caveman.setWeapon(w, !story.active || game.armed);
  if (attackBtn) attackBtn.textContent = w === "bow" ? "Shoot" : "Stab";
  if (weaponBtn) weaponBtn.firstChild.textContent = w === "bow" ? "Spear " : "Bow ";
  reticleEl?.classList.toggle("hidden", w !== "bow");
  storyUI.toast(w === "bow" ? "Bow ready: aim with the cross, tap Shoot / click" : "Spear ready");
}
function shootArrow() {
  game.attackCd = 0.55;
  game.noiseBurst = Math.max(game.noiseBurst, 0.2);
  caveman.thrust();
  attackBtn?.classList.add("hit");
  setTimeout(() => attackBtn?.classList.remove("hit"), 150);
  // Aim through the screen centre (the reticle): far point along the view, then fly from Kra's eye.
  const dir = new THREE.Vector3(); viewCam.getWorldDirection(dir);
  let far = 60;
  if (world.mode === "overworld") {
    // March the view ray to what's under the cross (an animal or the ground), so the gravity
    // compensation below matches the real range.
    const q = new THREE.Vector3();
    for (let t = 1; t < 80; t += 0.4) {
      q.copy(viewCam.position).addScaledVector(dir, t);
      if (q.y < world.terrain.height(q.x, q.z) || world.wildlife?.bodyAt(q)) { far = t; break; }
    }
  } else {
    const ray = new THREE.Raycaster(viewCam.position.clone(), dir.clone(), 0.3, 80);
    const h = ray.intersectObjects(caveWallMeshes(), false)[0];
    if (h) far = h.distance;
  }
  const target = viewCam.position.clone().addScaledVector(dir, far);
  const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const origin = camera.position.clone().addScaledVector(right, 0.12).add(new THREE.Vector3(0, -0.12, 0));
  origin.addScaledVector(dir, 0.35);
  const d = target.sub(origin);
  { const L = d.length(); d.y += 0.5 * 7.5 * (L / 40) ** 2; } // aim above by the gravity drop, so the arrow lands on the cross
  archery.shoot(origin, d);
  mp.fx("arrow", origin, d); tc("bow");
  audio.bowShot?.();
  glog({ e: "shoot" });
  return true;
}
function arrowTargets(p) {
  const from = feetPos();
  if (world.mode === "overworld" && world.fighters) { // round 24b
    const hf = world.fighters.arrowHit(p, 2 + (story.active || story.sandbox ? story.surv.arrowBonus() : 0));
    if (hf) { if (hf.alive) storyUI.toast(`Your arrow strikes the ${hf.kind} (${hf.hp}/${hf.max})`); audio.arrowHit?.(true); return hf.kind; }
  }
  if (world.mode === "overworld" && world.wildlife) {
    const a = world.wildlife.bodyAt(p);
    if (a) {
      world.wildlife.damage(a, 2 + (story.active || story.sandbox ? story.surv.arrowBonus() : 0), from);
      if (story.active) story.creditAnimal(a); else storyUI.toast(a.alive ? `The ${a.kind} is wounded and bolts!` : `You shot a ${a.kind}`, a.alive ? undefined : "good");
      if (!a.alive) { tally.kills += 1; saveTally(); renderStatus(); }
      audio.arrowHit?.(true);
      return a.kind;
    }
  }
  const m = game.monster;
  if (m && m.alive && Math.hypot(m.pos.x - p.x, m.pos.y + 0.9 - p.y, m.pos.z - p.z) < 1.0) {
    m.hit(from, 1 + (story.active ? story.surv.str : 0) + (story.active || story.sandbox ? story.surv.arrowBonus() : 0));
    audio.arrowHit?.(true);
    return "monster";
  }
  if (caveFauna && world.mode !== "overworld") {
    const r = caveFauna.hitAt(p, 0.5);
    if (r) {
      if (story.active && r.food) story.surv.add("meat", 1);
      storyUI.toast(`You shot a ${r.kind}`, "good");
      tally.kills += 1; saveTally(); renderStatus();
      audio.arrowHit?.(true);
      return r.kind;
    }
  }
  return null;
}
function updateArrows(dt) {
  if (!archery) return;
  const before = archery.log.length;
  archery.update(dt, { terrain: world.mode === "overworld" ? world.terrain : null, meshes: world.mode === "overworld" ? null : caveWallMeshes(), targets: arrowTargets });
  for (let i = before; i < archery.log.length; i++) if (archery.log[i].e !== "hit") audio.arrowHit?.(false);
}
weaponBtn?.addEventListener("click", (e) => { e.stopPropagation(); setWeapon(game.weapon === "bow" ? "spear" : "bow"); });

function setView(fp) {
  game.fp = !!fp;
  if (viewBtn) viewBtn.firstChild.textContent = game.fp ? "3rd person " : "1st person ";
}
function toggleView() { setView(!game.fp); }
// Round 24: raise / lower the torch (L, 🔥, gamepad RB). Lowered, it is a glow of embers: hide, or watch the dark.
caveman.torchDown = false;
const torchBtn = document.getElementById("btn-torch");
function toggleTorch() {
  caveman.torchDown = !caveman.torchDown; torchBtn?.classList.toggle("active", caveman.torchDown);
  storyUI.toast(caveman.torchDown ? "🔥 Torch lowered: just a glow of embers." : "🔥 Torch up.");
}
torchBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleTorch(); });
torchBtn?.addEventListener("pointerdown", (e) => e.stopPropagation());

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
  if (e.target instanceof HTMLInputElement) return;
  if (mp.key(e, true) || e.repeat) return; // round 22: V = push-to-talk, T / Enter = chat while in a room
  if (e.code === "KeyR") attack(); // round 24b: F is Find now (R or left click stabs)
  if (e.code === "KeyF" && ready && player && !cine?.on) { e.preventDefault(); toggleFind(); }
  if (e.code === "KeyH" && ready && player && !cine?.on && !storyUI.modal) { e.preventDefault(); blowHorn(); } // round 24b: Call to Arms
  if (e.code === "KeyQ" || e.code === "KeyB") setWeapon(game.weapon === "bow" ? "spear" : "bow");
  if (e.code === "KeyV") toggleView();
  if (e.code === "KeyL" && !storyUI.modal) toggleTorch(); // round 24
  // Act 1: interact / inventory / skills / crafting; debug time + weather
  if (e.code === "KeyE" && storyUI.dialog.classList.contains("hidden") && canToggleMount()) { e.preventDefault(); toggleMount(); }
  else if (e.code === "KeyE" || (e.code === "Space" && !storyUI.dialog.classList.contains("hidden"))) { e.preventDefault(); story.interact(); }
  else if (e.code === "Space" && !storyUI.modal && !game.dead) { e.preventDefault(); player?.jump(); }
  if ((story.active || story.tutorial) && e.code === "KeyJ") storyUI.toggleTasks();
  const pk = story.active || story.sandbox;
  if (pk && e.code === "KeyI") { storyUI.togglePanel("inv", story.surv); }
  if (pk && e.code === "KeyK") { storyUI.togglePanel("skills", story.surv); }
  if (pk && e.code === "Tab") { e.preventDefault(); storyUI.togglePanel("craft", story.surv); }
  if (e.code === "KeyM" && ready && !storyUI.modal) openMap(true);
  if (e.code === "Escape") { finder?.close(); storyUI.closePanel(); storyUI.closeChoice(); if (wmap.isOpen) wmap.close(); }
  if (e.code === "KeyT" && world.atmo) { world.atmo.skip(e.shiftKey ? -1 : 1); storyUI.toast(`Time: ${world.atmo.label().clock}`); }
  if (e.code === "KeyY" && world.atmo) { storyUI.toast(`Weather: ${world.atmo.cycleWeather()}`); }
});
storyUI.actBtn.addEventListener("click", () => { armAudio(); story.interact(); });
// ---------------- Round 12: riding ----------------
const mountBtn = document.getElementById("btn-mount");
// Round 13: pointerdown, not click: with a finger already on the joystick, mobile browsers don't
// synthesise a click for the second touch, which is why jumping only worked when standing still.
document.getElementById("btn-jump")?.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); armAudio(); if (!game.dead) player?.jump(); });
document.getElementById("btn-jump")?.addEventListener("click", (e) => e.stopPropagation());
mountBtn?.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); armAudio(); if (canToggleMount()) toggleMount(); });
mountBtn?.addEventListener("click", (e) => e.stopPropagation());
function canToggleMount() {
  if (world.mode !== "overworld" || !player || !world.wildlife || game.dead || world.busy) return false;
  if (game.horse || game.boat) return true;
  if (boatNear()) return true;
  return !!world.wildlife.mountable(feetPos());
}
function toggleMount(silent = false) {
  if (game.boat) return leaveBoat();
  if (!game.horse) { const b = boatNear(); if (b) { boardBoat(b); return true; } }
  if (game.horse) {
    // step off to the left side, onto clear ground
    const h = game.horse, t = world.terrain, f = feetPos();
    let ox = f.x, oz = f.z;
    for (const side of [1, -1, 0]) {
      const lx = f.x - Math.cos(player.yaw) * 1.5 * side + (side ? 0 : Math.sin(player.yaw) * 2.6), lz = f.z + Math.sin(player.yaw) * 1.5 * side + (side ? 0 : Math.cos(player.yaw) * 2.6);
      if (t.collidersNear(lx, lz, 0.5).every((c) => { const q = colCore(c, lx, lz); return Math.hypot(q.x - lx, q.z - lz) > q.t + 0.35; })) { ox = lx; oz = lz; break; }
    }
    player.mounted = false;
    game.horse = null;
    world.wildlife.dismount(h);
    player.placeWorld(ox, 0, oz);
    if (!silent) storyUI.toast("You slide off the horse.");
    return true;
  }
  const a = world.wildlife.mountable(feetPos());
  if (!a) return false;
  player.setStance("stand");
  world.wildlife.mount(a);
  game.horse = a;
  player.mounted = true;
  player.yaw = a.yaw;
  player.placeWorld(a.pos.x, 0, a.pos.z);
  storyUI.toast(IS_TOUCH ? "You swing up onto the horse. Push the stick all the way to gallop; Dismount to get off." : "You swing up onto the horse. Hold Shift to gallop, Space to jump, E to get off.");
  return true;
}
let mountShown = "";
function updateMountUI() {
  if (!mountBtn) return;
  const want = world.mode !== "overworld" ? "" : game.boat ? "out" : game.horse ? "off" : boatNear() ? "boat" : world.wildlife?.mountable(feetPos()) ? "on" : "";
  if (want === mountShown) return;
  mountShown = want;
  mountBtn.classList.toggle("hidden", !want);
  mountBtn.innerHTML = want === "out" ? "Get out <kbd>E</kbd>" : want === "boat" ? "Board ⛵ <kbd>E</kbd>" : want === "off" ? "Dismount <kbd>E</kbd>" : "Ride <kbd>E</kbd>";
}
storyUI.invBtn.addEventListener("click", () => storyUI.togglePanel("inv", story.surv));
document.getElementById("menu-main-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); showMainMenu(); });
document.getElementById("pack-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); if (story.active || story.sandbox) storyUI.openPanel("inv", story.surv); });

/** Round 17: the hunter's body as an objective marker inside Waterfall Hollow. */
function caveQuestTarget() {
  if (!story.active || cave?.kind !== "hollow") return null;
  const h = story.hunter, fl = story.flags;
  if (h && !fl.faceTaken && fl.ratKilled) return { x: h.x, z: h.z, label: "Hunter" };
  return null;
}
// ---------------- Round 16: full-screen map + cave exit ----------------
const wmap = new WorldMap(gameEl, { touch: IS_TOUCH });
function mapKey() { return `fota-map-${story.tutorial ? "tut" : story.active ? "story" : "free"}-${world.terrain?.seed ?? 0}`; }
function mapState() {
  const p = camera.position, out = { mode: world.mode, player: { x: p.x, z: p.z, yaw: player?.yaw || 0 } };
  const tgt = story.active ? story.questTarget() : null;
  if (tgt) out.target = tgt;
  const hm = world.mode === "overworld" ? "overworld" : "cave";
  if (game.hint && game.hint.until > game.time && game.hint.mode === hm) out.hint = game.hint;
  if (world.mode === "overworld" && world.terrain) {
    const t = world.terrain, site = t.act1;
    out.title = "The Hills";
    out.towns = (t.settlements || []).map((s) => ({ x: s.x, z: s.z, name: s.hostile ? `⚔ ${s.name} (hostile)` : s.name, kind: s.kind, color: s.hostile ? "#ff5a4a" : SETTLE_KIND[s.kind].color, known: false }));
    if (world.fighters) for (const a of world.fighters.allies) out.marks.push({ x: a.x, z: a.z, color: "#5aa8ff", label: "⚔" }); // round 24b
    out.entrances = t.entrances.filter((e) => world.discovered.has(e.id)).map((e) => ({ x: e.x, z: e.z, name: e.name, cave: e.cave }));
    out.marks = site ? [{ x: site.camp.x, z: site.camp.z, color: "#ffb050", label: story.active ? "River-Tooth camp" : "Camp" }] : [];
    if (site && story.active) out.stream = site.stream;
    if (world.colony) for (const c of world.colony.list) out.towns.push({ x: c.x, z: c.z, name: `${c.name} · ${COL_AGES[c.age].name} · 👥${c.vill.length}`, kind: "village", color: "#7fe0ff", known: true }); // round 20
    if (world.boats) out.boats = world.boats.list.map((b) => ({ x: b.x, z: b.z, yaw: b.yaw, kind: b.kind, mine: b === game.boat || b === game.myBoat, riding: b === game.boat }));
    if (world.shrooms) for (const q of world.shrooms.marks()) out.marks.push({ x: q.x, z: q.z, color: "#ff6af0", label: "🍄" }); // round 21
    for (const m of mp.marks()) (m.town ? out.towns.push({ x: m.x, z: m.z, name: m.label, kind: "village", color: m.color, known: true }) : out.marks.push({ x: m.x, z: m.z, color: m.color, label: "👤 " + m.label })); // round 22
    if (beacon.pos) out.beacon = { x: beacon.pos.x, z: beacon.pos.z, dist: Beacon.fmt(beacon.dist(p)) }; // round 23
    { const fc = findCur("overworld"); if (fc) out.find = { x: fc.x, z: fc.z, label: fc.label, icon: fc.icon, dist: findFmt(Math.hypot(fc.x - p.x, fc.z - p.z)) }; } // round 24b
    out.npcs = world.places ? Object.entries(world.places.npc).map(([id, n]) => ({ x: n.x, z: n.z, mark: story.npcMark(id) })) : [];
  } else if (cave) {
    out.title = nameEl?.textContent || "Cave";
    const sm = stationMap(cave), seen = (id) => explored.has(id);
    out.legs = [];
    for (const leg of cave.legs) {
      const a = sm.get(leg.from), b = sm.get(leg.to); if (!a || !b || (!seen(a.id) && !seen(b.id))) continue;
      const pa = stationWorld(a), pb = stationWorld(b);
      out.legs.push({ ax: pa.x, az: pa.z, bx: pb.x, bz: pb.z, w: Math.max(0.8, Math.min(a.left + a.right, b.left + b.right) * 0.6) });
    }
    const en = sm.get(cave.entranceId); if (en) { const w = stationWorld(en); out.entrance = { x: w.x, z: w.z }; }
    delete out.target;
    const ct = caveQuestTarget(); if (ct) out.target = ct;
  }
  return out;
}
function openMap(toggle = false, focus = null) {
  if (!ready || !player) return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (toggle) wmap.toggle(mapState); else wmap.open(mapState, focus);
}
/** Round 17: 💡 Hint: map centred on the next objective (pulsing), a spoken / written line, and the
 *  compass pointing there for 20 s. */
function showObjectiveHint() {
  let h = story.hint();
  if (!h && story.tutorial && world.terrain) { // round 24: the tutorial's hint points at the nearest town
    const f = feetPos(), s = (world.terrain.settlements || []).slice().sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    if (s) h = { x: s.x, z: s.z, label: s.name, text: `People live at ${s.name}. Follow the marker.` };
  }
  if (!h) { storyUI.toast("No hint right now. Explore freely."); return null; }
  game.hint = { ...h, mode: world.mode === "overworld" ? "overworld" : "cave", until: game.time + 20 };
  compassKey = "";
  storyUI.toast("💡 " + h.text, "skill");
  if (storyUI.voice.active) storyUI.voice.speak(h.text, "");
  openMap(false, h);
  glog({ e: "hint", label: h.label });
  return game.hint;
}
wmap.onHint = () => showObjectiveHint();
wmap.onFilters = () => toggleFilters(wmap.el, () => wmap.draw(), "big");

// ---------------- Round 23: map beacon + fast travel ----------------
const beacon = new Beacon(scene, gameEl);
const beaconKey = () => `fota-beacon-${story.tutorial ? "tut" : story.active ? "story" : "free"}-${world.terrain?.seed ?? 0}`;
const ftFade = document.createElement("div"); ftFade.id = "ft-fade"; gameEl.appendChild(ftFade);
let travelling = false;
/** Places you can fast-travel to: towns you've found, your settlements, discovered cave mouths, camp, an explored beacon. */
function travelTargets() {
  const t = world.terrain; if (!t) return [];
  const out = [], site = t.act1;
  for (const s of t.settlements || []) if (wmap.seen(s.x, s.z)) out.push({ kind: "town", x: s.x, z: s.z, r: s.R + 6, name: s.name });
  if (world.colony) for (const c of world.colony.list) out.push({ kind: "home", x: c.x, z: c.z, r: 9, name: c.name });
  for (const e of t.entrances) if (world.discovered.has(e.id)) out.push({ kind: "cave", x: e.x + (e.fx || 0) * 6, z: e.z + (e.fz || 0) * 6, look: { x: e.x, z: e.z }, r: 0, name: e.name || "Cave mouth" });
  if (site) out.push({ kind: "camp", x: site.camp.x, z: site.camp.z, r: 5, name: story.active ? "River-Tooth camp" : "Camp" });
  if (beacon.pos && wmap.seen(beacon.pos.x, beacon.pos.z)) out.push({ kind: "beacon", x: beacon.pos.x, z: beacon.pos.z, r: 0, name: "your beacon" });
  return out;
}
/** Why you can't travel right now ("" = you can). */
function travelBlock() {
  if (!ready || !player || game.dead) return "You can't travel right now.";
  if (world.mode !== "overworld") return "Can't fast travel from inside a cave. Walk out first.";
  if (travelling || world.busy || spiritCam || storyUI.visionOn) return "Not now.";
  if (game.lastDamage > 0 && game.time - game.lastDamage < 10) return "You're in a fight. Get clear first (10 s without being hurt).";
  const m = game.monster; if (m && m.alive && (m.state === "chase" || m.state === "lunge")) return "Something is hunting you. Shake it off first.";
  if (trip.on) return "The world is still swimming. Wait for the mushrooms to wear off.";
  return "";
}
/** A dry, clear spot near (x, z), r m out (spiral search). */
function landingNear(x, z, r0) {
  const t = world.terrain, f = player ? feetPos() : { x: x + 1, z }, a0 = Math.atan2(f.z - z, f.x - x);
  const ok = (px, pz) => t.waterDepth(px, pz) < -0.4 && t.slope(px, pz).m < 0.45 && t.collidersNear(px, pz, 0.8).every((c) => { const q = colCore(c, px, pz); return Math.hypot(q.x - px, q.z - pz) > q.t + 0.6; });
  for (let r = r0; r < r0 + 40; r += 3) for (let k = 0; k < 16; k++) { const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.39, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return { x: px, z: pz }; }
  return null;
}
function fastTravel(dst) {
  const why = travelBlock(); if (why) { storyUI.toast(why, "bad"); return false; }
  const L = landingNear(dst.x, dst.z, dst.r); if (!L) { storyUI.toast("No safe ground to arrive on there.", "bad"); return false; }
  travelling = true; wmap.close(); tc("ft");
  const horse = game.horse;
  if (game.boat) leaveBoat(true); // the boat stays where it is (it's on the map)
  ftFade.textContent = `Travelling to ${dst.name}…`; ftFade.classList.add("on");
  glog({ e: "fastTravel", to: dst.name, kind: dst.kind });
  setTimeout(() => {
    const lk = dst.look || dst, yaw = Math.hypot(lk.x - L.x, lk.z - L.z) > 0.5 ? Math.atan2(-(lk.x - L.x), -(lk.z - L.z)) : player.yaw; // face the place
    if (horse && player.mounted) { player.placeWorld(L.x, 0, L.z); world.wildlife.ride(horse, feetPos(), player.yaw, 0, 0.016, 0); } // the horse comes too
    else player.placeWorld(L.x, 0, L.z);
    player.yaw = yaw; player.applyLook?.();
    wmap.revealAt?.(L.x, L.z, 120);
    for (const e of world.terrain.entrances) if (Math.hypot(e.x - L.x, e.z - L.z) < 70) world.discovered.add(e.id);
    // stamina / hunger cost of the journey (a little: you walked it, in a blink)
    const d = Math.hypot(dst.x - L.x, dst.z - L.z);
    if (story.surv && (story.active || story.sandbox)) { const s = story.surv; s.hunger = Math.max(5, s.hunger - Math.min(12, d / 400)); s.thirst = Math.max(5, s.thirst - Math.min(12, d / 350)); }
    mp.travelled?.(dst.name);
    setTimeout(() => { ftFade.classList.remove("on"); travelling = false; storyUI.toast(`🧭 You arrive at ${dst.name}.`, "good"); }, 650);
  }, 480);
  return true;
}
wmap.onTap = (q) => {
  if (q.mode !== "overworld" || !world.terrain) return [];
  const items = [], reach = Math.max(14, 26 / q.scale), f = feetPos();
  const near = travelTargets().map((d) => ({ ...d, d: Math.hypot(d.x - q.x, d.z - q.z) })).filter((d) => d.d < reach + (d.kind === "town" ? d.r : 0)).sort((a, b) => a.d - b.d)[0];
  if (near) {
    const why = travelBlock(), far = Math.hypot(near.x - f.x, near.z - f.z);
    if (far < 25) items.push({ note: true, label: `You're at ${near.name}.` });
    else items.push({ label: `🧭 Travel to ${near.name} (${Beacon.fmt(far)})`, cls: "go", disabled: !!why, why, act: () => fastTravel(near) });
    if (why && far >= 25) items.push({ note: true, label: why });
  }
  const onB = beacon.pos && Math.hypot(beacon.pos.x - q.x, beacon.pos.z - q.z) < reach;
  if (!onB) items.push({ label: beacon.pos ? "📍 Move beacon here" : "📍 Set beacon here", cls: "bc", act: () => { beacon.set(q.x, q.z); storyUI.toast(`📍 Beacon set, ${Beacon.fmt(beacon.dist(feetPos()))} away. Look for the pillar of light.`); } });
  if (beacon.pos) items.push({ label: "✕ Clear beacon", act: () => { beacon.clear(); storyUI.toast("Beacon cleared."); } });
  if (finder.cur) items.push({ label: "🔍 Next nearest", act: () => finder.next() }, { label: "✕ Clear find", act: () => { finder.clear(); storyUI.toast("🔍 Find cleared."); } }); // round 24b
  return items;
};
storyUI.onHint = () => showObjectiveHint();
// ---------------- Round 24b: 🔍 Find ----------------
const findMark = new Beacon(scene, gameEl, { name: "find", bd: () => document.getElementById("find-panel"), id: "find-ind", icon: "🔍", outer: 0x66ff1a, inner: 0xb8ff6a, ring: 0xb6ff5a });
const finder = new Finder(gameEl, {
  terrain: () => world.terrain, mode: () => world.mode, feet: () => (player && ready ? feetPos() : null),
  seen: (x, z) => wmap.seen(x, z), story, camp: () => world.camp, shrooms: () => world.shrooms, berries: () => world.berries,
  wildlife: () => world.wildlife, boats: () => world.boats, riding: () => game.boat, myBoat: () => game.myBoat,
  colonies: () => world.colony?.list || [], caveFauna: () => caveFauna, caveWater: () => (world.mode !== "overworld" ? waterHandle : null),
  questHint: () => { if (world.mode !== "overworld" && !story.active) return null; let h = story.hint(); if (!h && story.tutorial && world.terrain) { const f = feetPos(), s = (world.terrain.settlements || []).slice().sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0]; if (s) h = { x: s.x, z: s.z, label: s.name }; } return h; },
  toast: (t, k) => storyUI.toast(t, k), log: (e) => glog(e), found: () => softChime(),
  onChange: (c) => {
    compassKey = "";
    if (c && c.mode === "overworld") { findMark.icon = "🔍" + c.icon; findMark.set(c.x, c.z); } else findMark.clear();
    findBtn.classList.toggle("on", !!c); if (wmap.isOpen) wmap.draw();
    if (c) tc("find");
  },
});
function findCur(mode) { const c = finder.cur; return c && c.mode === mode ? c : null; }
function toggleFind() { if (!ready || !player) return; finder.toggle(); }
/** Round 24b: no beast / townsfolk attacks while dead, in a cinematic or menu, in the tutorial, or inside a friendly town / your settlement. */
function fightSafe() {
  if (game.dead || story.tutorial || storyUI.modal || cine?.on || world.busy || !player) return true;
  if (world.mode !== "overworld") return true;
  const f = feetPos(), s = world.settle?.at(f.x, f.z);
  if (s && !s.hostile) return true;
  return !!world.colony?.list.some((c) => Math.hypot(c.x - f.x, c.z - f.z) < world.colony.radius(c) + 6);
}
function blowHorn() { if (!ready || !player || world.mode !== "overworld" || !world.fighters) return null; const r = world.fighters.callToArms(); tc("horn"); updateHornBtn(true); return r; }
const hornBtn = document.createElement("button");
hornBtn.id = "horn-btn"; hornBtn.type = "button"; hornBtn.className = "hidden"; hornBtn.innerHTML = "📯<i></i>"; hornBtn.title = "Call to Arms (H): summon warriors from your friendly towns"; hornBtn.setAttribute("aria-label", "Call to Arms");
gameEl.appendChild(hornBtn);
hornBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
hornBtn.addEventListener("click", (e) => { e.stopPropagation(); blowHorn(); });
let hornShown = "";
function updateHornBtn(force = false) {
  const F = world.fighters, ok = !!F && ready && !!player && world.mode === "overworld" && !story.tutorial && !cine?.on && !!F.hornTown();
  const cd = ok ? Math.ceil(F.hornCd) : 0, k = ok ? (cd > 0 ? "c" + cd : "r") : "";
  if (k === hornShown && !force) return;
  hornShown = k; hornBtn.classList.toggle("hidden", !ok); hornBtn.classList.toggle("cd", cd > 0);
  hornBtn.querySelector("i").textContent = cd > 0 ? (cd > 99 ? Math.ceil(cd / 60) + "m" : cd + "s") : "";
}
function findTick() {
  if (!player || !ready || cine?.on) return;
  finder.update();
  const c = finder.cur;
  if (c && c.mode === "overworld" && findMark.pos && (findMark.pos.x !== c.x || findMark.pos.z !== c.z)) findMark.pos = { x: c.x, z: c.z }; // moving targets (animals)
  findMark.update(viewCam, feetPos(), (x, z) => world.terrain.height(x, z), !!c && c.mode === "overworld" && world.mode === "overworld" && !spiritCam && !!world.terrain, performance.now() / 1000, gameEl.clientWidth, gameEl.clientHeight);
}
const findBtn = document.createElement("button");
findBtn.id = "find-btn"; findBtn.type = "button"; findBtn.textContent = "🔍"; findBtn.title = "Find (F): mushrooms, water, flint, ore…"; findBtn.setAttribute("aria-label", "Find something");
gameEl.appendChild(findBtn);
findBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
findBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFind(); });
wmap.onFind = () => finder.open();
const mapfBtn = document.createElement("button");
mapfBtn.id = "mapf-btn"; mapfBtn.type = "button"; mapfBtn.textContent = "⚙"; mapfBtn.title = "What the map shows"; mapfBtn.setAttribute("aria-label", "Map filters");
gameEl.appendChild(mapfBtn);
mapfBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
mapfBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFilters(gameEl, null, "mini"); });
minimapCanvas.addEventListener("click", (e) => { e.stopPropagation(); openMap(); });
minimapCanvas.addEventListener("pointerdown", (e) => e.stopPropagation());
const mapBtn = document.createElement("button");
mapBtn.id = "map-btn"; mapBtn.type = "button"; mapBtn.innerHTML = "&#128506;"; mapBtn.title = "Map (M)"; mapBtn.setAttribute("aria-label", "Open the map");
gameEl.appendChild(mapBtn);
mapBtn.addEventListener("click", (e) => { e.stopPropagation(); openMap(); });
mapBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
const exitBtn = document.createElement("button");
exitBtn.id = "exit-cave-btn"; exitBtn.type = "button"; exitBtn.className = "hidden"; exitBtn.innerHTML = "&#10548; Exit cave";
gameEl.appendChild(exitBtn);
exitBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
exitBtn.addEventListener("click", (e) => { e.stopPropagation(); askExitCave(); });
function askExitCave() {
  if (world.mode === "overworld" || !player || world.busy) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const where = world.entrance ? `You come out at ${world.entrance.name}.` : "You go back to where you came in.";
  storyUI.ask("Leave the cave?", `Stuck, or had enough? Kra finds his way back to the cave mouth. ${where} Nothing is lost.`, [{ id: "go", label: "⤴ Climb out", desc: "Safe, no penalty" }], (id) => {
    if (id === "go") exitCaveNow();
  });
}
function exitCaveNow() {
  if (world.mode === "overworld" || !player) return false;
  glog({ e: "exitCaveButton", entrance: world.entrance?.id ?? null });
  if (world.entrance) returnToOverworld();
  else { player.setStance("stand"); player.spawnAtEntrance(); game.invuln = 2; if (game.monster?.alive) game.monster.spawnFar(feetPos()); storyUI.toast("Back at the cave entrance."); }
  return true;
}
let exitShown = null;
function updateExitBtn() {
  const want = world.mode !== "overworld" && ready && !!player && !game.dead;
  if (want !== exitShown) { exitShown = want; exitBtn.classList.toggle("hidden", !want); }
}

let animSpeed = 0;
// Round 13: HUD pointer to the nearest settlement (towns / villages preferred), with distance.
const compassEl = document.getElementById("compass");
let compassKey = "";
function updateCompass(p, inside) {
  if (!compassEl) return;
  let n = world.settle?.nearest(p.x, p.z);
  const hint = game.hint && game.hint.until > game.time && game.hint.mode === world.mode ? game.hint : null;
  const fc = findCur(world.mode === "overworld" ? "overworld" : "cave"); // round 24b: a Find target beats the tracked quest
  const qt = hint ? { x: hint.x, z: hint.z, label: "💡 " + hint.label } : fc ? { x: fc.x, z: fc.z, label: "🔍 " + fc.label, find: true } : mapFilters.quest ? game.questTarget : null; // round 16: the tracked quest wins (round 17: a hint wins over it)
  if (hint && Math.hypot(hint.x - p.x, hint.z - p.z) < 3) { game.hint = null; compassKey = ""; return updateCompass(p, inside); } // reached it
  if (hint && !n) n = { s: {}, d: 0 };
  if (qt && !n) n = { s: {}, d: 0 };
  if (qt) n = { s: { name: (hint || qt.find ? "" : "◆ ") + qt.label, x: qt.x, z: qt.z, kind: "quest" }, d: Math.hypot(qt.x - p.x, qt.z - p.z) };
  if (!n || inside || game.camOverride) { if (compassKey !== "off") { compassKey = "off"; compassEl.classList.add("hidden"); } return; }
  const dx = n.s.x - p.x, dz = n.s.z - p.z;
  const rel = Math.atan2(-dx, -dz) - player.yaw;
  const kind = n.s.kind === "city" ? "town" : n.s.kind;
  const nm = n.s.kind === "quest" ? (n.s.name.length > 26 ? n.s.name.slice(0, 25) + "…" : n.s.name) : `${n.s.name} (${kind})`;
  const dist = n.d > 950 ? (n.d / 1000).toFixed(1) + " km" : Math.round(n.d / 10) * 10 + " m";
  const key = n.s.name + dist;
  if (key !== compassKey) {
    compassKey = key;
    compassEl.classList.remove("hidden");
    compassEl.querySelector(".n").textContent = nm;
    compassEl.querySelector(".d").textContent = dist;
  }
  compassEl.querySelector(".arr").style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
}
/** Round 12: substeps by time and by distance (sprint 13.8 m/s, gallop 19.5 m/s): <= ~0.15 m per
 *  step so the wall BVH rays / circle colliders never get skipped; capped at 16 per frame. The
 *  speed eases in over ~0.3 s, so the current speed + a margin bounds this frame's travel. */
function substepsFor(dt) {
  const vmax = (player?.speedNow || 0) + 1.5;
  return Math.min(16, Math.max(1, Math.ceil(dt / 0.025), Math.ceil((dt * vmax) / 0.15)));
}
function revealAround(p) {
  for (const s of cave.stations) {
    if (explored.has(s.id)) continue;
    const w = stationWorld(s);
    const r = Math.max(7, Math.max(s.left, s.right) + 4);
    if (Math.hypot(p.x - w.x, p.z - w.z) < r && Math.abs(p.y - w.y) < Math.max(8, s.up + 4)) explored.add(s.id);
  }
}

const DEBUG_UI = new URLSearchParams(location.search).has("debug");
if (DEBUG_UI) document.getElementById("game")?.classList.add("debug-ui");
let storyModeUI = null;
let tickErrs = 0, tickFrames = 0;
function tick(now) {
  if (glLost) { requestAnimationFrame(tick); return; } // wait for webglcontextrestored
  try {
    if (tickFrames < 5 && URLP.has("failhigh") && gfxQuality() === "high") throw new Error("test: High graphics failure");
    tickBody(now);
    if (++tickFrames === 30) {
      window.__bootOK?.();
      let fb = null; try { fb = sessionStorage.getItem("fota-gfx-fb"); sessionStorage.removeItem("fota-gfx-fb"); } catch {}
      if (fb) { syncGfx?.(); storyUI.toast("Graphics switched to Low: High didn't work on this device. (☰ → Graphics to try again.)", "bad"); }
    }
  }
  catch (err) {
    tickErrs++; if (tickErrs <= 3) { console.error("frame error", err); errors.push(String(err && err.stack || err).slice(0, 300)); }
    if (tickFrames < 120 && gfxFallback("frame error: " + (err && err.message))) return;
    requestAnimationFrame(tick);
  }
}
function tickBody(now) {
  if (storyModeUI !== !!story.active) { storyModeUI = !!story.active; document.getElementById("game")?.classList.toggle("story-mode", storyModeUI); }
  const rawMs = now - last;
  // Frame-rate independent: up to 0.1 s per frame, simulated in <= 1/40 s substeps.
  const dt = Math.min(0.1, rawMs / 1000);
  last = now;
  if (rawMs > 0 && rawMs < 500 && !navigator.webdriver) adaptResolution(rawMs);
  if (storyUI.modal && document.pointerLockElement) document.exitPointerLock();
  if (player && ready) {
    // Round 12: substep by distance too (sprint 13.8 m/s, gallop 19.5 m/s): <= ~0.15 m per step, so the
    // wall BVH rays / colliders never get skipped (no tunnelling), capped at 16 steps per frame.
    const steps = substepsFor(dt);
    let info;
    const before = camera.position.clone();
    if (game.boat && world.mode === "overworld") { if (!game.dead && !storyUI.modal && !wmap.isOpen) boatStep(dt); info = player.readout(); } // round 19
    else if (!game.dead && !storyUI.modal && !wmap.isOpen) for (let k = 0; k < steps; k++) info = player.update(dt / steps);
    else info = player.readout();
    stepGame(dt);
    stepWorld(dt);
    updateExitBtn();
    updateArrows(dt);
    story.update(dt);
    if (STREAM || world.mode === "overworld") chunks.update(streamCtx());
    if (world.mode !== "overworld") colonyUI?.update(); // round 20: hides the settlement button / build bar underground
    if (world.mode === "overworld") tickOverworld(dt, info, now);
    else if (cave) {
    depthEl.textContent = `Depth ${fmt(Math.max(0, info.depth))} m`;
    distEl.textContent = `Travelled ${fmt(info.travelled)} m`;
    revealAround(camera.position);
    const hc0 = game.hint && game.hint.until > game.time && game.hint.mode === "cave" ? game.hint : null;
    const fcv = findCur("cave"), hc = hc0 || (fcv ? { x: fcv.x, z: fcv.z, label: fcv.label, find: true } : null); // round 24b: Find inside a cave
    const ct = hc || (mapFilters.quest ? caveQuestTarget() : null);
    const mo = mapFilters.monsters && game.monster?.alive && game.monster.pos.distanceTo(camera.position) < 25 ? game.monster.pos : null;
    minimap.draw(cave, camera.position, player.yaw, placeShown, explored, { target: ct, monster: mo, labels: mapFilters.labels, t: game.time, others: mp.on ? mp.marks().filter((m) => m.player) : null });
    if (hc) updateCompass(camera.position, false); else if (compassKey !== "off") { compassKey = "off"; compassEl.classList.add("hidden"); }
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
    caveman.light.distance += (TORCH_REACH + 20 * hall - caveman.light.distance) * Math.min(1, dt * 1.5);
    if (!game.fogLock) {
      // A faint cold fill in halls (drip-wet rock catching the torch far off) so the room's size reads.
      game.hallFill = (game.hallFill || 0) + (hall - (game.hallFill || 0)) * Math.min(1, dt * 0.7);
      const hf = game.hallFill;
      // Warm low fill (torch bounce) so far walls read; still torch-dominated.
      ambient.color.setRGB(0.11 + 0.05 * hf, 0.09 + 0.045 * hf, 0.08 + 0.05 * hf);
      ambient.intensity = 1.5 + 1.0 * hf;
    }
    if (!game.fogLock) scene.fog.density += (fogWant - scene.fog.density) * Math.min(1, dt * 0.8);
    {
      // ceiling bounce: only where the roof is high (> ~5 m), scaled by height, tied to the torch
      const f = q && q.floor != null ? q.floor : cp.y - 1.6;
      const hgt = Math.max(0, roomH - 5);
      const torchK = caveman.baseIntensity ? Math.min(1.3, caveman.light.intensity / caveman.baseIntensity) : 0;
      const want = Math.min(20, hgt * 1.6) * torchK;
      ceilBounce.intensity += (want - ceilBounce.intensity) * Math.min(1, dt * 1.5);
      ceilBounce.position.set(cp.x, f + Math.min(roomH * 0.6, 3 + roomH * 0.45), cp.z);
      ceilBounce.distance = 8 + roomH * 1.5;
    }
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
      yaw: game.boat ? game.boat.yaw : player.yaw,
      pitch: player.pitch,
      speed: game.dead ? 0 : animSpeed,
      runFrac: player.runFrac || 0,
      stance: player.stance,
      mounted: !!player.mounted,
      boat: !!game.boat,
      stroke: game.boat && game.boatInp ? Math.max(Math.abs(game.boatInp.fwd), Math.abs(game.boatInp.turn) * 0.7) * (game.boatInp.fwd < -0.1 ? -1 : 1) : 0,
    });
    caveman.root.visible = !game.dead;
    void st;
    mp.update(dt); // round 22
    // Hurt feedback.
    const low = !game.dead && game.health === 1 ? 0.28 + 0.12 * Math.sin(game.time * 4) : 0;
    if (vignetteEl) vignetteEl.style.opacity = String(Math.min(1, Math.max(game.vignette, low)));
    player.fpView = !!game.fp && !player.mounted && !game.boat; player.easeCam?.(dt, (player.speedNow || 0) > 0.3); // round 25e
    updateView(dt);
    if (world.mode === "cave") updateDaylight();
    if (game.camOverride) { const o = game.camOverride; viewCam.position.set(o[0], o[1], o[2]); viewCam.up.set(0, 1, 0); viewCam.lookAt(o[3], o[4], o[5]); }
  } else {
    viewCam.position.copy(camera.position);
    viewCam.quaternion.copy(camera.quaternion);
  }
  caveman.setPixelHeight(renderer.domElement.height);
  tripTick(dt); // round 21
  if (tut) tut.update(dt); // round 24
  padButtons();
  spiritTick(dt); // round 23
  cineTick(dt); // round 24
  if (world.terrain && beacon.key !== beaconKey()) beacon.bind(beaconKey());
  beaconReachCheck(); // round 24
  findTick(now); // round 24b
  if (player) beacon.update(viewCam, feetPos(), (x, z) => world.terrain.height(x, z), ready && world.mode === "overworld" && !spiritCam && !cine?.on && !!world.terrain, now / 1000, gameEl.clientWidth, gameEl.clientHeight);
  if ((trip.on && trip.level > 0.002) || trip.dream > 0) trip.render(renderer, scene, viewCam); else renderer.render(scene, viewCam);
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

// ---------------- Round 19: boats ----------------
function boatNear() {
  if (world.mode !== "overworld" || !world.boats || !player || game.horse || game.boat || game.dead || world.busy) return null;
  return world.boats.near(feetPos());
}
function placeInBoat(b) {
  const st = player.stanceDef();
  camera.position.set(b.x, b.y + (b.bobY || 0) - b.K.draft * 0.45 + b.K.seat + st.eye, b.z);
  player.water = 0;
}
function boardBoat(b) {
  player.setStance("stand");
  game.boat = b; game.myBoat = b; b.taken = true; b.v = 0; b.yr = 0; b.stuckT = 0;
  player.boating = true;
  player.yaw = b.yaw; player.applyLook();
  placeInBoat(b);
  storyUI.toast(IS_TOUCH ? `You climb into the ${b.K.name}. Stick up / down to paddle, left / right to turn; Get out at the shore.` : `You climb into the ${b.K.name}. W / S paddle, A / D turn, Shift pulls hard, E gets out at the shore.`);
  audio.splash?.();
  glog({ e: "board", kind: b.kind, id: b.id });
  return true;
}
/** Step ashore (dry ground within reach; a jetty reaches further). force: the Beach button. */
function leaveBoat(force = false) {
  const b = game.boat; if (!b) return false;
  const B = world.boats, dock = B.docks.find((d) => Math.hypot(d.end.x - b.x, d.end.z - b.z) < 6);
  let L = dock && B.dryOK(dock.shore.x, dock.shore.z) ? dock.shore : B.landing(b.x, b.z, 7); // at a jetty: walk up it to the bank
  if (!L && force) L = B.landing(b.x, b.z, 30);
  if (!L && !force) { storyUI.toast("Too far from the shore. Paddle up to land (or a jetty) to get out."); return false; }
  player.boating = false; game.boat = null; b.taken = false; b.v = 0; b.yr = 0; b.stuckT = 0;
  if (L) player.setTerrain(world.terrain, L.x, L.z, player.yaw);
  else { player.setTerrain(world.terrain, b.x, b.z, player.yaw); rescueToShore("You run the boat aground and wade to the shore."); }
  if (L) storyUI.toast(force ? "You beach the boat and climb out." : "You step out onto the shore.");
  updateBeachBtn(false);
  glog({ e: "leaveBoat", kind: b.kind, force });
  return true;
}
function boatInput() {
  if (game.boatAuto) return game.boatAuto;
  const k = player.keys; let fwd = 0, turn = 0, boost = false;
  if (k.has("KeyW") || k.has("ArrowUp")) fwd += 1;
  if (k.has("KeyS") || k.has("ArrowDown")) fwd -= 1;
  if (k.has("KeyA") || k.has("ArrowLeft")) turn += 1;
  if (k.has("KeyD") || k.has("ArrowRight")) turn -= 1;
  if (fwd > 0) fwd *= (player.pace || 1) >= 3 ? 1 : player.pace === 2 ? 0.8 : 0.6;
  boost = k.has("ShiftLeft") || k.has("ShiftRight");
  if (boost && fwd > 0) fwd = 1;
  if (!fwd && !turn) {
    const j = player.joy;
    if (j && j.active && j.mag >= 0.1) { fwd = Math.max(-1, Math.min(1, -j.dy)); turn = Math.max(-1, Math.min(1, -j.dx)); boost = j.mag > 0.9 && fwd > 0.5; }
    else if (player.pad && player.pad.mag > 0) { fwd = -player.pad.dy; turn = -player.pad.dx; boost = player.pad.run; }
  }
  return { fwd, turn, boost };
}
function boatStep(dt) {
  const b = game.boat;
  if (!player.boating) { b.taken = false; game.boat = null; return; } // teleported / respawned
  player._pollPad?.(dt);
  const inp = boatInput(), y0 = b.yaw, n = Math.max(1, Math.ceil(dt / 0.034));
  for (let i = 0; i < n; i++) world.boats.steer(b, inp, dt / n);
  player.yaw += b.yaw - y0; player.applyLook();
  player.speedNow = Math.abs(b.v);
  game.boatInp = inp;
  placeInBoat(b);
  const ph = Math.floor((caveman.padPh || 0) / Math.PI);
  if (ph !== game.padK) { game.padK = ph; if (Math.abs(inp.fwd) > 0.15 || Math.abs(inp.turn) > 0.3) audio.paddle?.(Math.min(1, Math.abs(b.v) / 4)); }
  if (b.bump) { b.bump = false; game.shake = Math.max(game.shake || 0, 0.12); audio.step?.(0.8, "stand"); }
  updateBeachBtn(b.stuckT > 2.5);
}
let beachBtn = null;
function updateBeachBtn(on) {
  if (!beachBtn) {
    beachBtn = document.createElement("button"); beachBtn.id = "beach-btn"; beachBtn.type = "button"; beachBtn.className = "hidden"; beachBtn.textContent = "⛵ Beach the boat";
    beachBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    beachBtn.addEventListener("click", (e) => { e.stopPropagation(); leaveBoat(true); });
    gameEl.appendChild(beachBtn);
  }
  if (beachBtn._on !== on) { beachBtn._on = on; beachBtn.classList.toggle("hidden", !on); }
}

// ---------------- Round 18: regions (fog / sky tint, region name) and the swim rescue ----------------
const REGION_TINT = { temperate: [0x9aa4a8, 0, 1], red: [0xe0a070, 0.32, 0.85], salt: [0xe8dcc0, 0.28, 0.8], swamp: [0x8a9a70, 0.4, 1.8], alpine: [0xb8c8e0, 0.18, 1.0], tundra: [0xccd6e2, 0.32, 1.3], ocean: [0x9ec0d4, 0.22, 1.1] };
const regionState = { t: 0, col: new THREE.Color(), k: 0, d: 1, tk: 0, td: 1, tcol: new THREE.Color(), name: null, swimT: 0, anc: null, ancT: 0 };
function regionTick(dt, p, t) {
  const R = regionState;
  if (!t.bio) return;
  if ((R.t -= dt) <= 0) {
    R.t = 0.4;
    const w = t.bio.weights(p.x, p.z), tc = new THREE.Color(0, 0, 0); let k = 0, d = 0;
    for (const b of ["temperate", "red", "salt", "swamp", "alpine", "tundra"]) { const [c, kk, dd] = REGION_TINT[b]; tc.r += new THREE.Color(c).r * w[b]; tc.g += new THREE.Color(c).g * w[b]; tc.b += new THREE.Color(c).b * w[b]; k += kk * w[b]; d += dd * w[b]; }
    const sea = Math.max(0, 1 - Math.max(0, w.cd) / 300);
    if (sea > 0) { tc.lerp(new THREE.Color(REGION_TINT.ocean[0]), sea); k += (REGION_TINT.ocean[1] - k) * sea; }
    R.tcol.copy(tc); R.tk = k; R.td = d;
    const name = t.bio.biomeAt(p.x, p.z), nice = { temperate: "", red: "Red-rock canyon country", salt: "The salt flats", swamp: "The marsh", alpine: "The high peaks", tundra: "The frozen north", ocean: "The great water" }[name];
    if (name !== R.name) { if (R.name && nice && world.mode === "overworld") storyUI.toast(nice); R.name = name; }
  }
  const a = Math.min(1, dt * 1.5);
  R.col.lerp(R.tcol, a); R.k += (R.tk - R.k) * a; R.d += (R.td - R.d) * a;
  if (R.k > 0.005) {
    const f = scene.fog.color, lum = (c) => c.r * 0.3 + c.g * 0.55 + c.b * 0.15, l = lum(f), lt = lum(R.col) || 1;
    f.lerp(R.col.clone().multiplyScalar(l / lt), R.k);
    scene.background.copy(f);
  }
  scene.fog.density *= R.d;
  // swimming: a HUD note, and after a long swim / no progress, Kra drags himself to the nearest shore
  const wet = player?.water || 0;
  if (wet > 1.1) {
    R.swimT += dt; R.ancT += dt;
    if (!R.anc || Math.hypot(p.x - R.anc.x, p.z - R.anc.z) > 6) { R.anc = { x: p.x, z: p.z }; R.ancT = 0; }
    if (R.swimT > 60 || R.ancT > 12) rescueToShore("You are tiring in the water. Kra struggles to the shore.");
  } else { R.swimT = 0; R.ancT = 0; R.anc = null; }
  updateSwimBtn(wet > 1.1 && R.swimT > 4);
}
/** Nearest dry, gentle ground (searching outward); places the player there. */
function rescueToShore(msg) {
  const t = world.terrain, p = camera.position;
  for (let r = 4; r < 400; r += 4) for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (t.waterDepth(x, z) > -0.2 || t.slope(x, z).m > 0.5) continue;
    player.setTerrain(t, x, z, player.yaw);
    regionState.swimT = 0; regionState.anc = null;
    storyUI.toast(msg || "Kra hauls himself onto the shore.");
    glog({ e: "rescue", x: +x.toFixed(1), z: +z.toFixed(1) });
    return { x, z };
  }
  return null;
}
let swimBtn = null;
function updateSwimBtn(on) {
  if (!swimBtn) {
    swimBtn = document.createElement("button"); swimBtn.id = "swim-btn"; swimBtn.type = "button"; swimBtn.className = "hidden"; swimBtn.textContent = "🏊 Swim to shore";
    swimBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    swimBtn.addEventListener("click", (e) => { e.stopPropagation(); rescueToShore(); });
    gameEl.appendChild(swimBtn);
  }
  if (swimBtn._on !== on) { swimBtn._on = on; swimBtn.classList.toggle("hidden", !on); }
}

function tickOverworld(dt, info, now) {
  const p = camera.position, t = world.terrain, A = world.atmo;
  const elev = t.height(p.x, p.z);
  depthEl.textContent = game.boat ? `Elevation ${fmt(game.boat.y)} m · in the ${game.boat.K.name}` : `Elevation ${fmt(elev)} m${player?.water > 1.1 ? " · swimming" : player?.water > 0.3 ? " · wading" : ""}`;
  distEl.textContent = `Travelled ${fmt(info.travelled)} m`;
  const camp = world.camp, site = t.act1;
  let extra = null;
  if (site) {
    const F = mapFilters; // round 17: ⚙ filters
    const marks = F.places ? [{ x: site.camp.x, z: site.camp.z, color: camp?.fireLit ? "#ffb050" : "#b08a60", label: story.active ? "Camp" : "" }] : [];
    if (F.places && story.active && story.flags.lumeDead) marks.push({ x: site.pool.x, z: site.pool.z, color: "#9fd4ff", label: "Falls" });
    const dots = F.animals && story.active && story.surv.skills.has("tracking") ? world.wildlife.list.filter((a) => a.alive && a.dist < 140).map((a) => ({ x: a.pos.x, z: a.pos.z, color: a.kind === "deer" || a.kind === "boar" || a.kind === "goat" ? "#e0a060" : "#d8d0c0" })) : [];
    extra = { stream: F.water ? site.stream : null, marks, dots };
  }
  if (t.settlements?.length && mapFilters.towns) {
    extra = extra || { marks: [], dots: [] };
    for (const s of t.settlements) {
      const K = SETTLE_KIND[s.kind], d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > 900) continue;
      extra.marks.push({ x: s.x, z: s.z, color: s.hostile ? "#ff5a4a" : K.color, r: s.kind === "city" ? 0.034 : s.kind === "village" ? 0.026 : 0.018, label: d < 140 ? (s.hostile ? "⚔ " : "") + s.name : "", edge: true });
    }
  }
  if (world.fighters) { const fm = world.fighters.marks(); if (fm.length) { extra = extra || { marks: [], dots: [] }; for (const m of fm) (m.ally ? extra.marks.push(m) : extra.dots.push(m)); } } // round 24b
  // Round 16: quest people + the tracked quest target; the map's fog / trail
  const tgt = story.active ? story.questTarget() : null;
  if (world.places) {
    extra = extra || { marks: [], dots: [] };
    if ((game.npcT = (game.npcT || 0) - dt) <= 0) {
      game.npcT = 0.5;
      for (const [id, g] of Object.entries(world.npcs)) {
        const n = world.places.npc[id], d = Math.hypot(n.x - p.x, n.z - p.z);
        g.visible = d < 170 && (story.active ? story.npcVisible(id) : !NPCS[id].after);
        g.userData.setMark(g.visible && story.active ? story.npcMark(id) : "");
      }
    }
    if (story.active && mapFilters.people) for (const [id, g] of Object.entries(world.npcs)) if (g.visible && g.userData.markCh) { const n = world.places.npc[id]; extra.marks.push({ x: n.x, z: n.z, color: g.userData.markCh === "?" ? "#9fe3a8" : "#ffd36a", r: 0.016 }); }
    if (tgt && mapFilters.quest) extra.marks.push({ x: tgt.x, z: tgt.z, color: "#ff9a5a", r: 0.024, edge: true, label: Math.hypot(tgt.x - p.x, tgt.z - p.z) < 140 ? "◆" : "" });
  }
  game.questTarget = tgt;
  if (wmap.pendingClear) { wmap.pendingClear = false; wmap.clear(mapKey()); }
  wmap.setWorld(t, mapKey());
  wmap.record(p.x, p.z, dt, story.active && story.surv.skills.has("spirit2") ? 2 : 1);
  const hn = game.hint && game.hint.until > game.time && game.hint.mode === "overworld" ? game.hint : null;
  if (hn) { extra = extra || { marks: [], dots: [] }; extra.marks.push({ x: hn.x, z: hn.z, color: "#ffe36a", r: 0.03 + 0.012 * Math.sin(game.time * 6), edge: true, label: "💡" }); }
  if (world.boats && (mapFilters.boats || game.boat)) { // round 19: boats (yours always)
    extra = extra || { marks: [], dots: [] };
    for (const b of world.boats.list) {
      const mine = b === game.boat || b === game.myBoat;
      if (!mine && (!mapFilters.boats || Math.abs(b.x - p.x) > 400 || Math.abs(b.z - p.z) > 400)) continue;
      extra.marks.push({ x: b.x, z: b.z, color: mine ? "#ffe0a0" : "#c8955a", r: mine ? 0.016 : 0.011, label: mine && b !== game.boat ? "⛵" : "" });
    }
  }
  if (world.colony?.list.length && mapFilters.towns) { // round 20: your settlements
    extra = extra || { marks: [], dots: [] };
    for (const c of world.colony.list) extra.marks.push({ x: c.x, z: c.z, color: "#7fe0ff", r: 0.026, edge: true, label: Math.hypot(c.x - p.x, c.z - p.z) < 200 ? c.name : "" });
  }
  if (world.shrooms && mapFilters.places) { // round 21: mushroom patches you have seen
    const sm = world.shrooms.marks(); if (sm.length) { extra = extra || { marks: [], dots: [] }; for (const q of sm) if (Math.abs(q.x - p.x) < 500 && Math.abs(q.z - p.z) < 500) extra.marks.push({ x: q.x, z: q.z, color: "#ff6af0", r: 0.013, label: "🍄" }); }
  }
  if (beacon.pos) { extra = extra || { marks: [], dots: [] }; extra.marks.push({ x: beacon.pos.x, z: beacon.pos.z, color: "#7ff6ff", r: 0.024, edge: true, label: "📍" }); } // round 23
  { const fc = findCur("overworld"); if (fc) { extra = extra || { marks: [], dots: [] }; extra.marks.push({ x: fc.x, z: fc.z, color: "#b6ff5a", r: 0.026, edge: true, arrow: true, label: "🔍" }); } } // round 24b
  if (mp.on) { const pm = mp.marks(); if (pm.length) { extra = extra || { marks: [], dots: [] }; for (const m of pm) extra.marks.push({ x: m.x, z: m.z, color: m.color, r: m.town ? 0.024 : 0.019, edge: true, label: m.label }); } } // round 22: other players
  if (extra) extra.noLabels = !mapFilters.labels;
  minimap.drawOverworld(t, p, player.yaw, mapFilters.caves ? world.discovered : new Set(), extra);
  updateLowHint(info);
  const st = game.timeFrozen ? A.update(0, { eye: viewCam.position, elevation: elev, lights: { sun: moonLight, hemi: skyFill, ambient }, fog: scene.fog, renderer })
    : A.update(dt, { eye: viewCam.position, elevation: elev, lights: { sun: moonLight, hemi: skyFill, ambient }, fog: scene.fog, renderer });
  scene.background.copy(A.fogColor);
  renderer.toneMappingExposure = st.exposure || EXPOSURE; // round 26: daylight exposure (caves reset to EXPOSURE)
  regionTick(dt, p, t);
  world.over.tick(now / 1000, p, A);
  caveman.baseIntensity = TORCH_BASE * st.torch;
  // Round 15: inside a hall or lodge the daylight falls away and your torch takes over (like the caves).
  {
    const sNear = world.settle?.at(p.x, p.z), inK = sNear ? indoorAt(sNear, p.x, p.z) : 0;
    game.indoor = (game.indoor || 0) + (inK - (game.indoor || 0)) * Math.min(1, dt * 3);
    const k = game.indoor;
    if (k > 0.01) {
      moonLight.intensity *= 1 - 0.9 * k; skyFill.intensity *= 1 - 0.85 * k; ambient.intensity *= 1 - 0.65 * k;
      // small lodges: walls sit an arm's length from the torch, so it burns lower there or the hide blows out
      const inHut = sNear?.buildings?.some((b) => b.kind === "hut" && Math.hypot(p.x - b.x, p.z - b.z) < b.r);
      const want = TORCH_BASE * (inHut ? 0.25 : 0.85);
      caveman.baseIntensity += (want - caveman.baseIntensity) * k;
    }
  }
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
    world.wildlife.update(dt, { pos: f, speed: speedSmooth, crouched: player.stance !== "stand" && !player.mounted, running: player.runFrac > 0.4, mounted: !!player.mounted, safe: fightSafe() }, now / 1000);
    if (game.horse) world.wildlife.ride(game.horse, f, player.yaw, animSpeed, dt, now / 1000);
  }
  // Round 12: settlements stream in / out, people go about their day
  let town = null;
  if (world.settle) {
    world.settle.update(dt, p);
    world.people.update(dt, p);
    world.shrooms?.update(dt, p, now / 1000); // round 21
    world.berries?.update(dt, p); // round 23
    const f20 = feetPos(); // round 20: Kra's settlements + talkative townsfolk
    world.colony?.update(dt, f20);
    if (world.colony?.has("defense") && world.wildlife) for (const c of world.colony.list) if (world.colony.count(c, "palisade")) { // round 23: beasts keep out of walled settlements
      const R = world.colony.radius(c) * 0.6;
      for (const a of world.wildlife.list) if (a.alive && !a.ridden && a.kind !== "horse" && a.kind !== "bird") { const dx = a.pos.x - c.x, dz = a.pos.z - c.z, d = Math.hypot(dx, dz); if (d < R && d > 0.01) { a.pos.x = c.x + (dx / d) * R; a.pos.z = c.z + (dz / d) * R; } }
    }
    if (world.colony?.knows("scouting") && (game.scoutT = (game.scoutT || 0) - dt) <= 0) { game.scoutT = 20; scoutReveal(); }
    if (!storyUI.modal && !game.dead) world.talk?.update(dt, f20);
    world.fighters?.update(dt, now / 1000); // round 24b
    updateHornBtn();
    colonyUI?.update();
    town = world.settle.at(p.x, p.z);
    updateCompass(p, town);
    // round 24b: town themes (warm in friendly towns and your own settlement, tense in hostile ones or in a fight)
    const fightNear = world.fighters?.inCombat(f20);
    const ownNear = world.colony?.list.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < world.colony.radius(c) + 10);
    game.townMusic = fightNear || town?.hostile ? "hostile" : town || ownNear ? "friendly" : null;
    // round 25d: how far into the town (0 at ~26 m outside the yard, 1 just inside it), for a smooth crossfade
    { const ns = world.settle.nearest(p.x, p.z), sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      let tf = ns ? sm((ns.s.R + 26 - ns.d) / 30) : 0;
      for (const c of world.colony?.list || []) tf = Math.max(tf, sm((world.colony.radius(c) + 22 - Math.hypot(c.x - p.x, c.z - p.z)) / 26));
      if (fightNear) tf = 1;
      const hostileNear = fightNear || (ns && ns.s.hostile && tf > 0);
      game.townMusic = tf > 0.01 ? (hostileNear ? "hostile" : "friendly") : null; game.townTf = tf; }
  }
  if (game.horse && !player.mounted) { world.wildlife.dismount(game.horse); game.horse = null; } // teleported / respawned
  if (game.boat && !player.boating) { game.boat.taken = false; game.boat = null; updateBeachBtn(false); }
  world.boats?.update(dt, now / 1000, p, game.boat);
  updateMountUI();
  let near = null, nd = Infinity;
  for (const e of t.entrances) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < nd) { nd = d; near = e; } }
  const place = campD < 26 ? "River-Tooth Camp" : near && nd < 28 ? near.name : town ? town.name : "";
  if (place !== placeShown) { placeShown = place; placeEl.textContent = place; placeEl.classList.toggle("show", !!place); }
  const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z) / Math.max(dt, 1e-3);
  lastPos.copy(p);
  speedSmooth += (Math.min(moved, 25) - speedSmooth) * Math.min(1, dt * 3); // round 12: 3x sprint / gallop (was capped 5)
  animSpeed += (Math.min(moved, 25) - animSpeed) * Math.min(1, dt * 10); // was capped 6
  if (audio.started) {
    audio.setEars?.(p, player.yaw);
    audio.setTown?.(cine?.on ? null : game.townMusic || null, game.townTf ?? 1); // round 24b (25d: distance fade)
    const riding = !!player.mounted;
    audio.setAmbience?.({ night: st.night, dawn: st.dawn, day: st.day, rain: st.rain + st.snow * 0.2, wind: st.wind, storm: st.storm, water: Math.max(0, 1 - waterD / 14) });
    const zone = campD < 45 ? (st.dawn > 0.4 ? "dawn" : "camp") : "outdoor";
    audio.setScene({ zone, move: Math.min(1, speedSmooth / 2.3), running: !riding && player.runFrac > 0.45 && speedSmooth > 2.6, runFrac: riding ? 0 : player.runFrac, depth: 0, tight: false, dark: 0.6, threat: 0, monster: false, dt });
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
    // round 24: cutscenes + tutorial
    cine: () => ({ on: !!cine?.on, id: cine?.script?.id, scene: cine?.sceneI, line: cine?.line, log: cine?.log.slice(-40), cam: !!cineCam, cls: gameEl.classList.contains("cine-on"), t: +(cine?.t || 0).toFixed(1) }),
    colonyAge: (n, i = 0) => { world.colony.list[i].age = n; world.colony.save(); return world.colony.maxAge(); },
    questSet: (id, st = "done") => { story.quests.st[id] = st; return story.quests.done(id); }, flagSet: (k, v = true) => { story.flags[k] = v; },
    cineNext: () => cine?.next(), cineSkip: () => cine?.skip(), playIntro: (menu = false) => !!playIntro(menu),
    memory: (k, d = 0.2) => memory(k, d), memPlay: (k) => !!(storyUI.onMemoryReplay(k), cine?.on), memories: () => storyUI.memories(), memSeen: () => memLoad()?.seen || null, memQueue: () => memQueue.map((q) => q.key),
    memScripts: () => [INTRO, ...MEMORIES].map((m) => ({ id: m.id, title: m.title, scenes: m.scenes.length, words: m.scenes.reduce((a, sc) => a + (sc.lines || []).reduce((b, l) => b + (typeof l === "string" ? l : l.text).split(/\s+/).length, 0), 0), lines: m.scenes.reduce((a, sc) => a + (sc.lines || []).length, 0), cards: m.scenes.filter((sc) => sc.card).length })),
    tut: () => tut && ({ on: tut.on, ch: tut.ci, si: tut.si, step: tut.step?.id, done: tut._done, log: tut.log.slice(-30), save: tut.save, hand: !tut.hand.classList.contains("hidden"), c: { ...game.tc } }),
    tutGo: (ci, si = 0) => tut?.go(ci, si), tutSkip: () => tut?.skip(), tutOk: () => tut?.complete(), TG: () => TG,
    torch: () => { toggleTorch(); return caveman.torchDown; }, controls: () => (controlsSheet.open(), controlsSheet.dev),
    talkLume: () => story.talkLume(),
    advance: () => storyUI.advance(),
    give: (id, n = 1) => story.surv.add(id, n),
    // round 16 test hooks
    quests: () => ({ st: { ...story.quests.st }, tracked: story.quests.tracked, target: story.questTarget(), xp: story.surv.xp, sp: story.surv.sp, level: story.surv.level, skills: [...story.surv.skills], recipes: [...story.surv.recipes], wear: [...story.surv.wear], crafted: [...story.surv.crafted], places: world.places && { town: world.places.town.name, hold: world.places.hold.name, camp: world.places.camp.name, cave: world.places.cave?.name, caveId: world.places.cave?.id } }),
    skipAct1: () => { Object.assign(story.flags, { lumeTalked: true, lumeDead: true, fireLit: true, enteredHollow: true, ratKilled: true, ratHarvested: true, faceTaken: true, memory: true, exitedHollow: true, actDone: true }); story.surv.tools.knife = true; story.surv.faces = Math.max(1, story.surv.faces); story.surv.tools.spear = true; story.surv.tools.spearDone = true; story.surv.slots = 12; story.surv.crafted.add("backpack"); game.armed = true; caveman.setWeapon("spear", true); story.lumeDies(); return true; },
    npcs: () => world.places && Object.fromEntries(Object.entries(world.places.npc).map(([id, n]) => [id, { x: +n.x.toFixed(2), z: +n.z.toFixed(2), name: n.name, visible: world.npcs[id].visible, mark: world.npcs[id].userData.markCh || "" }])),
    toNPC: (id, d = 1.6) => { const n = world.places.npc[id]; const a = n.yaw; const x = n.x + Math.sin(a) * d, z = n.z + Math.cos(a) * d; player.setStance("stand"); player.setTerrain(world.terrain, x, z, Math.atan2(-(n.x - x), -(n.z - z))); player.pitch = -0.05; player.applyLook(); return { x, z }; },
    tp: (x, z, yaw = 0) => { player.setTerrain(world.terrain, x, z, yaw); return true; },
    learn: (id) => { story.panelAction("learn", id); return story.surv.skills.has(id); },
    craft: (id) => { story.panelAction("craft", id); return story.surv.crafted.has(id); },
    wear: (id) => { story.panelAction("wear", id); return story.surv.wear.has(id); },
    map: (on = true) => { if (on) openMap(); else wmap.close(); return { open: wmap.isOpen, revealed: wmap.revealedCount(), trail: wmap.trail.length }; },
    hint: () => { const h = showObjectiveHint(); return h && { label: h.label, text: h.text, x: +h.x.toFixed(1), z: +h.z.toFixed(1), mode: h.mode, compass: !compassEl.classList.contains("hidden") ? compassEl.textContent : null }; },
    filters: (o) => { if (o) { for (const [k, v] of Object.entries(o)) mapFilters[k] = v; localStorage.setItem("fota-mapfilters-v1", JSON.stringify(mapFilters)); } return { ...mapFilters }; },
    // round 18: regions
    biome: (x, z) => { const t = world.terrain, c = camera.position; x = x ?? c.x; z = z ?? c.z; const w = t.bio.weights(x, z); return { name: t.biomeAt(x, z), h: +t.height(x, z).toFixed(1), water: t.waterAt(x, z), depth: +t.waterDepth(x, z).toFixed(2), w: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(2)])), swim: player.water || 0 }; },
    findBiome: (name, minR = 900) => { const t = world.terrain; for (let r = minR; r < 3100; r += 60) for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r; const w = t.bio.weights(x, z); if ((name === "ocean" ? w.cd < -200 : w[name] > 0.9 && w.sea < 0.01) && (name === "ocean" || t.waterDepth(x, z) < -0.3) && t.slope(x, z).m < 0.5) return { x: +x.toFixed(1), z: +z.toFixed(1) }; } return null; },
    rivers: () => world.terrain.bio.rivers.map((r) => ({ id: r.id, n: r.pts.length, end: r.end, a: [Math.round(r.pts[0].x), Math.round(r.pts[0].z)], b: [Math.round(r.pts.at(-1).x), Math.round(r.pts.at(-1).z)] })),
    lakes: () => world.terrain.bio.lakes.map((l) => ({ x: Math.round(l.x), z: Math.round(l.z), r: Math.round(l.r), y: +l.y.toFixed(1) })),
    riverPt: (id, i) => { const r = world.terrain.bio.rivers[id]; const q = r.pts[Math.min(r.pts.length - 1, i)]; return { x: q.x, z: q.z, y: q.y, n: r.pts.length }; },
    rescue: () => rescueToShore(),
    // round 19: boats
    boats: () => { const c = camera.position; return { planMs: +(world.boats?.planMs || 0).toFixed(1), docks: world.boats?.docks.length || 0, list: (world.boats?.list || []).map((b) => ({ id: b.id, kind: b.kind, home: b.home, x: +b.x.toFixed(1), z: +b.z.toFixed(1), taken: b.taken, w: b.wkind, d: +Math.hypot(b.x - c.x, b.z - c.z).toFixed(0) })) }; },
    toBoat: (id) => { const b = world.boats.list[id]; if (!b) return null; const L = b.dock ? { ...b.dock, d: Math.hypot(b.dock.x - b.x, b.dock.z - b.z) } : world.boats.landing(b.x, b.z, 14); if (!L) return null; player.setTerrain(world.terrain, L.x, L.z, Math.atan2(-(b.x - L.x), -(b.z - L.z))); return { x: +L.x.toFixed(1), z: +L.z.toFixed(1), d: +L.d.toFixed(1), near: !!boatNear(), btn: (updateMountUI(), mountShown) }; },
    board: () => { const b = boatNear(); return b ? boardBoat(b) && { id: b.id, kind: b.kind, btn: (updateMountUI(), mountShown) } : null; },
    boatState: () => { const b = game.boat; if (!b) return null; return { id: b.id, kind: b.kind, x: +b.x.toFixed(1), z: +b.z.toFixed(1), v: +b.v.toFixed(2), speed: +(b.speed || 0).toFixed(2), yaw: +b.yaw.toFixed(2), water: b.wkind, depth: +world.boats.depth(b.x, b.z).toFixed(2), stuck: +(b.stuckT || 0).toFixed(1), beach: !!beachBtn?._on, btn: mountShown, eyeAbove: +(camera.position.y - b.y).toFixed(2) }; },
    boatDrive: (fwd = 0, turn = 0, boost = false) => { game.boatAuto = fwd || turn ? { fwd, turn, boost } : null; return true; },
    /** Steer toward (x, z) for up to `secs` (sim, 1/30 s steps); returns path stats. */
    boatTo: (x, z, secs = 60, boost = false) => {
      const b = game.boat; if (!b) return null;
      let t = 0, dry = 0, maxStuck = 0; const dt = 1 / 30;
      while (t < secs) {
        const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz); if (d < 6) break;
        const want = Math.atan2(-dx, -dz), da = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
        game.boatAuto = { fwd: Math.abs(da) > 1.2 ? 0.2 : 1, turn: Math.max(-1, Math.min(1, da * 2)), boost };
        boatStep(dt); world.boats.update(dt, t, camera.position, b); t += dt;
        if (world.boats.depth(b.x, b.z) < b.K.draft * 0.9) dry++;
        maxStuck = Math.max(maxStuck, b.stuckT || 0);
      }
      game.boatAuto = null;
      return { t: +t.toFixed(1), x: +b.x.toFixed(1), z: +b.z.toFixed(1), left: +Math.hypot(x - b.x, z - b.z).toFixed(1), dry, maxStuck: +maxStuck.toFixed(1), beach: !!beachBtn?._on };
    },
    /** Drift / paddle along for `secs` with fixed input (sim); returns distance and how far it went along a river's flow. */
    boatSim: (fwd = 0, turn = 0, secs = 10) => {
      const b = game.boat; if (!b) return null;
      const x0 = b.x, z0 = b.z, dt = 1 / 30; let dry = 0, kinds = new Set();
      game.boatAuto = { fwd, turn, boost: false };
      for (let t = 0; t < secs; t += dt) { boatStep(dt); kinds.add(b.wkind); if (world.boats.depth(b.x, b.z) < b.K.draft * 0.9) dry++; }
      game.boatAuto = null;
      return { moved: +Math.hypot(b.x - x0, b.z - z0).toFixed(1), x: +b.x.toFixed(1), z: +b.z.toFixed(1), dry, kinds: [...kinds], stuck: +(b.stuckT || 0).toFixed(1) };
    },
    /** Paddle down the nearest river for `secs` (steering along its centre line, sim). */
    boatDownRiver: (secs = 30, fwd = 0.5) => {
      const b = game.boat; if (!b) return null;
      const R = world.terrain.bio.rivers, dt = 1 / 30, x0 = b.x, z0 = b.z; let dry = 0, maxStuck = 0, run = 0, cur = 0;
      for (let t = 0; t < secs; t += dt) {
        let best = null; for (const r of R) for (let i = 0; i < r.pts.length; i += 2) { const q = r.pts[i], d = Math.abs(q.x - b.x) + Math.abs(q.z - b.z); if (!best || d < best.d) best = { d, r, i }; }
        const tg = best.r.pts[Math.min(best.r.pts.length - 1, best.i + 6)];
        const want = Math.atan2(-(tg.x - b.x), -(tg.z - b.z)), da = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
        game.boatAuto = { fwd, turn: Math.max(-1, Math.min(1, da * 2)), boost: false };
        const px = b.x, pz = b.z; boatStep(dt);
        const w = world.boats.water(b.x, b.z); if (w && w.kind === "river") cur += ((b.x - px) * w.fx + (b.z - pz) * w.fz);
        if (world.boats.depth(b.x, b.z) < b.K.draft * 0.9) dry++;
        maxStuck = Math.max(maxStuck, b.stuckT || 0); run = t;
      }
      game.boatAuto = null;
      return { moved: +Math.hypot(b.x - x0, b.z - z0).toFixed(1), downstream: +cur.toFixed(1), x: +b.x.toFixed(1), z: +b.z.toFixed(1), water: b.wkind, dry, maxStuck: +maxStuck.toFixed(1) };
    },
    diagAt: (x, z) => { const t = world.terrain; return { cols: t.collidersNear(x, z, 3).map((c) => ({ x: +c.x?.toFixed(1), z: +c.z?.toFixed(1), r: +(c.r || c.t || 0).toFixed(2), top: c.top, seg: !!c.seg })), h: +t.height(x, z).toFixed(2), wd: +t.waterDepth(x, z).toFixed(2), block: player.lastBlock, eye: +(camera.position.y - t.height(camera.position.x, camera.position.z)).toFixed(2), pos: [+camera.position.x.toFixed(2), +camera.position.z.toFixed(2)] }; },
    fords: () => { const t = world.terrain, out = []; for (const r of t.bio.rivers) for (const f of r.fords || []) { const rv = t.bio.river(f.x, f.z); out.push({ x: +f.x.toFixed(1), z: +f.z.toFixed(1), depth: +t.waterDepth(f.x, f.z).toFixed(2), w: +rv.w.toFixed(1), fx: rv.fx, fz: rv.fz, nx: -rv.fz, nz: rv.fx }); } return out; },
    raftKit: () => { const s = story.surv; s.tools.knife = true; s.skills.add("surv1"); s.slots = 12; s.add("sinew", 2); return true; },
    interactNow: (go = true) => { const i = story.findInteraction(); if (i && go) i.act(); return i?.label || null; },
    treesNear: (r = 60) => { const c = camera.position, t = world.terrain, out = []; for (let cx = Math.floor((c.x - r) / 64); cx <= Math.floor((c.x + r) / 64); cx++) for (let cz = Math.floor((c.z - r) / 64); cz <= Math.floor((c.z + r) / 64); cz++) for (const q of t.scatter(cx, cz).trees) if (q.type <= 3 && Math.hypot(q.x - c.x, q.z - c.z) < r) out.push({ x: q.x, z: q.z, d: Math.hypot(q.x - c.x, q.z - c.z) }); return out.sort((a, b) => a.d - b.d).slice(0, 4); },
    leaveBoat: (force = false) => { const r = leaveBoat(force); const c = camera.position; return { ok: r, boating: !!game.boat, x: +c.x.toFixed(1), z: +c.z.toFixed(1), depth: +world.terrain.waterDepth(c.x, c.z).toFixed(2) }; },
    riverPts: (id) => world.terrain.bio.rivers[id]?.pts.filter((_, i) => i % 10 === 0).map((p) => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), w: +p.w.toFixed(1) })) || null,
    placesCheck: () => { const t = world.terrain, out = []; const chk = (name, x, z) => out.push([name, t.biomeAt(x, z), +t.waterDepth(x, z).toFixed(2), Math.round(Math.hypot(x, z))]);
      for (const q of t.settlements) chk(q.name, q.x, q.z); for (const e of t.entrances) chk(e.name, e.x, e.z); if (t.act1) chk("camp", t.act1.camp.x, t.act1.camp.z);
      for (const [k, v] of Object.entries(world.places || {})) if (v && v.x != null) chk(k, v.x, v.z); else if (v && typeof v === "object") for (const [k2, v2] of Object.entries(v)) if (v2?.x != null) chk(k + "." + k2, v2.x, v2.z);
      return out.filter((r) => r[1] !== "temperate" || r[2] > -0.3); },
    heightBench: () => { const t = world.terrain, t0 = performance.now(); let s = 0; for (let i = 0; i < 20000; i++) s += t.height((i * 37.1) % 6000 - 3000, (i * 91.7) % 6000 - 3000); return +((performance.now() - t0) / 20).toFixed(2); },
    hintState: () => game.hint && { ...game.hint, left: +(game.hint.until - game.time).toFixed(1), compass: compassEl.classList.contains("hidden") ? null : compassEl.textContent },
    hunter: () => story.hunter && { x: +story.hunter.x.toFixed(2), y: +story.hunter.y.toFixed(2), z: +story.hunter.z.toFixed(2), glow: !!story.hunter.glow },
    mapView: (cx, cz, s) => { Object.assign(wmap.view, { cx, cz, s }); wmap.draw(); },
    exitCave: (confirm = true) => { askExitCave(); if (confirm) { const b = storyUI.choice.querySelector('.opt[data-id="go"]'); b?.click(); return !!b; } return true; },
    exitBtn: () => !exitBtn.classList.contains("hidden"),
    health: () => ({ health: game.health, max: game.maxHealth }),
    frontCam: (d = 2.4, on = true) => { if (!on) { game.camOverride = null; return; } const c = camera.position, y = player.yaw, fx = -Math.sin(y), fz = -Math.cos(y); game.camOverride = [c.x + fx * d + fz * 0.6, c.y - 0.15, c.z + fz * d - fx * 0.6, c.x, c.y - 0.5, c.z]; },
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
    // ---- round 12 hooks
    settlements: () => world.terrain?.settlements.map((q) => ({ id: q.id, kind: q.kind, name: q.name, x: +q.x.toFixed(1), z: +q.z.toFixed(1), R: q.R, huts: q.huts.length, tents: q.tents.length, posts: q.posts.length, racks: q.racks.length, fires: q.fires.length, lake: !!q.lake, built: !!world.settle?.groups.has(q.id) })),
    gotoSettle: (i, dist = null, ang = 0.6, pitch = -0.12) => {
      const q = world.terrain.settlements[i]; if (!q) return false;
      const d = dist ?? q.R + 14, x = q.x + Math.cos(ang) * d, z = q.z + Math.sin(ang) * d;
      if (game.horse) toggleMount(true);
      player.setTerrain(world.terrain, x, z, Math.atan2(-(q.x - x), -(q.z - z)));
      player.pitch = pitch; player.applyLook();
      return { x, z };
    },
    // round 20: settlements + talk
    colony: () => { const C = world.colony; if (!C) return null; return { list: C.list.map((c) => ({ id: c.id, name: c.name, x: Math.round(c.x), z: Math.round(c.z), age: c.age, ageName: COL_AGES[c.age].name, res: Object.fromEntries(Object.entries(c.res).map(([k, v]) => [k, Math.floor(v)])), blds: c.blds.map((b) => b.type + (b.built < 1 ? ":" + b.built.toFixed(2) : "")), vill: c.vill.map((v) => v.name + "/" + v.job), techs: c.techs })), agents: C.agents.map((a) => ({ n: a.v.name, job: a.v.job, phase: a.phase, x: +a.p.x.toFixed(1), z: +a.p.z.toFixed(1), carry: !!a.p.carry, trips: a.trips || 0, node: a.node ? { x: Math.round(a.node.x), z: Math.round(a.node.z) } : null })), log: C.log.slice(-12), lock: colonyLock(), btn: colonyUI?.btn._w, mode: colonyUI?.mode }; },
    foundSpot: (r0 = 0, r1 = 400) => { const f = feetPos(); for (let r = r0; r <= r1; r += 12) for (let a = 0; a < 6.28; a += 0.4) { const x = Math.round(f.x + Math.cos(a) * r), z = Math.round(f.z + Math.sin(a) * r); if (!world.colony.canFound(x, z)) return { x, z }; } return null; },
    found: (x, z) => { const why = world.colony.canFound(x, z); if (why) return why; return world.colony.found(x, z).name; },
    placeSpot: (type, rot = 0, i = 0) => { const C = world.colony, c = C.list[i]; for (let r = 6; r < C.radius(c); r += 2) for (let a = 0; a < 6.28; a += 0.3) { for (let k = 0; k < 4; k++) { const x = Math.round(c.x + Math.cos(a) * r), z = Math.round(c.z + Math.sin(a) * r), ro = type === "dock" ? k * Math.PI / 2 : rot; if (!C.canPlace(c, type, x, z, ro)) return { x, z, rot: ro }; if (type !== "dock") break; } } return null; },
    place: (type, x, z, rot = 0, i = 0) => world.colony.place(world.colony.list[i], type, x, z, rot),
    canPlace: (type, x, z, rot = 0, i = 0) => world.colony.canPlace(world.colony.list[i], type, x, z, rot),
    giveRes: (o, i = 0) => { const c = world.colony.list[i]; for (const [k, v] of Object.entries(o)) c.res[k] = (c.res[k] || 0) + v; world.colony.save(); return c.res; },
    recruitNear: (n = 1, i = 0) => { const C = world.colony, c = C.list[i], f = feetPos(), out = []; const ps = world.people.list.filter((p) => p.ident && !p.ext).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z)); for (const p of ps.slice(0, n)) { if (!C.hasRoom(c)) break; const m = world.talk.m(p); m.joined = 1; C.recruit(c, p.ident); world.people.remove(p); out.push(p.ident.name); } world.talk.save(); return out; },
    setJob: (k, job, i = 0) => world.colony.setJob(world.colony.list[i].vill[k].vid, job),
    colonyFF: (sec) => { world.colony.ff(sec); return world.colony.list.map((c) => ({ res: c.res, built: c.blds.filter((b) => b.built >= 1).length })); },
    colonyAdvance: (i = 0) => { const c = world.colony.list[i]; const k = world.colony.ageCheck(c); return world.colony.advance(c) ? COL_AGES[c.age].name : k.lines.filter((l) => !l[1]).map((l) => l[0]); },
    learnTech: (id, i = 0) => world.colony.learnTech(world.colony.list[i], id) || world.colony.techCheck(world.colony.list[i], id),
    colonyPanel: (i = 0) => colonyUI.open(world.colony.list[i]),
    buildMode: (type, i = 0) => { colonyUI.start("build", world.colony.list[i]); if (type) colonyUI.pick(type); colonyUI.update(); return colonyUI.bar.querySelector(".bb-status").textContent; },
    colonyReload: () => { try { world.colony.load(JSON.parse(localStorage.getItem(world.colony.env.key())), true); return world.colony.list.length; } catch (e) { return String(e.stack).slice(0, 400); } },
    clearColony: () => { world.colony.clear(); world.colony.save(); },
    talkNear: () => { const n = world.people.nearest(feetPos().x, feetPos().z); if (!n) return null; world.talk.talk(n.p); return { name: n.p.ident.name, voice: n.p.ident.voice, trait: n.p.ident.trait, ext: !!n.p.ident.ext, d: +n.d.toFixed(1) }; },
    peopleNear: (n = 8) => { const f = feetPos(); return world.people.list.filter((p) => p.ident).map((p) => ({ name: p.ident.name, voice: p.ident.voice, ext: !!p.ident.ext, x: +p.x.toFixed(1), z: +p.z.toFixed(1), d: +Math.hypot(p.x - f.x, p.z - f.z).toFixed(1) })).sort((a, b) => a.d - b.d).slice(0, n); },
    trip: () => ({ on: trip.on, t: +trip.t.toFixed(1), level: +trip.level.toFixed(2), phase: trip.phase, melt: +trip_MELT().toFixed(2), visions: visions.list.map((v) => v.kind), spawned: visions.n, music: tripMusic.on, calm: calmOn, btn: !tripBtn.classList.contains("hidden") }),
    /** Round 23 QoL test hooks: beacon, fast travel, audio mixer. */
    qol: {
      find: (cat) => finder.find(cat), findNext: () => finder.next(), findClear: () => finder.clear(), findCur: () => finder.cur && { ...finder.cur, live: !!finder.cur.live, gone: undefined, cave: undefined, d: +finder.cur.d.toFixed(1) },
      findList: (cat) => finder.search(cat).slice(0, 5).map((c) => ({ label: c.label, x: +c.x.toFixed(1), z: +c.z.toFixed(1), d: +c.d.toFixed(1) })), findNeed: () => finder.needed(), findOpen: () => finder.isOpen, openFind: () => finder.open(), lastFound: () => finder.lastFound || null,
      isShroom: (x, z) => !!world.shrooms?.spots.some((q) => Math.hypot(q.x - x, q.z - z) < 0.5 && world.shrooms.available(q)),
 overlays: () => overlays.state(), uiSay: (t) => storyUI.say([{ who: "Test", text: t }, { who: "Test", text: t + " 2" }]), uiAsk: (c = true) => storyUI.ask("Test", "Pick one", [{ id: "a", label: "A" }], () => {}, c), closeTop: () => overlays.closeTop("test"), closeAll: () => overlays.closeAll("test"),
      fighters: () => world.fighters?.state(), bags: () => (world.fighters?.bags || []).map((g) => ({ x: +g.x.toFixed(2), z: +g.z.toFixed(2), who: g.who, loot: g.loot })), horn: () => blowHorn(), hornBtn: () => !hornBtn.classList.contains("hidden") && hornBtn.textContent, hornReset: () => { world.fighters.hornCd = 0; },
      hostile: () => (world.terrain?.settlements || []).filter((q) => q.hostile).map((q) => ({ id: q.id, name: q.name, kind: q.kind, age: q.age, x: +q.x.toFixed(1), z: +q.z.toFixed(1), R: q.R, d: +Math.hypot(q.x - feetPos().x, q.z - feetPos().z).toFixed(0) })),
      towns: () => (world.terrain?.settlements || []).map((q) => ({ id: q.id, name: q.name, kind: q.kind, hostile: !!q.hostile, age: q.age, x: +q.x.toFixed(1), z: +q.z.toFixed(1), R: q.R })),
      townRms: () => { const tm = audio.townMusic; if (!tm) return null; if (!tm._an) { tm._an = {}; for (const k in tm.layers) { const an = audio.ctx.createAnalyser(); an.fftSize = 2048; tm.layers[k].g.connect(an); tm._an[k] = an; } } const o = {}; for (const k in tm._an) { const d = new Float32Array(2048); tm._an[k].getFloatTimeDomainData(d); o[k] = +Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length).toFixed(4); } return o; },
      mixRms: () => { // round 25d: RMS of each layer of the mix (after its own gain, before the sliders)
        const nodes = { score: audio.scoreBus, town: audio.townMusic?.out, townAmb: audio.townAmb?.out, wild: audio.wildGain, worldAmb: audio.outGain, sfx: audio.master, musicBus: audio.musicBus, ambBus: audio.ambBus };
        audio._an = audio._an || {}; const o = {};
        for (const k in nodes) { const n = nodes[k]; if (!n) continue; if (!audio._an[k]) { const an = audio.ctx.createAnalyser(); an.fftSize = 4096; n.connect(an); audio._an[k] = an; }
          const d = new Float32Array(4096); audio._an[k].getFloatTimeDomainData(d); o[k] = +Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length).toFixed(4); }
        return { ...o, tf: +(game.townTf || 0).toFixed(2), mode: game.townMusic || null, gains: { score: +audio.scoreBus?.gain.value.toFixed(3), town: +audio.townMusic?.layers.friendly.g.gain.value.toFixed(3), townH: +audio.townMusic?.layers.hostile.g.gain.value.toFixed(3), townAmb: +audio.townAmb?.out.gain.value.toFixed(3), wild: +audio.wildGain?.gain.value.toFixed(3), sfx: +audio.master?.gain.value.toFixed(3), music: +audio.musicBus?.gain.value.toFixed(3), amb: +audio.ambBus?.gain.value.toFixed(3) } };
      },
      townMusic: () => ({ want: game.townMusic || null, audio: audio.town ?? null, mode: audio.townMusic?.mode ?? null, started: !!audio.started }),
      spawnPred: (kind, d = 20, n = 1) => { const f = feetPos(), fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); return world.wildlife.spawnAt(kind, f.x + fx * d, f.z + fz * d, n).map((a) => a.id); },
      preds: () => world.wildlife.list.filter((a) => a.kind === "wolf" || a.kind === "bear").map((a) => ({ id: a.id, kind: a.kind, state: a.state, alive: a.alive, hp: a.health, x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2), d: +Math.hypot(a.pos.x - feetPos().x, a.pos.z - feetPos().z).toFixed(1) })),
      wildLog: () => world.wildlife.log.slice(-40), wildFreeze: (v) => { world.wildlife.freeze = !!v; }, spawnAnimal: (kind, x, z, yaw) => world.wildlife.spawnAt(kind, x, z, 1, yaw)[0].id, wdbg: () => world.wildlife.list.filter((a) => a.kind === "wolf" || a.kind === "bear").map((a) => ({ pos: a.pos.toArray().map((v) => +v.toFixed(2)), yaw: a.yaw, st: a.spec.st?.speed, s: a.state, T: a.stateT, sc: a.scared, cd: a.cd })),
      health: () => ({ hp: game.health, max: game.maxHealth, dead: game.dead }),
      safe: () => fightSafe(),
      findMark: () => ({ pillar: findMark.group.visible, pos: findMark.pos, hud: findMark.el.classList.contains("hidden") ? null : findMark.el.textContent }),
      beacon: () => beacon.pos, beaconArm: () => beaconArm, setBeacon: (x, z) => beacon.set(x, z), clearBeacon: () => beacon.clear(),
      beaconHud: () => ({ shown: !beacon.el.classList.contains("hidden"), text: beacon.el.textContent, left: beacon.el.style.left, top: beacon.el.style.top, pillar: beacon.group.visible, k: +beacon.group.scale.x.toFixed(3) }),
      targets: () => travelTargets().map((d) => ({ kind: d.kind, name: d.name, x: Math.round(d.x), z: Math.round(d.z) })),
      block: () => travelBlock(), travel: (i) => fastTravel(travelTargets()[i]), travelling: () => travelling,
      tapItems: (x, z, scale = 1) => (wmap.onTap({ x, z, scale, mode: world.mode }) || []).map((i) => ({ label: i.label, disabled: !!i.disabled, note: !!i.note })),
      tapAt: (x, z) => { const v = wmap.view, px = (x - v.cx) * v.s + wmap.cv.clientWidth / 2, py = (z - v.cz) * v.s + wmap.cv.clientHeight / 2; wmap._tap(px, py); return [...(wmap._pop?.querySelectorAll("button, .wm-note") || [])].map((b) => b.textContent); },
      mapView: () => ({ ...wmap.view }),
      openMap: () => openMap(), closeMap: () => wmap.close(),
      feet: () => { const f = feetPos(); return { x: +f.x.toFixed(1), z: +f.z.toFixed(1), mounted: !!player.mounted, mode: world.mode }; },
      audio: () => ({ vol: { ...audio.vol }, out: audio.out?.gain.value, fx: audio.master?.gain.value, music: audio.musicBus?.gain.value, amb: audio.ambBus?.gain.value, voice: audio.voiceBus?.gain.value, speech: audio.speechVol, ctx: audio.ctx?.state, comp: !!audio.comp, lim: !!audio.limiter }),
      surv: () => { const s = story.surv; return { hunger: +s.hunger.toFixed(2), thirst: +s.thirst.toFixed(2), stamina: +s.stamina.toFixed(2) }; },
    },
    vision: { start: (n) => startVision(n), on: () => !!spirit?.on, line: () => spirit?.on ? { i: spirit.i, who: spirit.current?.who, text: spirit.current?.text, card: !spirit.el.querySelector(".sp-card").classList.contains("hidden") } : null, skip: () => spirit?.skip(), pending: () => visionPending,
      know: () => JSON.parse(JSON.stringify(world.colony?.know || null)), learn: (id) => { const ok = world.colony.learn(id); if (ok) applyInsight(id); return ok; }, policy: (id, on) => world.colony.setPolicy(id, on), rates: (i = 0) => world.colony.list[i] ? world.colony.rates(world.colony.list[i]) : null, scout: () => scoutReveal(), dream: () => trip.dream, col: () => world.colony, revealed: () => wmap.revealedCount() }, // round 23
    tripStart: () => startTrip(), tripSkip: (t) => { trip.t = t; return trip.phase; }, tripEnd: () => endTrip(), setCalm: (v) => setCalm(v),
    eatShroom: () => eatShroom(),
    berries: () => ({ n: world.berries.spots.length, kinds: world.berries.spots.reduce((o, q) => ((o[q.kind] = (o[q.kind] || 0) + 1), o), {}), live: world.berries.live.size, camp: world.terrain.act1?.bushes.length, creeks: world.terrain.bio.creekCount, rivers: world.terrain.bio.rivers.length }),
    nearestBerry: () => { const f = feetPos(); return world.berries.spots.filter((q) => !q.bad && world.berries.available(q)).map((q) => ({ ...q, d: Math.hypot(q.x - f.x, q.z - f.z) })).sort((a, b) => a.d - b.d)[0]; },
    shrooms: () => (world.shrooms ? { n: world.shrooms.spots.length, kinds: world.shrooms.spots.reduce((o, q) => ((o[q.kind] = (o[q.kind] || 0) + 1), o), {}), seen: world.shrooms.marks().length, live: world.shrooms.live.size, near: world.shrooms.spots.find((q) => q.near) || null } : null),
    nearestShroom: () => { const f = feetPos(); return world.shrooms.spots.filter((q) => world.shrooms.available(q)).map((q) => ({ ...q, d: Math.hypot(q.x - f.x, q.z - f.z) })).sort((a, b) => a.d - b.d)[0]; },
    pickups: () => story.pickups.map((k) => ({ id: k.id, ore: !!k.ore, taken: k.taken, x: +k.x.toFixed(1), y: +k.y.toFixed(1), z: +k.z.toFixed(1) })),
    toPickup: (i) => { const k = story.pickups[i]; if (!k) return null; player.placeWorld(k.x + 0.6, k.y + 0.05, k.z + 0.6); return true; },
    setTool: (k, v = true) => { story.surv.tools[k] = v; return story.surv.tools; },
    count: (id) => story.surv.count(id),
    talkLog: () => world.talk.log.slice(-20), talkMem: () => world.talk.mem,
    people: () => ({ count: world.people?.list.length || 0, visible: world.people?.visible || 0, cap: world.people?.cap, states: world.people?.list.reduce((o, p) => ((o[p.state] = (o[p.state] || 0) + 1), o), {}), carrying: world.people?.list.filter((p) => p.carry).length }),
    nearestPerson: () => { const n = world.people?.nearest(camera.position.x, camera.position.z); return n && { x: n.p.x, z: n.p.z, d: +n.d.toFixed(2), state: n.p.state }; },
    settleDraws: () => world.settle?.drawCalls(),
    horses: () => world.wildlife?.list.filter((a) => a.kind === "horse").map((a) => ({ id: a.id, alive: a.alive, ridden: !!a.ridden, state: a.state, d: +(a.dist ?? -1).toFixed(1), x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1) })),
    /** Walk up to the nearest live horse (stand 2 m away facing it); mount=true also gets on. */
    /** Round 15 test hook: follow waypoints [{x,z}] with keys held; returns stuck frames / misses. */
    walkPath: (pts, { keys = ["KeyW"], jumpEvery = 0, reach = 1.2, dt = 1 / 60, place = true } = {}) => {
      const P = player, c = camera.position;
      if (place) P.setTerrain(world.terrain, pts[0].x, pts[0].z, Math.atan2(-(pts[1].x - pts[0].x), -(pts[1].z - pts[0].z)));
      let frames = 0, stuck = 0, run = 0, maxRun = 0, miss = 0, f = 0, maxWet = 0, swimF = 0; const at = [];
      for (let w = 1; w < pts.length; w++) {
        const b = pts[w]; let ok = false;
        for (let i = 0; i < 3000; i++) {
          const dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz);
          if (d < reach) { ok = true; break; }
          P.yaw = Math.atan2(-dx / d, -dz / d);
          P.keys.clear(); for (const k of keys) P.keys.add(k);
          if (jumpEvery && f % jumpEvery === 0) P.jump();
          const x0 = c.x, z0 = c.z;
          const ns = substepsFor(dt); for (let j = 0; j < ns; j++) P.update(dt / ns);
          if (game.horse) world.wildlife.ride(game.horse, feetPos(), P.yaw, P.speedNow, dt, f * dt);
          f++; frames++;
          if ((P.water || 0) > maxWet) maxWet = P.water; if ((P.water || 0) > 1.1) swimF++;
          const mv = Math.hypot(c.x - x0, c.z - z0);
          if (frames > 30 && mv < P.speedNow * dt * 0.25) { stuck++; run++; if (run === 20) at.push([+c.x.toFixed(1), +c.z.toFixed(1)]); } else run = 0;
          maxRun = Math.max(maxRun, run);
          if (run > 240) break;
        }
        if (!ok) { miss++; break; }
      }
      P.keys.clear();
      return { frames, stuck, maxRun, miss, at: at.slice(0, 4), end: [+c.x.toFixed(1), +c.z.toFixed(1)], maxWet: +maxWet.toFixed(2), swimS: +(swimF * dt).toFixed(1) };
    },
    settleData: (id) => { const s = world.terrain.settlements[id]; return s && { x: s.x, z: s.z, R: s.R, kind: s.kind, name: s.name, paths: s.paths, fires: s.fires, lake: s.lake, longhouse: s.longhouse, buildings: s.buildings, posts: s.posts.length }; },
    indoor: () => +(game.indoor || 0).toFixed(2),
    toHorse: (mount = false) => {
      const n = world.wildlife?.list.filter((a) => a.kind === "horse" && a.alive && !a.ridden).sort((a, b) => a.pos.distanceTo(camera.position) - b.pos.distanceTo(camera.position))[0];
      if (!n) return null;
      const x = n.pos.x + 2, z = n.pos.z + 0.5;
      player.setTerrain(world.terrain, x, z, Math.atan2(-(n.pos.x - x), -(n.pos.z - z)));
      if (mount) toggleMount();
      return { id: n.id, mounted: !!game.horse };
    },
    mount: () => (canToggleMount() ? toggleMount() : false),
    mounted: () => ({ mounted: !!player.mounted, horse: game.horse?.id || null, eye: +(camera.position.y - world.terrain.height(camera.position.x, camera.position.z)).toFixed(2), speed: +(player.speedNow || 0).toFixed(2), btn: mountShown }),
    /** Deterministic movement sim (headless FPS is too low for real-time checks): hold keys for
     *  n frames at dt, optional jump at frame j. Returns distance, top speed, max height over ground. */
    sim: (n = 120, { keys = ["KeyW"], jumpAt = -1, dt = 1 / 60 } = {}) => {
      const P = player, c = camera.position, x0 = c.x, z0 = c.z;
      P.keys.clear(); for (const k of keys) P.keys.add(k);
      let maxUp = 0, top = 0; const base = P.stanceDef().eye;
      for (let f = 0; f < n; f++) {
        if (f === jumpAt) P.jump();
        const ns = substepsFor(dt); for (let j = 0; j < ns; j++) P.update(dt / ns);
        const g = world.mode === "overworld" ? world.terrain.height(c.x, c.z) : c.y - base;
        maxUp = Math.max(maxUp, c.y - g - base); top = Math.max(top, P.speedNow);
        if (game.horse) world.wildlife.ride(game.horse, feetPos(), P.yaw, P.speedNow, dt, f * dt);
      }
      P.keys.clear();
      return { dist: +Math.hypot(c.x - x0, c.z - z0).toFixed(2), topSpeed: +top.toFixed(2), maxJump: +maxUp.toFixed(2), jumps: P.jumps || 0, rescues: P.rescues || 0 };
    },
    /** Stand next to camp hut i with your back to the hide (the r3 chase-camera clip case). */
    hutBack: (i = 0, d = 2.3, turn = 0) => {
      const h = world.terrain.campCones?.[i]; if (!h) return null;
      const t = world.terrain, x = h.x + d, z = h.z;
      player.setTerrain(t, x, z, Math.atan2(-(x - h.x), -(z - h.z)) + Math.PI + turn);
      // facing away from the hut: forward is +x, so the camera behind sits toward the hut
      player.yaw = Math.atan2(-1, 0); player.yaw += turn; player.pitch = -0.1; player.applyLook();
      return { hut: { x: h.x, z: h.z }, at: { x, z } };
    },
    camPos: () => ({ x: +viewCam.position.x.toFixed(2), y: +viewCam.position.y.toFixed(2), z: +viewCam.position.z.toFixed(2), camDist: +camDist.toFixed(2), fp: game.viewFP }),
    /** CPU cost of the round-12 systems per frame (ms), averaged over n calls. */
    r12cost: (n = 200) => {
      const p = camera.position, t0 = performance.now();
      for (let i = 0; i < n; i++) world.people.update(1 / 60, p);
      const t1 = performance.now();
      for (let i = 0; i < n; i++) world.settle.update(1 / 60, p);
      const t2 = performance.now();
      const f = feetPos();
      for (let i = 0; i < n; i++) world.wildlife.update(1 / 60, { pos: f, speed: 0, crouched: false, running: false }, i / 60);
      const t3 = performance.now();
      return { peopleMs: +((t1 - t0) / n).toFixed(3), settleMs: +((t2 - t1) / n).toFixed(3), wildlifeMs: +((t3 - t2) / n).toFixed(3), people: world.people.list.length, peopleVisible: world.people.visible, animals: world.wildlife.list.length };
    },
    speeds: () => ({ walk: STANCES.stand.speed, sprint: STANCES.stand.sprint, now: +(player.speedNow || 0).toFixed(2), pace: player.pace || 1, runFrac: +(player.runFrac || 0).toFixed(2) }),
    joyCurve: () => [0, 0.1, 0.2, 0.35, 0.55, 0.7, 0.85, 1, 1.2].map((m) => [m, +Player.joySpeed(m, STANCES.stand).toFixed(2)]),
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
    caveProfile: () => { const sm = stationMap(cave), n = mainPath.length; return mainPath.map((id, i) => { const s0 = sm.get(id), w = stationWorld(s0); return [+(i / n).toFixed(2), id, +(s0.up + s0.down).toFixed(2), +(s0.left + s0.right).toFixed(2), requiredStanceAt(player.volume, w.x, w.y - s0.down + STANCES.stand.eye, w.z)]; }); },
    cavePts: (f0, f1) => { const sm = stationMap(cave), n = mainPath.length, i0 = Math.floor(n * f0), i1 = Math.min(n - 1, Math.floor(n * f1)), out = []; for (let i = i0; i <= i1; i++) { const w = stationWorld(sm.get(mainPath[i])); out.push({ x: +w.x.toFixed(2), z: +w.z.toFixed(2) }); } return out; },
    steer: (x, z, off = 0) => { const c = camera.position, dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz); if (d > 0.01) { player.yaw = Math.atan2(-dx / d, -dz / d) + off; player.applyLook(); } return { d: +d.toFixed(2), x: +c.x.toFixed(2), z: +c.z.toFixed(2), y: +c.y.toFixed(2), st: player.stance, sp: +(player.speedNow || 0).toFixed(2) }; },
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
  joyState: () => player && { active: player.joy.active, mag: +player.joy.mag.toFixed(2), yaw: +player.yaw.toFixed(3), camOff: +(player.camOff || 0).toFixed(3), speed: +(player.speedNow || 0).toFixed(2), look: !!player.lookTouch, oneFinger: player.oneFinger, pos: [+camera.position.x.toFixed(2), +camera.position.z.toFixed(2)] }, // hotfix test hook
  revealN: (n = 1e9) => { const ids = cave ? cave.stations.map((s) => s.id).slice(0, n) : []; for (const id of ids) explored.add(id); return explored.size; },
  hideByName: (re, hide = true) => { const R = new RegExp(re); let n = 0; scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLight) && R.test(o.name || o.type)) { o.visible = !hide; n++; } }); return n; },
  // round 27: visible meshes in the view frustum by name (draw-call breakdown)
  callsBy: () => {
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(viewCam.projectionMatrix, viewCam.matrixWorldInverse));
    const out = {};
    scene.traverseVisible((o) => { if (!o.isMesh && !o.isPoints && !o.isSprite) return; if (o.frustumCulled && o.geometry && !(o.geometry.boundingSphere || o.geometry.computeBoundingSphere(), fr.intersectsObject(o))) return; const k = o.name || o.parent?.name?.split(" ")[0] || o.type; out[k] = (out[k] || 0) + 1; });
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25));
  },
  chunkStats: () => ({ ...chunks.summary(), phaseMax: world.caveLayer?.phaseMax }),
  resetChunkStats: () => chunks.resetStats(),
  setDebug: (on) => setDebug(on),
  get world() { return { mode: world.mode, entrance: world.entrance ? world.entrance.id : null, exitArmed: world.exitArmed, busy: world.busy, transitions: world.transitions.slice(), discovered: [...world.discovered], entrances: world.terrain ? world.terrain.entrances.map((e) => ({ id: e.id, name: e.name, cave: e.cave, x: e.x, z: e.z, fx: e.fx, fz: e.fz, scale: e.scale })) : [] }; },
  enterEntrance: (i, instant = true) => enterEntrance(world.terrain.entrances[i], instant),
  returnToOverworld: (instant = true) => returnToOverworld(instant),
  enterOverworld: () => enterOverworld(),
  campColliders: () => world.terrain?.campColliders || null,
  terrainHeight: (x, z) => world.terrain?.height(x, z),
  streamCtx: () => streamCtx(),
  get mainPath() { return mainPath.slice(); },
  queryFloor: (x, y, z) => { if (!player?.volume) return { inside: false, floor: null, ceil: null, overworld: true }; const q = queryVolume(player.volume, x, y, z, STANCES.stand.radius, 0.1); return { inside: q.inside, floor: +q.floor.toFixed(2), ceil: +q.ceil.toFixed(2) }; },
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
  loadReal: async (id, seed = 1, opts = {}) => { const c = await loadRealCave(id, seed, opts); announceReal(); return !!c; }, // round 27
  // prime: stream in the rock around the player after every placement / every few metres, so the
  // walk collides with the real rendered mesh (BVH), not just the analytic volume
  walkCave: (o = {}) => walkCave({ cave, player, camera, substeps: substepsFor, prime: () => { if (STREAM && world.caveLayer) { chunks.prime(streamCtx(), 25); wallMeshCache.t = -1e9; } }, ...o }),
  meshProbe: (o = {}) => meshProbe(cave, o),
  // debug view: stand on a leg sample (from->to at t) facing yaw (deg, 0 = along the leg, +90 = right)
  lookAt: (from, to, t = 0.5, yawDeg = 0, pitchDeg = 0) => {
    const sm = new Map(cave.stations.map((s) => [s.id, s])), a = sm.get(from), b = sm.get(to);
    if (!a || !b) return null;
    const pa = stationWorld(a), pb = stationWorld(b);
    const x = pa.x + (pb.x - pa.x) * t, z = pa.z + (pb.z - pa.z) * t, y = pa.y + (pb.y - pa.y) * t - (a.down + (b.down - a.down) * t);
    const qv = player.volume ? queryVolume(player.volume, x, y + 1, z, 0.05, 0.3) : null;
    const fy = qv && qv.inside ? qv.floor : y;
    player.setStance("stand"); player.placeWorld(x, fy + 0.05, z);
    const base = Math.atan2(-(pb.x - pa.x), -(pb.z - pa.z));
    player.yaw = base - (yawDeg * Math.PI) / 180; player.pitch = (pitchDeg * Math.PI) / 180; player.applyLook?.();
    if (STREAM && world.caveLayer) chunks.prime(streamCtx(), 25);
    return { x, y, z };
  },
  meshProbeGen: (seed, o = {}) => { const g = generateCave(seed >>> 0); addWaterSystem(g); return meshProbe(g, o); }, // baseline: the old procedural caves
  realFor: () => world.terrain?.entrances.map((e) => ({ id: e.id, name: e.name, real: realCaveFor(e, world.terrain.entrances, storyCaveId()) })),
  caveReport: () => cave && { real: cave.real?.id || null, name: cave.name, kind: cave.kind || null, modules: cave.modules || null, check: cave.check || null, stations: cave.stations.length, legs: cave.legs.length, water: !!cave.water?.legs?.length },
  caveData: () => cave && { stations: cave.stations.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, left: s.left, right: s.right, up: s.up, down: s.down, kind: s.kind, clearance: s.clearance, module: s.module || null })), legs: cave.legs, entranceId: cave.entranceId, mainPath },
  place: (t) => player?.placeAlongMainPath(Number(t), mainPath),
  setLook: (yaw, pitch) => {
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
  mapState: () => mapState(), // round 22 tests
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
  wallPoke: (n = 40, frames = 150, seed = 1, sub = true, jumpEvery = 0) => {
    let rs = seed; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const P = player, cam = P.camera, sts = cave.stations.filter((s) => s.kind !== "entrance");
    let crossings = 0, steps = 0, subCross = 0, rescues0 = P.rescues || 0; const where = [];
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
        if (jumpEvery && f % jumpEvery === 3) P.jump();
        const a = cam.position.clone(), st = STANCES[P.stance];
        if (sub) {
          // per-substep check (each substep is one real collision move); the frame chord check below
          // can flag a corner the path actually slid around, so it is reported separately
          const ns = substepsFor(1 / 60);
          for (let j = 0; j < ns; j++) { const a2 = cam.position.clone(); P.update(1 / 60 / ns); if (walls.crosses(a2, cam.position, a2.y - st.eye, st)) subCross++; }
        } else P.update(1 / 60);
        steps++;
        const b = cam.position;
        if (walls.crosses(a, b, a.y - st.eye, st)) { crossings++; if (where.length < 6) where.push({ st: s0.id, x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1) }); }
      }
    }
    P.joy.active = false; P.joy.mag = 0;
    return { steps, crossings, subCross, jumps: P.jumps || 0, where, rescues: (P.rescues || 0) - rescues0, wallHits: walls.hits, pushes: walls.pushes };
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
  rayDir: (nx, ny) => { const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), viewCam); return rc.ray.direction.toArray(); },
  stationInfo: (id) => { const s = stationMap(cave).get(id); return { up: s.up, down: s.down, left: s.left, right: s.right, kind: s.kind }; },
  near: (v) => { viewCam.near = v; viewCam.updateProjectionMatrix(); },
  bg: (hex) => { scene.background.set(hex); renderer.setClearColor(hex, 1); },
  debugAmbient: (v) => { ambient.color.set(0xffffff); ambient.intensity = v; scene.fog.density = 0.004; game.fogLock = true; },
  hallCenter: (id) => { const s = stationMap(cave).get(id); const p = stationWorld(s); return { x: p.x, y: p.y, z: p.z, floor: p.y - s.down, R: Math.max(s.left, s.right) }; },
  halls: () => { const nb = neighborsOf(cave); return cave.stations.filter((s) => s.kind === "cavern").map((s) => ({ id: s.id, w: +(s.left + s.right).toFixed(1), h: +(s.up + s.down).toFixed(1), nb: nb.get(s.id) })); },
  fauna: () => caveFauna?.stats() || null,
  /** Debug: hide scene objects whose name matches a regex (e.g. formations) for screenshots. */
  hideNamed: (re) => { const r = new RegExp(re); let n = 0; scene.traverse((o) => { if (o.name && r.test(o.name)) { o.visible = false; n++; } }); return n; },
  names: () => { const m = {}; scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) m[o.name || "?"] = (m[o.name || "?"] || 0) + 1; }); return m; },
  onlyNamed: (re) => { const r = new RegExp(re); let n = 0; scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !r.test(o.name || "?")) { o.visible = false; n++; } }); return n; },
  pickView: (nx, ny, dbl) => { const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), viewCam); const out = []; const saved = []; if (dbl === 1) scene.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material)) { saved.push([o.material, o.material.side]); o.material.side = THREE.DoubleSide; } }); const hs = rc.intersectObjects(scene.children, true).filter((h) => h.object.visible && (h.object.isMesh || h.object.isInstancedMesh) && (dbl === 2 || h.object.name !== "")); for (const [m, sd] of saved) m.side = sd; for (const h of hs.slice(0, 4)) { const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null; out.push({ name: h.object.name, d: +h.distance.toFixed(2), dot: n ? +n.dot(rc.ray.direction).toFixed(2) : null, side: h.object.material?.side, fi: h.faceIndex, vn: h.face && h.object.geometry.attributes.normal ? [h.face.a, h.face.b, h.face.c].map((i) => +new THREE.Vector3().fromBufferAttribute(h.object.geometry.attributes.normal, i).transformDirection(h.object.matrixWorld).dot(rc.ray.direction).toFixed(2)) : null, col: h.object.geometry.attributes.color ? [0,1,2].map((k) => +h.object.geometry.attributes.color.getX(h.face.a) .toFixed(2)) : null }); } return { cam: viewCam.position.toArray().map((v) => +v.toFixed(2)), out }; },
  setWeapon: (w) => setWeapon(w),
  /** Test: put the monster d m in front of the player (frozen) and return its health. */
  monsterAhead: (d = 8) => { const m = game.monster; if (!m) return null; const f = feetPos(); m.pos.set(f.x - Math.sin(player.yaw) * d, f.y, f.z - Math.cos(player.yaw) * d); m.frozen = true; m.state = "roam"; return { health: m.health, alive: m.alive }; },
  monsterHealth: () => game.monster && { health: game.monster.health, alive: game.monster.alive },
  archery: () => archery?.stats(),
  aim: (yaw, pitch) => { if (yaw != null) player.yaw = yaw; if (pitch != null) player.pitch = pitch; player.applyLook(); },
  look: () => ({ view: (() => { const d = new THREE.Vector3(); viewCam.getWorldDirection(d); return { pos: viewCam.position.toArray(), dir: d.toArray() }; })(), yaw: player.yaw, pitch: player.pitch, eye: camera.position.toArray().map((v) => +v.toFixed(2)) }),
  animalPos: (kind) => { const n = world.wildlife?.nearest(feetPos(), kind); return n && { x: n.a.pos.x, y: n.a.pos.y, z: n.a.pos.z, d: n.d, id: n.a.id }; },
  torch: () => ({ intensity: +caveman.light.intensity.toFixed(1), distance: +caveman.light.distance.toFixed(1), decay: caveman.light.decay, fog: +scene.fog.density.toFixed(3), ambient: +ambient.intensity.toFixed(2), bounce: +ceilBounce.intensity.toFixed(2), bounceY: +ceilBounce.position.y.toFixed(1) }),
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
    const stuckAt = [], reached = [], causes = {}; let downAt = null; let streamMiss = 0, maxLoaded = 0;
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
        if (opts.sub !== false) { const ns = substepsFor(dt); for (let j = 0; j < ns; j++) P.update(dt / ns); } else P.update(dt);
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
        if (frames > 20 && moved < P.speedNow * dt * 0.25) { stuck++; run++; causes[P.lastBlock || "other"] = (causes[P.lastBlock || "other"] || 0) + 1; if (run === 10) stuckAt.push({ near: b.id, x: +px.toFixed(1), z: +pz.toFixed(1) }); } else run = 0;
        maxStuckRun = Math.max(maxStuckRun, run);
      }
      reached.push(b.id + (ok ? "" : "(FAIL)"));
      if (!ok) break;
    }
    P.joy.active = false; P.joy.mag = 0;
    const r = (v) => +v.toFixed(3);
    return { frames, dist: r(dist), avgSpeed: r(speedSum / Math.max(1, frames)), maxUpPerFrame: r(maxUp), maxDownPerFrame: r(maxDown), downAt, maxAboveGround: r(maxAbove), maxBelowGround: r(maxBelow), airFrames, stuckFrames: stuck, maxStuckRun, stuckAt: stuckAt.slice(0, 8), rescues: (P.rescues || 0) - r0, reached: reached.join(" "), causes, ...(opts.stream ? { streamMiss, maxLoaded } : {}) };
  },
  _dbg: () => ({ player, volume: player.volume }),
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
// Round 24: gamepad buttons (A jump, B crouch → crawl → stand, X attack, Y use / ride, LB spear ⇄ bow,
// RB torch, Back map, Start Pack, D-pad up Tasks). Sticks were round 17 (player.js).
const _padPrev = [];
function padButtons() {
  let g = null; try { g = [...(navigator.getGamepads?.() || [])].find((x) => x && x.connected); } catch {}
  if (!g) return;
  const hit = (i) => { const on = !!g.buttons[i]?.pressed, was = _padPrev[i]; _padPrev[i] = on; return on && !was; };
  const P = {}; for (const i of [0, 1, 2, 3, 4, 5, 8, 9, 12, 13]) P[i] = hit(i);
  if (cine?.on) { if (P[0] || P[2] || P[3]) cine.next(); if (P[1] || P[9]) cine.skip(); return; }
  if (!ready || !player || game.dead) return;
  if (P[9]) storyUI.togglePanel("inv", story.surv);
  if (P[8]) openMap(true);
  if (storyUI.modal) { if (P[1]) { storyUI.closePanel(); storyUI.closeChoice(); } return; }
  if (P[0]) player.jump();
  if (P[1]) player.setStance(player.stance === "stand" ? "crouch" : player.stance === "crouch" ? "crawl" : "stand");
  if (P[2]) attack();
  if (P[3]) { if (canToggleMount()) toggleMount(); else story.interact(); }
  if (P[4]) setWeapon(game.weapon === "bow" ? "spear" : "bow");
  if (P[5]) toggleTorch();
  if (P[12]) storyUI.toggleTasks();
  if (P[13]) toggleFind(); // round 24b: D-pad down
  if (P[14]) blowHorn(); // round 24b: D-pad left = Call to Arms
}
// Round 24: reaching the beacon (within ~8 m) removes it, with a toast and a soft chime. It must have been
// farther than 12 m first, so a beacon dropped right next to you doesn't vanish on the spot.
let beaconArm = null;
function beaconReachCheck() {
  const b = beacon.pos;
  if (!b || !player || !ready || world.mode !== "overworld" || cine?.on) { if (!b) beaconArm = null; return; }
  const f = feetPos(), d = Math.hypot(b.x - f.x, b.z - f.z), k = b.x + "," + b.z;
  if (beaconArm !== k) { if (d > 12) beaconArm = k; return; }
  if (d < 8) { beaconArm = null; beacon.clear(); if (wmap.isOpen) wmap.draw(); storyUI.toast("📍 Beacon reached.", "good"); softChime(); glog({ e: "beaconReached" }); }
}
function softChime() {
  const ctx = audio.ctx; if (!ctx || !audio.master) return;
  const t = ctx.currentTime;
  for (const [f, dt, g] of [[784, 0, 0.16], [1175, 0.12, 0.12], [1568, 0.24, 0.07]]) {
    const o = ctx.createOscillator(), v = ctx.createGain(); o.type = "sine"; o.frequency.value = f;
    v.gain.setValueAtTime(0, t + dt); v.gain.linearRampToValueAtTime(g, t + dt + 0.02); v.gain.exponentialRampToValueAtTime(0.0008, t + dt + 1.4);
    o.connect(v); v.connect(audio.master); o.start(t + dt); o.stop(t + dt + 1.5);
  }
}
// ---------------- Round 24: the tutorial (its own sandbox; your saves are put back when you leave) ----------------
let tut = null;
const tc = (k) => { game.tc[k] = (game.tc[k] || 0) + 1; };
function openTutorial(ch = 0) {
  const go = () => {
    tutSnapshot();
    const u = new URL(location.href); for (const k of ["play", "ch", "room"]) u.searchParams.delete(k);
    u.searchParams.set("play", "tutorial"); if (ch) u.searchParams.set("ch", String(ch));
    location.href = u.toString();
  };
  if (mpActive) { storyUI.toast("Leave the multiplayer room first (☰ → Multiplayer).", "bad"); return; }
  if (story.active) storyUI.ask("Play the tutorial?", "The tutorial is its own practice world (nothing there can hurt you). Your story carries on from your last save when you come back.", [{ id: "go", label: "🎓 Start the tutorial", desc: "Exit any time" }], (id) => { if (id === "go") go(); });
  else go();
}
function exitTutorial() { // the next page load puts the saved keys back (before anything reads them)
  const u = new URL(location.href); for (const k of ["play", "ch"]) u.searchParams.delete(k);
  location.href = u.toString();
}
const A1 = () => window.__CAVE__.act1;
function waterSpot() {
  const T = world.terrain, f = feetPos(), site = T.act1;
  const pts = (site?.stream || []).slice(); pts.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z));
  for (const p of pts.slice(0, 12)) for (let r = 1; r < 6; r += 0.5) for (let a = 0; a < 6.28; a += 0.5) {
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, d = T.streamDist(x, z);
    if (d > 0.5 && d < 1.7 && T.waterDepth(x, z) < -0.3) return { x, z, look: p };
  }
  for (let r = 10; r < 600; r += 6) for (let a = 0; a < 6.28; a += 0.25) { // any creek / river / lake shore
    const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r, d = T.streamDist(x, z);
    if (d > 0.5 && d < 1.7 && T.waterDepth(x, z) < -0.3) return { x, z, look: null };
  }
  return null;
}
const faceTo = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));
const TG = {
  dev: () => currentDevice(IS_TOUCH), feet: () => feetPos(), look: () => ({ yaw: player.yaw, pitch: player.pitch || 0 }), speed: () => player.speedNow || 0,
  stance: () => player.stance, air: () => player.grounded === false, stamina: () => story.surv.stamina, torchDown: () => !!caveman.torchDown,
  get c() { return game.tc; }, count: (id) => story.surv.count(id), stats: () => story.surv.stats, kills: () => tally.kills,
  packOpen: (tab) => !storyUI.panel.classList.contains("hidden") && storyUI.tab === tab, inspectOpen: () => !!storyUI.inspector.isOpen, inspectItem: (id) => { storyUI.inspector.open(id, 1); return storyUI.inspector.el.querySelector(".in-text").textContent; }, // round 24b
  findCur: () => finder.cur, findOpen: () => finder.isOpen, openFind: () => finder.open(), findClear: () => finder.clear(), // round 24b
  mapOpen: () => wmap.isOpen, filtersSig: () => JSON.stringify(mapFilters), hint: () => game.hint, beaconPos: () => beacon.pos, tasksOpen: () => storyUI.tasksOpen,
  horse: () => !!game.horse, boat: () => !!game.boat, mode: () => world.mode, colonies: () => world.colony?.list.length || 0,
  buildMode: () => colonyUI?.mode === "build", colonyOpen: () => !!colonyUI?.isOpen(), audioOpen: () => audioPanel.isOpen, controlsOpen: () => controlsSheet.isOpen,
  weapon: (w) => { if (game.weapon !== w) setWeapon(w); },
  give: (id, n) => story.surv.add(id, n), needs: (h, t) => { story.surv.hunger = h; story.surv.thirst = t; },
  openPack: () => storyUI.openPanel("inv", story.surv), closeInspect: () => storyUI.inspector.isOpen && storyUI.inspector.close(),
  panelsOpen: () => !storyUI.panel.classList.contains("hidden") || !storyUI.choice.classList.contains("hidden") || wmap.isOpen || !!colonyUI?.isOpen() || audioPanel.isOpen || storyUI.inspector.isOpen,
  closePanels: () => { finder.close(); for (let i = 0; i < 30 && !storyUI.dialog.classList.contains("hidden"); i++) storyUI.advance(); storyUI.closePanel(); storyUI.closeChoice(); if (storyUI.inspector.isOpen) storyUI.inspector.close(); if (wmap.isOpen) wmap.close(); },
  openMap: () => { if (!wmap.isOpen) openMap(false); }, closeAudio: () => audioPanel.isOpen && audioPanel.close(),
  toast: (t) => storyUI.toast(t),
  tp: (x, z, yaw) => { if (world.mode !== "overworld") enterOverworld(null, { at: { x, z, yaw } }); else { player.placeWorld(x, 0, z); player.yaw = yaw; player.pitch = 0; player.applyLook?.(); } },
  toBerry: () => {
    const f = feetPos(), T = world.terrain;
    const settle = (q) => { // the same "step off a tree / rock" check the bushes do when you first come near
      if (q.bad !== undefined) return !q.bad;
      q.bad = true;
      for (let k = 0; k < 6 && q.bad; k++) { const a = k * 1.05, d = k ? 1.6 : 0, x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d; if (!T.collidersNear(x, z, 1.3).length && T.waterDepth(x, z) < -0.3) { q.x = x; q.z = z; q.bad = false; } }
      return !q.bad;
    };
    const list = world.berries.spots.filter((q) => q.bad !== true && world.berries.available(q)).map((q) => ({ q, d: Math.hypot(q.x - f.x, q.z - f.z) })).sort((a, b) => a.d - b.d).slice(0, 40);
    for (const { q } of list) { if (!settle(q)) continue; for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283, x = q.x + Math.cos(a) * 1.4, z = q.z + Math.sin(a) * 1.4; if (!T.collidersNear(x, z, 0.7).length && T.waterDepth(x, z) < -0.4) { TG.tp(x, z, faceTo(x, z, q.x, q.z)); return q; } } }
    storyUI.toast("No bush nearby: skip this step."); return null;
  },
  toWater: () => { const w = waterSpot(); if (!w) return storyUI.toast("No water close by. Skip this step."); TG.tp(w.x, w.z, w.look ? faceTo(w.x, w.z, w.look.x, w.look.z) : player.yaw); },
  stalk: (kind, d) => { if (!A1().stalk(kind, d)) { const k = world.wildlife?.list.find((a) => a.alive && a.kind !== "horse"); if (k) A1().stalk(k.kind, d); else storyUI.toast("No animals close. Skip this step."); } },
  toCarcass: () => A1().toCarcass(),
  toHorse: () => { if (!A1().toHorse(false)) storyUI.toast("No horses near here. Skip this step."); },
  dismount: () => { if (game.horse) toggleMount(true); },
  toBoat: () => { const f = feetPos(), b = world.boats?.list.filter((q) => !q.taken).map((q, i) => ({ q, d: Math.hypot(q.x - f.x, q.z - f.z) })).sort((a, b2) => a.d - b2.d)[0]; if (!b || !A1().toBoat(world.boats.list.indexOf(b.q))) storyUI.toast("No boat close by. Skip this step."); },
  leaveBoat: () => { if (game.boat) leaveBoat(true); },
  toPerson: () => {
    const T = world.terrain, f = feetPos(), s = (T.settlements || []).slice().sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    const near = () => world.people?.list.filter((p) => p.ident && !p.ext).sort((a, b) => Math.hypot(a.x - feetPos().x, a.z - feetPos().z) - Math.hypot(b.x - feetPos().x, b.z - feetPos().z))[0];
    const step2 = () => { const p = near(); if (!p) return storyUI.toast("Nobody about. Skip this step."); const x = p.x + 1.8, z = p.z + 0.4; TG.tp(x, z, faceTo(x, z, p.x, p.z)); };
    const p0 = near(); if (p0 && Math.hypot(p0.x - f.x, p0.z - f.z) < 120) return step2();
    if (s) { const L = landingNear(s.x, s.z, 4) || { x: s.x, z: s.z }; TG.tp(L.x, L.z, player.yaw); setTimeout(step2, 1800); } else step2();
  },
  toCave: () => {
    const f = feetPos(), e = world.terrain.entrances.filter((q) => !q.hollow).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    if (!e) return; const x = e.x + e.fx * 7 * (e.scale || 1), z = e.z + e.fz * 7 * (e.scale || 1); TG.tp(x, z, faceTo(x, z, e.x, e.z)); world.discovered.add(e.id); game.tutCave = e;
  },
  awayFromCamp: () => { const c = world.terrain.act1?.camp || feetPos(); const L = landingNear(c.x + 260, c.z + 60, 4) || landingNear(c.x - 260, c.z, 4); if (L) TG.tp(L.x, L.z, player.yaw); },
  toFoundSpot: () => { // stand 7 m from a good hearth spot, facing it (the Found ghost goes 7 m ahead)
    if (world.mode !== "overworld") enterOverworld(world.entrance || null);
    const q = A1().foundSpot(20, 500); if (!q) return;
    const T = world.terrain;
    for (let k = 0; k < 12; k++) { const yaw = (k / 12) * 6.283, x = q.x + Math.sin(yaw) * 7, z = q.z + Math.cos(yaw) * 7; if (T.waterDepth(x, z) < -0.4 && T.slope(x, z).m < 0.45) { TG.tp(x, z, yaw); return; } }
    TG.tp(q.x, q.z, player.yaw);
  },
  stopBuild: () => { if (colonyUI?.mode) colonyUI.stop(); },
  recruit: (n) => { const c = world.colony?.list[0]; if (!c) return; const got = A1().recruitNear(n); if (got.length < n) for (let i = got.length; i < n; i++) world.colony.recruit(c, { name: ["Ama", "Toru", "Ilsa"][i], voice: "f1", trait: "steady" }); world.colony.save(); },
  openTown: () => { const c = world.colony?.list[0]; if (c) colonyUI.open(c); },
  showTasks: (on) => { storyUI.obj.classList.toggle("hidden", !on); if (on) storyUI.setObjective("Tutorial", [["This is the Tasks log: your quests show here", false]], ""); },
  say: (t) => { if (!t) { storyUI.voice.stop?.(false); return; } storyUI.voice.speak?.(t, ""); },
  exit: () => exitTutorial(),
};
function startTutorial(ch = 0) {
  try { for (const k of Object.keys(localStorage)) if (/-tut-\d+$/.test(k)) localStorage.removeItem(k); } catch {}
  story.tutorial = true; game.god = true;
  story.startSandbox();
  storyUI.setSandbox(true); storyUI.setStoryVisible(true);
  game.armed = true; caveman.spear.visible = true;
  applyStats(); game.health = game.maxHealth; renderStatus();
  ensureWorld(); syncColony(true);
  world.atmo.setTime(10.5); world.atmo.setWeather("clear", true);
  // the practice ground: open grass beside the camp (the fire ring and the tents are in the way at the spawn)
  const c0 = world.camp ? world.camp.site.camp : null, pg = c0 && (landingNear(c0.x + 26, c0.z + 14, 2) || landingNear(c0.x - 26, c0.z - 14, 2));
  enterOverworld(null, { at: pg ? { x: pg.x, z: pg.z, yaw: faceTo(pg.x, pg.z, c0.x, c0.z) + Math.PI } : world.camp ? campSpawn() : undefined });
  storyUI.obj.classList.add("hidden");
  const site = world.terrain.act1; if (site) wmap.revealAt?.(site.camp.x, site.camp.z, 450);
  // counters the steps listen for
  const s = story.surv, oc = s.craft.bind(s); s.craft = (...a) => { const r = oc(...a); if (r) tc("craft"); return r; };
  const oh = story.harvest.bind(story); story.harvest = (...a) => { tc("harvest"); return oh(...a); };
  const ot = world.talk.talk.bind(world.talk); world.talk.talk = (...a) => { tc("talk"); return ot(...a); };
  const oj = world.colony.setJob.bind(world.colony); world.colony.setJob = (...a) => { const r = oj(...a); tc("jobs"); return r; };
  const ojp = player.jump.bind(player); player.jump = (...a) => { tc("jump"); return ojp(...a); };
  const otk = storyUI.toggleTasks.bind(storyUI); storyUI.toggleTasks = (...a) => { tc("tasks"); return otk(...a); };
  tut = new Tutorial(gameEl, TG);
  tut.start(Math.max(0, Math.min(CHAPTERS.length - 1, ch | 0)));
  setTimeout(() => storyUI.toast("🎓 Tutorial: nothing can hurt you here. Your real saves are untouched."), 600);
}
// Default start: outside, in the hills. ?seed=, ?cave=carlsbad (and test ?shot=) start in a cave.
const directCave = params.has("seed") || params.has("cave") || params.has("shot") || params.get("start") === "cave" || params.get("demo") === "1";
if (directCave) {
  showHint(9000, 800);
  const cq = (params.get("cave") || "").toLowerCase();
  if (cq === "carlsbad") loadCarlsbad();
  else if (REAL_CAVES[cq]) loadRealCave(cq, startSeed).then(() => announceReal());
  else preloadLayouts().then(() => newCave(params.has("seed") ? params.get("seed") : startSeed));
} else {
  // Default: main menu (Continue / New Game / Free Play) over the dawn camp. ?play=new|free|continue skips it.
  const play = MP_ROOM ? "free" : params.get("play"); // round 22: an invite link drops you into free play
  try { // round 24: if building the world fails on High graphics, retry once on Low; otherwise still show the menu
  if (play === "tutorial") startTutorial(+(params.get("ch") || 0)); // round 24
  else if (play === "new") startNewGame();
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
  } catch (err) {
    console.error("start failed", err); errors.push(String(err && err.stack || err).slice(0, 300));
    if (!gfxFallback("start: " + (err && err.message))) { try { showMainMenu(); } catch {} setTimeout(() => { throw err; }, 0); } // the boot-check box reports it
  }
}

// Round 22: invite links (?room=ABCDE) join straight away (or ask for a name first).
if (MP_ROOM && !directCave) mp.autoJoin(MP_ROOM);
window.addEventListener("keyup", (e) => { if (!(e.target instanceof HTMLInputElement)) mp.key(e, false); });
// Round 23: ☰ → Audio (volume mixer)
const audioPanel = new AudioPanel(gameEl, audio, { onTestVoice: () => storyUI.voice.speak?.("The fire is lit. The night is long. Stay close, Kra.", "Old Lume") });
document.getElementById("audio-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); armAudio(); audioPanel.open(); });
document.getElementById("mp-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); if (story.tutorial) { storyUI.toast("Multiplayer is off in the tutorial."); return; } mp.open(); });
// Round 24: ☰ → Controls / Tutorial
const controlsSheet = new ControlsSheet(gameEl, { touch: IS_TOUCH, oneFinger: IS_TOUCH ? () => oneFingerOn() : null, setOneFinger: (v) => setOneFinger(v) });
document.getElementById("controls-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); controlsSheet.open(); });
document.getElementById("tut-btn")?.addEventListener("click", (e) => { e.stopPropagation(); gameEl.classList.remove("menu-open"); if (story.tutorial) tut?.menu(true); else openTutorial(); });
window.__CAVE__.mp = mp;
const shot = params.get("shot");
if (shot === "mid" || params.get("demo") === "1") player.placeAlongMainPath(0.42, mainPath);
if (shot === "exit") player.placeAlongMainPath(0.92, mainPath);
if (shot === "entrance") player.spawnAtEntrance();
if (shot === "waterfall" || shot === "pool" || shot === "stream" || shot === "formations" || shot === "cavern" || shot === "crawl" || shot === "junction" || shot === "fallclose") {
  lookAtFeature(shot);
}

// ---------------- Round 24c: one way out of every overlay (✕ top-right, Close all, Esc, back) ----------------
const hidden = (el) => !el || el.classList.contains("hidden");
const overlays = new Overlays([
  { name: "cutscene", label: "the cutscene (skip)", open: () => !!cine?.on, close: () => cine.skip(), ownEsc: () => true },
  { name: "inspect", bd: () => storyUI.inspector.el, open: () => !!storyUI.inspector.isOpen, close: () => storyUI.inspector.close() },
  { name: "find", label: "Find", open: () => finder.isOpen, close: () => finder.close() },
  { name: "mapFilters", label: "map filters", open: () => !!document.querySelector(".mf-pop"), close: () => document.querySelector(".mf-pop .mf-x")?.click() || document.querySelector(".mf-pop")?.remove(), force: () => document.querySelectorAll(".mf-pop").forEach((e) => e.remove()) },
  { name: "mapMenu", label: "the map menu", open: () => !!document.querySelector(".wm-pop"), close: () => wmap._closePop() },
  { name: "controls", label: "Controls", open: () => controlsSheet.isOpen, close: () => controlsSheet.close() },
  { name: "audio", bd: () => audioPanel.el, label: "Audio", open: () => audioPanel.isOpen, close: () => audioPanel.close() },
  { name: "multiplayer", bd: () => mp._panel, label: "Multiplayer", open: () => !hidden(mp._panel), close: () => mp.close() },
  { name: "tutorialMenu", label: "the chapter list", open: () => !!tut?.on && !hidden(tut.el?.querySelector(".tu-menu")), close: () => tut.menu(false) },
  { name: "chat", label: "chat", open: () => !hidden(mp._bar), close: () => mp.chatClose() },
  { name: "choice", open: () => !hidden(storyUI.choice), close: () => { const c = storyUI.choice.querySelector(".cancel"); if (c) c.click(); else storyUI.closeChoice(); } },
  { name: "pack", label: "the pack", open: () => !hidden(storyUI.panel), close: () => storyUI.closePanel() },
  { name: "settlement", bd: () => colonyUI?.panel, label: "the settlement panel", open: () => !!colonyUI?.isOpen(), close: () => colonyUI.close() },
  { name: "build", label: "build mode", open: () => colonyUI?.mode === "build", close: () => colonyUI.stop() },
  { name: "map", label: "the map", open: () => wmap.isOpen, close: () => wmap.close() },
  { name: "dialog", label: "the conversation", open: () => !hidden(storyUI.dialog), close: () => storyUI.skipAll(), force: () => storyUI.dialog.classList.add("hidden") },
  { name: "tasks", label: "the quest log", open: () => IS_TOUCH && !!storyUI.tasksOpen, close: () => storyUI.toggleTasks(false) },
  { name: "menu", label: "the menu", open: () => gameEl.classList.contains("menu-open") && !!menuBtn && getComputedStyle(menuBtn).display !== "none", close: () => gameEl.classList.remove("menu-open") },
]);
gameEl.classList.toggle("ov-on", false);
setInterval(() => gameEl.classList.toggle("ov-on", overlays.n > 0), 200);

requestAnimationFrame(tick);
