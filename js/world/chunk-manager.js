/**
 * Chunk streaming core shared by every world layer (cave cells, overworld terrain).
 *
 * A layer describes WHAT should exist near the player; the manager decides WHEN:
 *   layer.name                       unique id
 *   layer.scan(ctx) -> { want: Map<key, priority>, keep: Set<key> }
 *        want = chunks to load (lower priority value = sooner), keep = may stay loaded
 *        (keep is a superset of want: load radius < unload radius, i.e. hysteresis)
 *   layer.build(key) -> generator; each `yield` is a cut point between small jobs, the
 *        return value is { obj: Object3D, tris?, bounds?: Box3 }
 *   layer.onLoad?(key, chunk) / layer.onUnload?(key, chunk)
 *
 * Builds are time-sliced: jobs run until the per-frame budget is spent (at least one
 * job per frame so progress never stalls). Unloaded chunks are removed and their
 * geometries / owned materials / textures disposed. Resident data (graphs, heightfield
 * params, colliders) lives in the layers, never in chunks.
 */
import * as THREE from "three";

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
    if (o.material && o.userData.ownMaterial) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        for (const k in m) if (m[k] && m[k].isTexture && !m[k].userData?.shared) m[k].dispose();
        m.dispose();
      }
    }
    if (o.isInstancedMesh && o.dispose) o.dispose();
  });
}

export class ChunkManager {
  constructor(scene, { budgetMs = 3.5 } = {}) {
    this.scene = scene;
    this.budgetMs = budgetMs;
    this.maxUnloadsPerFrame = 4;
    this.layers = new Map();
    this.chunks = new Map(); // "layer|key" -> chunk
    this.queue = [];
    this.debug = false;
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = "chunk-debug";
    this.debugDirty = true;
    scene.add(this.debugGroup);
    this.resetStats();
  }

  resetStats() {
    this.stats = { loads: 0, unloads: 0, cancelled: 0, jobs: 0, maxJobMs: 0, maxFrameMs: 0, overBudget: 0, frames: 0, lastFrameMs: 0, hitches: [] };
  }

  addLayer(layer) {
    if (this.layers.has(layer.name)) this.removeLayer(layer.name);
    layer.root = new THREE.Group();
    layer.root.name = "layer:" + layer.name;
    this.scene.add(layer.root);
    this.layers.set(layer.name, layer);
    return layer;
  }

  removeLayer(name, { dispose = true } = {}) {
    const layer = this.layers.get(name);
    if (!layer) return;
    for (const [fk, c] of [...this.chunks]) if (c.layer === layer) this._unload(fk, c);
    this.scene.remove(layer.root);
    if (dispose) layer.dispose?.();
    this.layers.delete(name);
    this.debugDirty = true;
  }

  isLoaded(layerName, key) {
    const c = this.chunks.get(layerName + "|" + key);
    return !!(c && c.state === "loaded");
  }

  _unload(fk, c) {
    if (c.state === "loaded") {
      c.layer.root.remove(c.obj);
      c.layer.onUnload?.(c.key, c);
      disposeObject(c.obj);
      this.stats.unloads++;
    } else {
      if (c.gen) c.gen.return?.();
      c.partial && disposeObject(c.partial);
      this.stats.cancelled++;
    }
    this.chunks.delete(fk);
    this.debugDirty = true;
  }

  /** Per frame: diff wanted vs loaded, unload stragglers, run build jobs within the budget. */
  update(ctx, { budgetMs = this.budgetMs, maxPriority = Infinity } = {}) {
    const t0 = performance.now();
    for (const layer of this.layers.values()) {
      if (layer.enabled === false) continue;
      const { want, keep } = layer.scan(ctx);
      for (const [key, pri] of want) {
        const fk = layer.name + "|" + key;
        let c = this.chunks.get(fk);
        if (!c) {
          c = { layer, key, fk, state: "queued", pri, gen: null, obj: null, tris: 0 };
          this.chunks.set(fk, c);
          this.queue.push(c);
        } else c.pri = pri;
      }
      // Unload stragglers, a few per frame (spreads GPU-buffer frees / GC across frames).
      let freed = 0;
      for (const [fk, c] of [...this.chunks]) {
        if (c.layer !== layer) continue;
        if (!want.has(c.key) && !keep.has(c.key)) {
          if (c.state === "loaded" && freed >= this.maxUnloadsPerFrame) continue;
          this._unload(fk, c);
          if (c.state === "loaded") freed++;
        }
      }
    }
    this.queue = this.queue.filter((c) => this.chunks.get(c.fk) === c && c.state !== "loaded");
    this.queue.sort((a, b) => a.pri - b.pri);
    let ran = 0;
    while (this.queue.length) {
      const c = this.queue[0];
      if (c.pri > maxPriority) break;
      if (ran > 0 && performance.now() - t0 >= budgetMs) break;
      const j0 = performance.now();
      if (!c.gen) { c.gen = c.layer.build(c.key, c); c.state = "building"; }
      const r = c.gen.next();
      const jms = performance.now() - j0;
      this.stats.jobs++;
      ran++;
      if (jms > this.stats.maxJobMs) this.stats.maxJobMs = jms;
      if (r.done) {
        this.queue.shift();
        const res = r.value || {};
        c.obj = res.obj || new THREE.Group();
        c.tris = res.tris || 0;
        c.bounds = res.bounds || new THREE.Box3().setFromObject(c.obj);
        c.state = "loaded";
        c.gen = null;
        c.layer.root.add(c.obj);
        c.layer.onLoad?.(c.key, c);
        this.stats.loads++;
        this.debugDirty = true;
      }
    }
    for (const layer of this.layers.values()) layer.postUpdate?.(this);
    const ms = performance.now() - t0;
    this.stats.frames++;
    this.stats.lastFrameMs = ms;
    if (ms > this.stats.maxFrameMs) this.stats.maxFrameMs = ms;
    if (ms > budgetMs * 2 && budgetMs < 1000) {
      this.stats.overBudget++;
      if (this.stats.hitches.length < 40) this.stats.hitches.push(+ms.toFixed(1));
    }
    if (this.debug && this.debugDirty) this._rebuildDebug();
  }

  /** Build everything wanted up to `maxPriority` right now (used on spawn / teleport, behind a fade). */
  prime(ctx, maxPriority = 30) {
    const keepMax = this.stats.maxFrameMs, keepOver = this.stats.overBudget;
    for (let i = 0; i < 20000; i++) {
      const before = this.stats.loads;
      this.update(ctx, { budgetMs: 1e9, maxPriority });
      if (!this.queue.length || this.queue[0].pri > maxPriority) break;
      void before;
    }
    // Priming happens behind the load / fade: not a gameplay hitch.
    this.stats.maxFrameMs = keepMax;
    this.stats.overBudget = keepOver;
    this.stats.primes = (this.stats.primes || 0) + 1;
  }

  setDebug(on) {
    this.debug = on;
    this.debugGroup.visible = on;
    this.debugDirty = true;
    if (on) this._rebuildDebug();
  }

  _rebuildDebug() {
    this.debugDirty = false;
    for (const ch of [...this.debugGroup.children]) { this.debugGroup.remove(ch); ch.geometry.dispose(); ch.material.dispose(); }
    for (const c of this.chunks.values()) {
      if (c.state !== "loaded" || !c.bounds || c.bounds.isEmpty()) continue;
      const col = c.layer.debugColor ? c.layer.debugColor(c.key) : 0x44ff88;
      const h = new THREE.Box3Helper(c.bounds, col);
      h.material.depthTest = false;
      h.material.transparent = true;
      h.material.opacity = 0.7;
      h.material.fog = false;
      h.renderOrder = 999;
      this.debugGroup.add(h);
    }
  }

  summary() {
    const per = {};
    let tris = 0, loaded = 0, queued = 0;
    for (const c of this.chunks.values()) {
      const k = c.layer.name;
      per[k] = per[k] || { loaded: 0, queued: 0, tris: 0 };
      if (c.state === "loaded") { per[k].loaded++; per[k].tris += c.tris; loaded++; tris += c.tris; } else { per[k].queued++; queued++; }
    }
    return { loaded, queued, tris, per, ...this.stats, maxJobMs: +this.stats.maxJobMs.toFixed(2), maxFrameMs: +this.stats.maxFrameMs.toFixed(2), lastFrameMs: +this.stats.lastFrameMs.toFixed(2) };
  }
}
