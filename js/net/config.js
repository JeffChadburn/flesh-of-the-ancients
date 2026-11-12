/**
 * Round 22: multiplayer network config. The game only talks to the Transport interface in
 * transport.js; switching to a dedicated server is a config change here (or ?net=server&srv=wss://…).
 *
 *   transport: "p2p"    WebRTC mesh, free public Nostr relays for signaling (no account), public STUN
 *              "local"  same-browser tabs over BroadcastChannel (automated tests, offline demos)
 *              "server" authoritative WebSocket server (see docs/MULTIPLAYER.md; stub client in server.js)
 */
const q = new URLSearchParams(location.search);
export const NET = {
  transport: q.get("net") || "p2p",
  serverUrl: q.get("srv") || "", // e.g. "wss://play.example.com/fota"
  appId: "flesh-of-the-ancients-v1",
  maxPlayers: 8,
  rate: 10, // state packets per second
  // Public STUN only. A TURN relay (needed on some strict / symmetric-NAT networks) needs an account
  // or your own server; leave empty unless the owner approves one.
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }],
  turn: [],
};
