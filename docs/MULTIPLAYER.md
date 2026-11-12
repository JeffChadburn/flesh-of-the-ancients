# Multiplayer (Round 22)

## Playing
* **☰ → Multiplayer**: pick a name (saved on this device) and a colour.
* **Create room**: you get a 5-letter code and an invite link like `…/index.html?room=ABCDE`. Send the link (or the code) to friends.
* **Join**: type the code, or just open the link. Multiplayer always runs in **free play**; your story save is never read or written. Settlements you build in a room are saved under their own key (`fota-colony-v1-mp-<seed>`), separate from single-player free play.
* Up to **8 players**. The room creator is the host and their **world seed** is used: a joiner on a different world reloads into the host's world automatically.
* In the room: player list with ping, 🎁 hand over an item (they must accept; it comes back if they decline or don't answer within 30 s), 🔈 mute (voice + chat), 🚫 block (hide + mute + ignore; remembered on this device), Leave.
* Chat: **T** / **Enter** or 💬. Emotes: 👋 wave, 👉 point, 💃 dance (chat bar or lobby).
* Voice: **hold V** (desktop) or **hold 🎙** (phone) to talk; the lobby can switch to *tap to toggle*, *proximity* (default, volume and left/right by distance/direction) or *room-wide*, and *mute all*. A green dot on a name tag = that player is talking. The browser asks for the microphone the first time you press 🎙 (iPhone: Settings › Safari › Microphone if you said no).
* You see each other's position, facing, walk/run/crouch/crawl pose (wading as on their screen), horse / boat, torch, weapon, clothes, spear stabs and arrows, on the minimap and the big map (players + their settlements). Walking into another player's settlement shows it read-only (it isn't saved on your side).

## How it works now (peer-to-peer)
```
js/net/config.js      transport choice + STUN/TURN + rate      (?net=p2p|local|server, ?srv=wss://…)
js/net/transport.js   the interface every transport implements + factory
js/net/p2p.js         WebRTC mesh via Trystero 0.27 (MIT, vendor/trystero-nostr.min.js)
js/net/local.js       same-browser tabs over BroadcastChannel (tests / offline)
js/net/server.js      STUB WebSocket client for a future server (same interface)
js/mp/mp.js           game side: lobby, players, chat, emotes, trades, settlements, map marks
js/mp/avatar.js       remote caveman + name tag + bubble + horse/boat + interpolation
js/mp/voice.js        mic, push-to-talk, proximity gain/pan, speaking detection
js/mp/safety.js       name/chat filter, HTML escaping
docs/server-reference.mjs   ~50-line Node relay that speaks the server.js protocol
```
* **Signaling**: free public **Nostr relays** (Trystero's default list, e.g. `wss://nostr-pub.wellorder.net`, `wss://no.str.cr` …). No account, no API key, nothing of ours stored anywhere; the relays only see short-lived encrypted offers (the room code is also the encryption password). Relays are run by volunteers: one may be slow or down, Trystero uses several at once. Finding each other usually takes **5–30 s**.
* **Connection**: public STUN (Google, Cloudflare). Works on most home Wi-Fi and mobile data. Some networks (symmetric NAT, some carriers, corporate/school Wi-Fi) block direct peer-to-peer: the lobby then says *"Found a player but couldn't connect directly"*. Fix = a **TURN relay**, which needs an account with a provider (e.g. Cloudflare Calls/TURN, Twilio, Metered) or your own coturn server. Not added: it needs the owner's approval. When approved, put it in `NET.turn` in `js/net/config.js`.
* **Mesh**: every player connects to every other (≤ 8 → ≤ 28 links). State is sent 10×/s (~120 bytes), voice is Opus (~30 kbit/s per speaker per listener, only while the push-to-talk key is held).
* **Trust**: peers are trusted; a modified client could fake its position. Trades are escrowed (taken from the giver, returned if declined), but nothing is authoritative.

## Moving to a real server (hundreds to thousands of players)
Swapping transport is a config change: `NET.transport = "server"` and `NET.serverUrl = "wss://…"` (or `?net=server&srv=wss://…`). `js/net/server.js` already speaks a tiny JSON protocol (`join / msg / ping / leave` ↔ `welcome / peer / msg / pong`) and `docs/server-reference.mjs` is a working relay to start from. The game code doesn't change; only these need building:

1. **Server** (pick one):
   * **Colyseus** (Node, rooms + state sync, MIT; self-host free or Colyseus Cloud paid),
   * **Nakama** (Go, accounts/chat/matchmaking/storage, Apache-2; self-host or Heroic Cloud paid),
   * **custom Node/uWebSockets.js** starting from `server-reference.mjs`.
2. **Authority**: the server owns the world seed, validates movement speed, settles trades and owns shared settlements; clients send inputs/intent and get corrected.
3. **Interest management**: a spatial grid (e.g. 128 m cells over the terrain, per cave id for caves). Each client only receives players in its own and neighbouring cells; far players at 1–2 Hz or not at all. That's what turns O(n²) into ~O(n) and lets one process hold ~500–1500 players.
4. **Sharding**: split the world into regions (or separate "realms" by seed) across processes; hand players over at borders, Redis/NATS for cross-shard chat and presence.
5. **Voice at scale**: an **SFU** (LiveKit, mediasoup, Janus) instead of mesh: each player uploads once; the server forwards only nearby speakers (same cells). LiveKit is OSS (self-host) or LiveKit Cloud (paid).
6. **Hosting**: a VPS/container with TLS (wss://). All of these need an account and usually money (small VPS ≈ $5–20/month; managed cloud by usage). **Owner approval required before any sign-up or spend.**
7. **Moderation**: server-side name/chat filter (repeat `js/mp/safety.js`), reports, rate limits, bans, and persisted blocks if accounts exist.

## Testing
* Same-browser tabs: open two tabs with `?net=local` (BroadcastChannel; no network), create in one, join in the other.
* `tools/` (not published) has the headless checks used in development.
