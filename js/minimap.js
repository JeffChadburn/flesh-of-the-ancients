/** Plan-view minimap of the survey centerline, north up. */

import { stationMap, stationWorld } from "./cave-data.js";

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  draw(cave, playerPos, yaw, placeLabel = "", explored = null) {
    const c = this.canvas;
    const ctx = this.ctx;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);

    // Background disc
    ctx.fillStyle = "rgba(8, 7, 5, 0.78)";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(201, 168, 110, 0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!cave?.stations?.length) return;
    const smap = stationMap(cave);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of cave.stations) {
      const p = stationWorld(s);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 4;
    // Fog of war: centred on the player at a fixed scale; only explored passages are drawn.
    const big = cave.style === "carlsbad";
    const R = big ? 120 : 45;
    const scale = (w / 2 - 8) / R;
    const cx = playerPos ? playerPos.x : (minX + maxX) / 2;
    const cz = playerPos ? playerPos.z : (minZ + maxZ) / 2;
    const seen = (id) => !explored || explored.has(id);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
    ctx.clip();

    // Survey y-north is -Z in world; north is up on the map, so screenY decreases as world Z decreases? 
    // world z = -north, so north = -z. Up on map should be north = smaller z? 
    // If z is south, then north-up means screenY = (z - cz) * scale + h/2  (south is down, z increases down)
    const toMap = (x, z) => ({
      x: w / 2 + (x - cx) * scale,
      y: h / 2 + (z - cz) * scale,
    });

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(196, 174, 140, 0.55)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const widthOf = (s) => Math.max(1.6, Math.min(10, (s.left + s.right) * scale * 0.55));
    for (const leg of cave.legs) {
      const a = smap.get(leg.from);
      const b = smap.get(leg.to);
      if (!a || !b) continue;
      const ea = seen(a.id), eb = seen(b.id);
      if (!ea && !eb) continue;
      const pa = stationWorld(a);
      const pb = stationWorld(b);
      let A = toMap(pa.x, pa.z);
      let B = toMap(pb.x, pb.z);
      // Half-explored leg: draw only the first half from the visited end.
      if (!ea) A = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      if (!eb) B = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      ctx.lineWidth = Math.min(widthOf(a), widthOf(b));
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
    if (cave.water && cave.water.legs && !explored) {
      ctx.strokeStyle = "rgba(90, 180, 190, 0.9)";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (const leg of cave.water.legs) {
        const a = smap.get(leg.from);
        const b = smap.get(leg.to);
        if (!a || !b) continue;
        const pa = stationWorld(a);
        const pb = stationWorld(b);
        const A = toMap(pa.x, pa.z);
        const B = toMap(pb.x, pb.z);
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
    }

    const drawDot = (id, color, r) => {
      if (!id || !smap.has(id)) return;
      const p = toMap(...(() => {
        const wld = stationWorld(smap.get(id));
        return [wld.x, wld.z];
      })());
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // Named places (traced caves): small dots, the current one labelled.
    for (const s of cave.stations) {
      if (!s.label || !seen(s.id)) continue;
      const wld = stationWorld(s);
      const p = toMap(wld.x, wld.z);
      const here = s.label === placeLabel;
      ctx.fillStyle = here ? "#ffd98a" : "rgba(240, 210, 150, 0.7)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, here ? 3.2 : 2, 0, Math.PI * 2);
      ctx.fill();
      if (here) {
        ctx.font = `${Math.max(9, Math.round(w / 22))}px Georgia, serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffe3a8";
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3;
        const txt = s.label.replace(/ \(.*\)$/, "");
        const ty = p.y > h * 0.75 ? p.y - 8 : p.y + 14;
        ctx.strokeText(txt, Math.min(w - 30, Math.max(30, p.x)), ty);
        ctx.fillText(txt, Math.min(w - 30, Math.max(30, p.x)), ty);
      }
    }
    drawDot(cave.entranceId, "#8fd0a8", 4.5);
    if (seen(cave.exitId)) drawDot(cave.exitId, "#ffd27a", 5);

    if (playerPos) {
      const p = toMap(playerPos.x, playerPos.z);
      ctx.save();
      ctx.translate(p.x, p.y);
      // yaw 0 looks toward -Z (north). On the map, -Z is up, so arrow should point up when yaw=0.
      // screen: up is negative Y. Direction of look in map space: (-sin(yaw), -cos(yaw)) in (x,z),
      // z is down on map, so arrow rotation: yaw 0 -> point up (negative screen y).
      ctx.rotate(yaw);
      ctx.fillStyle = "#f3efe6";
      ctx.strokeStyle = "#1a1208";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
    // North tick
    ctx.fillStyle = "rgba(232, 214, 180, 0.8)";
    ctx.font = "11px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("N", w / 2, 14);
    void pad;
  }

  /** Round 16: a label that stays inside the round map (flips left near the right rim, outlined). */
  _label(txt, x, y, col) {
    const c = this.canvas, ctx = this.ctx, w = c.width;
    ctx.font = `${Math.round(Math.max(w * 0.055, 10.5 * (w / (c.clientWidth || w))))}px sans-serif`; /* round 13: readable on a 100 px phone map */
    const tw = ctx.measureText(txt).width, r = w / 2 - 4, yy = Math.max(-r + 10, Math.min(r - 3, y - w / 2)) + w / 2;
    const half = Math.sqrt(Math.max(0, r * r - (yy - w / 2) ** 2)); // chord half-width at this height
    let tx = x + 6; if (tx + tw > w / 2 + half) tx = x - 6 - tw; tx = Math.max(w / 2 - half + 2, Math.min(w / 2 + half - tw - 2, tx));
    ctx.textAlign = "left"; ctx.lineWidth = Math.max(2, w * 0.016); ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(txt, tx, yy);
    ctx.fillStyle = col || "#f6e2b0"; ctx.fillText(txt, tx, yy);
  }

  /** Overworld: player-centred 150 m map, contour-ish shading, cave mouths once discovered. */
  drawOverworld(terrain, playerPos, yaw, discovered, extra = null) {
    const c = this.canvas, ctx = this.ctx, w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(8, 10, 12, 0.8)";
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(150, 170, 200, 0.45)"; ctx.lineWidth = 2; ctx.stroke();
    const R = 150, scale = (w / 2 - 8) / R;
    ctx.save();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2); ctx.clip();
    // Cheap height shading (cached per player cell, so ~0 cost per frame).
    const key = Math.round(playerPos.x / 10) + "," + Math.round(playerPos.z / 10) + "," + w;
    if (this._owKey !== key) {
      this._owKey = key;
      const N = 24, cell = w / N;
      this._owImg = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = playerPos.x + ((i + 0.5) * cell - w / 2) / scale, z = playerPos.z + ((j + 0.5) * cell - h / 2) / scale;
        const y = terrain.height(x, z);
        const band = Math.floor(y / 8) % 2;
        const v = Math.max(0, Math.min(1, (y + 20) / 160));
        this._owImg.push([i * cell, j * cell, cell + 0.5, `rgba(${40 + v * 70 + band * 8}, ${55 + v * 60 + band * 8}, ${45 + v * 70 + band * 8}, 0.5)`]);
      }
    }
    for (const [x, y, s, col] of this._owImg) { ctx.fillStyle = col; ctx.fillRect(x, y, s, s); }
    for (const e of terrain.entrances) {
      if (!discovered.has(e.id)) continue;
      const x = w / 2 + (e.x - playerPos.x) * scale, y = h / 2 + (e.z - playerPos.z) * scale;
      ctx.fillStyle = e.cave === "carlsbad" ? "#ffcf6a" : "#e8e0d0";
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, w * 0.025), Math.PI, 0); ctx.closePath(); ctx.fill();
      this._label(e.name.split(" ")[0], x, y - 4, "#e8e0d0");
    }
    if (extra) {
      // stream line, camp / goal markers, tracked animals
      const P = (x, z) => [w / 2 + (x - playerPos.x) * scale, h / 2 + (z - playerPos.z) * scale];
      if (extra.stream) {
        ctx.strokeStyle = "rgba(110, 190, 220, 0.8)"; ctx.lineWidth = Math.max(1.5, w * 0.012);
        ctx.beginPath(); extra.stream.forEach((p, i) => { const [x, y] = P(p.x, p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      }
      for (const m of extra.marks || []) {
        let [x, y] = P(m.x, m.z);
        if (m.edge) {
          // round 12: far settlements sit on the rim as a pointer
          const dx = x - w / 2, dy = y - h / 2, d = Math.hypot(dx, dy), rim = Math.min(w, h) * 0.46;
          if (d > rim) { x = w / 2 + (dx / d) * rim; y = h / 2 + (dy / d) * rim; ctx.globalAlpha = 0.75; ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(x, y, Math.max(2, w * 0.014), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; continue; }
        }
        ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(x, y, Math.max(3, w * (m.r || 0.022)), 0, Math.PI * 2); ctx.fill();
        if (m.label) this._label(m.label, x, y + 4, m.color);
      }
      for (const d of extra.dots || []) { const [x, y] = P(d.x, d.z); ctx.fillStyle = d.color; ctx.fillRect(x - 2, y - 2, 4, 4); }
    }
    ctx.restore();
    // player arrow
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.rotate(-yaw);
    ctx.fillStyle = "#9fe3a8";
    ctx.beginPath(); ctx.moveTo(0, -w * 0.05); ctx.lineTo(w * 0.03, w * 0.035); ctx.lineTo(-w * 0.03, w * 0.035); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
