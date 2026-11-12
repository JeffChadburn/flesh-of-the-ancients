// Round 22: reference relay server for js/net/server.js (NOT deployed; for whoever runs a server later).
// Node 18+:  npm i ws  &&  node docs/server-reference.mjs  → ws://localhost:8787
// Then open the game with ?net=server&srv=ws://localhost:8787
// It only relays (rooms, membership, ping). A production server adds: auth / rate limits, the slur
// filter, authoritative state (validate moves, own trades + settlements), and area-of-interest
// filtering so each player only receives nearby players (see MULTIPLAYER.md).
import { WebSocketServer } from "ws";
const wss = new WebSocketServer({ port: +process.env.PORT || 8787 });
const rooms = new Map(); // code -> Map(id -> ws)
let next = 1;
wss.on("connection", (ws) => {
  const id = "p" + next++; let room = null;
  const out = (o, to = ws) => to.readyState === 1 && to.send(JSON.stringify(o));
  ws.on("message", (raw) => {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.op === "join" && !room && /^[A-Z]{5}$/.test(d.room)) {
      room = rooms.get(d.room) || new Map(); rooms.set(d.room, room);
      if (room.size >= 8) return out({ op: "error", reason: "room full" });
      out({ op: "welcome", self: id, peers: [...room.keys()] });
      for (const w of room.values()) out({ op: "peer", ev: "join", id }, w);
      room.set(id, ws);
    } else if (d.op === "msg" && room) {
      const m = JSON.stringify({ op: "msg", ch: String(d.ch).slice(0, 8), m: d.m, from: id });
      if (m.length > 64000) return;
      if (d.to) room.get(d.to)?.send(m); else for (const [k, w] of room) if (k !== id && w.readyState === 1) w.send(m);
    } else if (d.op === "ping") out({ op: "pong", id: d.id });
    else if (d.op === "leave") ws.close();
  });
  ws.on("close", () => { if (!room) return; room.delete(id); for (const w of room.values()) out({ op: "peer", ev: "leave", id }, w); });
});
console.log("relay on", wss.options.port);
