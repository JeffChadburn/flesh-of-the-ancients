# Flesh of the Ancients (Cavern)

A browser survival-horror game set in the Stone Age. It began as a cave game (third- or first-person) that turns a cave centerline (stations, legs, and LRUD widths) into a walkable 3D passage, with a random-cave mode for this prototype.

## Play

Open `index.html` from a local web server (modules will not load from `file://`).

    python3 -m http.server 8765 --directory .

Then visit http://127.0.0.1:8765/

The main menu offers **Continue** (from the last save), **New Game** (Act I, "The Empty Camp") and **Free Play** (the open world and caves with no story, as in round 6). In free play you start outdoors in **the Hills**, in sight of a cave mouth. Walk into any dark opening in the hillside rock outcrops to enter its cave; one of them leads to Carlsbad Cavern. Walk back to where you came in to return to that entrance. Monsters live only in caves.

- **URL options:**
  - `?play=new`, `?play=continue` or `?play=free` skip the main menu
  - `?daymin=N` sets the real minutes per in-game day (default 22)
  - `?seed=N` or `?cave=carlsbad` start directly in a cave, as before
  - `?world=N` picks a different overworld
  - `?stream=0` turns streaming off and builds the whole cave at once (for comparison)
- **Buttons:** **Hills** returns to the overworld from anywhere. **Debug** (or the **G** key) shows the streaming overlay: chunk outlines and live stats.

- **Desktop:** click to look, WASD or arrow keys to walk, Shift to run, **Space** to jump, **E** to get on / off a horse, **left click** or **F** to stab with the spear, **V** to switch between third and first person, **C** to crouch, **Z** or **Ctrl** to crawl, Esc to release the mouse. Press the same key again to rise if the ceiling allows it.
- **Phone:** the left pad walks; push it further out to run. Drag on the right side of the screen to look. The big round **Stab** button attacks. **Crouch**, **Crawl**, **1st person**, **Jump** and (next to a horse) **Ride / Dismount** sit bottom right. The **☰** button opens the rest (New cave, Carlsbad, seed, sound, music, reset tally).
- Low passages will not duck for you. A standing player is blocked until they choose to crouch, and the tightest squeezes need crawl. A short hint appears when a low passage is ahead.
- Your torch is the only light; past about 10 m the cave fades to black. Depth and distance are shown at the top left, with a north-up plan of the cave at the top right (the stream is drawn in blue-green).
- A warm glow marks the way out. **New cave** builds another layout. Type a seed and press **Load** to replay one. Each cave has at least one large, high-ceilinged cavern, and the route to the exit is always passable at least by crawling.
- **Sound on / off** mutes everything (dripping, flowing water, echo, music). **Music on / off** (or **M**) toggles only the creepy score. Sound starts after the first click or tap.
- Stalactites, stalagmites, columns, flowstone, and soda straws are placed from the seed, denser in caverns. A shallow stream runs along some floors and falls into a pool, usually in a cavern. Water is walkable and will not trap you.
- You cannot walk out through walls, floors, ceilings, or junctions. If anything ever pushed you outside, you are placed back at the last valid footing.

## Act I: The Empty Camp (story slice)

The story foundation is in `docs/STORY.md`. Act I takes about 20–40 minutes:

1. You wake at dawn in the ruined River-Tooth camp. The fire is cold, the huts are slashed (the shaman's is torn open), and the dead lie with their mouths open beside old blood spirals.
2. Old Lume is still breathing by the fire. Kneel by him (**E** or the **Interact** button) to hear his last words ("the caves opened their throats… wear the faces so the mouths stay closed"). He gives you a stone knife and a half-finished bone spear, then dies.
3. **Survive.** Hunger, thirst and stamina meters sit top-left; running drains stamina. Pick berries and dig up roots at the bushes, drink at the stream, and eat from the **Pack** (Inventory). Inventory slots are limited: 6, or 12 with a backpack.
4. **Hunt.** Rabbits and birds bolt; deer notice you sooner and flee as a herd. Crouch to stalk. The spear kills, and the knife harvests meat, pelt or hide, and an organ. Eating an organ gives a 90-second stamina boost. Relight the fire to learn Fire-starting, then cook meat there.
5. **Craft** (Tab, or Pack → Crafting). Make a backpack from the deer hide, or from Tor's skin, a grim choice you make at his body. You can also finish the bone spear with a rabbit pelt for +1 damage.
6. **The first throat.** Waterfall Hollow is a short, dark, dripping cave beside the falls up the stream. Inside, a pale, too-toothed rat-thing hunts you.
   - Kill it, then collect its blood and organ.
   - Paint a blood glyph (spiral, hand or mouth) on a wall. It persists.
   - Take the dead hunter's face; the face count adds a heart.
   - Eat the creature's organ for **Blood Memory**: choose +Strength or +Health.
7. **Home.** Leaving the hollow autosaves. Rest at the fire to save and finish the act. After a death you return to the last save, keeping your faces, skills and Blood Memory.

**Skills** (K): Stone Tools, Basic Tracking (animals appear on the map), Fire-starting, Blood Memory.

**Controls added:**
- **Desktop:** **E** interact (Space also advances dialogue), **I** inventory, **Tab** crafting, **K** skills, **Esc** closes panels, **T** skips an hour (Shift+T goes back), **Y** cycles the weather.
- **Phone:** a contextual action button appears above Stab when something can be used. **Pack** opens inventory, crafting and skills. **Main menu** is in the ☰ panel.

## Day, night and weather

The overworld has continuous time (22 real minutes per day by default). Caves stay dark.
- The sun and moon follow arcs across the sky, with sunrise and sunset gradients, stars at night, and drifting procedural clouds. The sun, sky light, ambient light and fog colours all follow the time of day.
- Weather blends smoothly between clear, overcast, fog, rain, snow and storm. Above about 70 m, rain falls as snow.
- Storms bring lightning flashes and distance-delayed thunder.
- The ambience follows the time and weather: birdsong at dawn, crickets and owls at night, and rain hiss.
- The torch matters at night: it runs at full strength in the dark and dims to 30% in daylight.
- Particle counts are lower on phones (900 rain / 600 snow).
- The camp has a sparse, sad theme and the dawn has a rising one.

**Architecture:**
- `js/world/atmosphere.js`: sky dome shader, stars, precipitation and the light/fog driver.
- `js/act1/`:
  - `camp.js`: camp, bodies and waterfall; static meshes are baked per material.
  - `animals.js`: wildlife.
  - `survival.js`: items, meters, recipes and saves (localStorage key `flesh.save.v1`).
  - `story.js`: objectives, interactions, glyphs and Blood Memory.
  - `ui.js`: HUD, dialogue, panels and menu.
- The camp, pool and stream bed are carved into the deterministic terrain height function, so collision follows automatically.

## Look and sound (design notes)

- **Rock surface:** world-space triplanar mapping of a tileable procedural limestone texture (two scales to hide tiling), so floors and big halls no longer stretch or streak. Mud tint on up-facing surfaces, glossy wet patches (low roughness), iron/grey strata in vertex colours, and bump detail from the texture height via screen-space derivatives (no tangents). `MeshStandardMaterial` (cheaper than the old physical/clearcoat material) to keep phones smooth.
- **Walls:** displacement noise is sampled at each surface point's world position, so passages are lumpy all the way round and overlapping tubes share the same rock. Caverns use a boxier superellipse section plus large low-frequency lumps (alcoves, buttresses, ceiling pockets, stepped ledges). Hall walls only bulge outward, so they never intrude on the walkable (collision) area.
- **Junctions:** every junction, sharp bend, wide room and dead end gets a lumpy inward-facing rock "hub" that fills the wedge gaps between tube ends; its triangles inside any nearby passage are dropped so openings stay clear. Dead ends are now rounded rock instead of flat caps (the old caps faced the wrong way and showed as dark holes). A dark back-face pass (no depth write) is drawn first, so any remaining sliver reads as shadowed rock rather than void. Collision is unchanged (still the LRUD tube/hub volume).
- **Lighting (torch only):** one warm, flickering `PointLight` (0xffa05a, range 15 m) carried in the caveman's left hand, with GPU-animated flame and ember particles. Black exponential fog (density 0.085) gives about 8–12 m of useful light. The ambient is near-black (0x0d0b10 at 0.35). There are no other lights: the old headlamp, spill and fill lights, dust and baked show-cave lighting are gone in both modes. The caveman's materials carry a faint warm self-glow, so his back reads against the dark when seen from behind.
- **Water:** the waterfall pours from high on a side wall of the pool chamber, with its base snapped to the real floor by raycast. Two curved, layered sheets of scrolling strands that break up into spray, GPU-animated falling droplets, rising mist, and expanding ripples/foam at the pool. Water is lit by distance from the torch so it never glows in the dark.
- **Music (`js/music.js`): a cinematic score in a big-film style.** It's an original procedural composition: Web Audio only, no samples or files, mixed under the water ambience.
  - **Core:**
    - low string pads (detuned saws) moving slowly through D minor: i–VI–III–VII (Dm–Bb–F–C), darkening to i–bII–VII–i (Dm–Eb–C–Dm) when tense
    - a sub bass under the pads
    - "braam" low-brass hits: a stack of detuned saw/square waves, distorted, with a lowpass sweep and a huge reverb
    - a tick-tock clock motif
    - string-like spiccato ostinato
    - taiko-style drums
    - Shepard-tone risers that seem to rise forever
    - sub drops
  - **Zones** (crossfaded):
    - *Entrance:* airy wind and high string harmonics, soft pads.
    - *Corridor:* low strings, clock ticks and the ostinato as tension builds.
    - *Squeeze:* everything muffled, a beating semitone cluster and a heartbeat.
    - *Big Room / halls:* organ-like swells over full pads, huge reverb, distant braams, darker harmony when tense.
  - **Intensity:** tension (0–1) rises with depth, sustained walking, squeezes and darkness. *Running* is what pushes it to the top. It relaxes a few seconds after you stop. Tempo runs from 60 to 140 BPM.
    - *Calm (awe):* long chords and pads.
    - *Creepy:* clock ticks appear.
    - *Tense:* spiccato in 8ths, then 16ths; drums enter; braams on chord changes.
    - *Blood-pumping:* double drums with fills, a Shepard riser that ends in a braam, and a braam every bar or two.
  - **"Something's near":** one huge braam, then near-total silence with a single clock tick, then the pulse returns harder.
  - **Phone cost:** about 20 persistent oscillators, reused with glides; one shared convolver; one shared braam distortion chain; short notes capped at about 28 voices.

## Caveman, monster and combat

- **Caveman (`js/caveman.js`):** an original low-poly model with a hide tunic, fur shoulders, wild hair and beard, bare arms and legs. He holds a torch in his left hand and a stone-tipped spear in his right.
  - Procedural animation: walk and run gait, a crouch pose and a crawl pose (body pitched forward), plus a spear thrust (0.38 s).
- **Camera:**
  - **Third person:** an over-the-shoulder chase camera. It marches back from the eye through the collision volume and pulls in at walls. It clamps its height between the floor and the ceiling and eases back out.
  - **Close distances:** it is shorter when crouched and very close when crawling. If there is under 0.75 m of room, it switches to first person automatically.
  - **First person:** **V** or the **1st person** button gives a first-person view with the arms, torch and spear in view.
- **Monster (`js/monster.js`):** an original pale, eyeless, long-limbed, hunched crawler with ribs, a toothed jaw and claws. It is a procedural mesh.
  - **Spawning:** it spawns 40–115 m of passage away from you.
  - **States:** roam → investigate → chase → lunge/attack, plus stagger → flee → back to investigate. It loses track after 4.5 s without a cue. While roaming, it mostly searches around your general area.
  - **Hearing:** noise × 38 m. Noise is 0.36–1.0 when walking or running, 0.16 crouched and 0.10 crawling, and stabbing makes a burst.
  - **Sight:** it sees your torch within 17 m if there is a clear line of sight through the volume.
  - **Movement:** it moves along the station centerline graph (Dijkstra) with floor following, so it never clips walls. Speeds: roam 1.25, investigate 2.1, chase 3.4 m/s (between your walk and run speeds) and lunge 7.2 m/s.
  - **Music:** a chase drives the score to maximum intensity.
- **Monster voice (`js/monster-voice.js`):** procedural, positional sound (an HRTF-free equal-power panner, an inverse-distance model and its own long reverb that increases with distance). Every sound has a cooldown.
  - **Shriek:** about 1.5 s of layered, detuned screeching formants, a noise burst, a pitch bend and distortion. It plays on spotting you or starting a chase and ducks the music for 1.7 s.
  - **Growl/rattle:** when close.
  - **Wet clicking:** while hunting.
  - **Distant echoing wails:** while roaming.
  - **Pained screech:** when stabbed.
  - **Death howl:** when killed; it also ducks the music.
- **Combat:**
  - **Your attack:** a spear thrust (0.6 s cooldown) that lands at 0.14 s. It hits within 2.7 m in a 50° forward cone.
  - **Monster health:** 3 HP. Each hit staggers it and knocks it back; it then flees and returns.
  - **Your health:** 3 HP. Each hit gives a red vignette and screen shake, with 1 s of invulnerability afterwards. You regenerate 1 HP per 25 s.
  - **Death:** "You were taken", then you respawn at the entrance and the monster is moved far away.
  - **Kills:** a kill shows **KILL** and adds to the tally, and a new monster spawns far away 10 s later.
  - **Tally:** the HUD shows hearts, kills and deaths. Kills and deaths are saved in `localStorage` (`cavern.kills`, `cavern.deaths`); **Reset tally** clears them.
- **Map:**
  - **Random caves:** they branch more, with side tunnels, dead-end grottos and side rooms (spurs ending in chambers), plus loop closures that connect nearby passages. They have about 80–100 stations, 18–20 dead ends, 13–18 chambers and 1–3 loops.
  - **Minimap:** it now uses fog of war. It is centred on you at a fixed scale and draws only the passages you have explored (names and the exit appear once found).

## Carlsbad Caverns mode

Press **Carlsbad** or open `?cave=carlsbad`. Random seeds still work as before (**New cave**, seed box, `?seed=`).

- **Layout (`data/carlsbad.json`, generated by `tools/make_carlsbad.py`):** 51 stations, 53 legs. The route starts at the Natural Entrance and goes down past Bat Cave (an unlit side branch), Devil's Spring, Devil's Den, Whale's Mouth, the Main Corridor, Iceberg Rock, Green Lake Overlook and the Boneyard (tight) to the Underground Lunchroom. The exit is the elevators, about 230 m down. From the Lunchroom, the Big Room loop runs Hall of Giants → Temple of the Sun → Crystal Spring Dome → Rock of Ages → Painted Grotto → Mirror Lake → Bottomless Pit → Top of the Cross → Totem Pole → Shortcut, with a branch to Lower Cave. Big Room spaces are 50–95 m wide and 30–70 m high.
  - **Added in round 5 (for gameplay):**
    - the King's Palace loop: King's Palace, Queen's Chamber with draperies, Papoose Room, Green Lake Room with a pool
    - the Left Hand Tunnel, with a pool at its end
    - dead-end grottos off Devil's Den, Green Lake, Painted Grotto and Bottomless Pit
    - a loop around the Main Corridor
    - a crawl off Iceberg Rock into a small grotto
  - These real rooms are placed approximately, and the grottos and small loops are invented.
- Named places show under the depth readout and as dots on the minimap.
- **Look:**
  - creamy tan/white limestone
  - no trail, handrails, string lights or floodlights any more: it is dark and lit only by your torch, like the random caves
  - giant tiered, fluted stalagmites and stalactites, soda straws and draperies
  - named formations built as profile meshes with popcorn texture: Giant Dome, Twin Domes, Totem Pole, Rock of Ages, Crystal Spring Dome, Iceberg Rock boulder, Whale's Mouth curtains, and the Bottomless Pit (a black opening you can't walk into)
- **Sources (used for reference only; no images are shipped):**
  - NPS Carlsbad Caverns *Accessible Route / Big Room* trail map (PDF)
  - NPS Carlsbad Caverns interior map (npmaps.com)
  - nps.gov "Self-Guided Tours" and "Cavern Trails and Tours" pages for route order, depths (Natural Entrance trail about 230 m / 750 ft descent, Big Room about 1.5 km loop, ceilings up to ~78 m / 255 ft)
  - public NPS photos for colour and formation style
- **Assumptions:**
  - Positions are hand-traced and approximate, not a survey.
  - The Natural Entrance switchbacks are simplified into one steep ramp.
  - Passage widths and heights are estimated.
  - Doll's Theater and some minor side spots are left out.
  - The Bottomless Pit is a visual opening, not a modelled shaft.


## World streaming and the overworld (architecture)

Code is in `js/world/`. The goal: an open world with many caves, where only the area around the player is ever built.

- **Resident vs. streamed:**
  - **Resident (always in memory, lightweight data):** the cave graph (stations, legs, LRUD), the terrain height function and its parameters, the entrance list, formation placement lists, colliders, and the water surfaces and portal lights.
  - Collision, the minimap, monster AI, music zones and floor queries all run on this data, never on meshes, so **collision is valid before any visual chunk has loaded**.
  - **Streamed (built per chunk, disposed on unload):** cave wall meshes, formations (instanced per cell), named Carlsbad features, terrain meshes, trees, rocks and grass.
- **ChunkManager (`chunk-manager.js`):**
  - Generic for both worlds. Each layer reports which keys it wants, with a priority, and which keys it keeps.
  - Builds are generator jobs, time-sliced to about **3.5 ms per frame**; big tubes and halls yield partway through.
  - At most 4 unloads per frame. Priority favours cells ahead of where you look and move.
  - A teleport or spawn `prime()`s the nearby cells synchronously, behind the fade.
- **Cave cells (`cave-stream.js`):**
  - A 3D grid of 24 m cells. Each passage tube or chamber hub belongs to one cell.
  - Cells are **gated by graph connectivity**: a Dijkstra pass over the cave legs from the player loads pieces within **60 m along passages**. A room on the other side of a wall stays unloaded, however close it is in straight-line distance.
  - **Hysteresis:** loaded pieces are kept out to 85 m, so turning around never thrashes.
  - **Seamless joins:** wall noise is sampled in world space, so a piece built alone is bit-identical to the same piece built in the merged legacy mesh.
- **Overworld (`terrain.js`, `overworld.js`):**
  - Terrain is seeded fbm value noise: rolling hills plus a mountain ridge on the northern horizon.
  - It is a 2D grid of 64 m chunks in **LOD rings**: 32² vertices near you, then 16², then 8², out to about 290 m. 3 m skirts hide LOD cracks.
  - A low-res horizon mesh out to 2.4 km carries the mountain silhouette. It discards its fragments inside the loaded area.
  - Scatter is deterministic per chunk from the seed:
    - instanced pines and junipers, with low-poly versions further out
    - rocks
    - grass tufts near the player, which sway and fade out by about 36 m
  - **Sky:** a dusk/night shader with a west glow, stars and a moon. Moonlight and sky fill light the hills, plus your torch, with distance fog.
  - **Daytime:** a later option. The sky shader, light intensities and fog colour are the only things to change.
  - **Entrances:** placed on hillsides (moderate slope, spaced 60 m or more apart). Each is a rock outcrop with a black arched mouth. Walking into the mouth fades to the cave, where you appear at its entrance station.
  - Walking back to that station (after first going more than 8 m in) fades back to the hillside, just outside the same mouth.
  - **Audio outdoors:** gusting wind, crickets and owls, echo off, no drips. The music has an "outdoor" zone: a low open fifth with a cold high tone and only a rare, distant braam.
- **Debug overlay (G):** shows coloured boxes per chunk and these stats:
  - chunk count and triangles
  - draw calls and triangles drawn
  - geometries, textures and JS heap
  - the slowest build job and frame time

### Before / after (Carlsbad, 1280×800, six checkpoints, averages)

| | Before (one mesh) | After (streamed) |
|---|---|---|
| Triangles drawn per frame | ~605k | ~25k (8k–38k) |
| Triangles in scene | 644k | ~57k (18k–91k) |
| Geometry memory | 6.1 MB | 0.3–1.0 MB |
| JS heap | ~15.8 MB | ~12.3 MB |
| Draw calls | ~38 | ~55 (41–70) |

Draw calls go up slightly because each cell is its own mesh. The triangle count and memory now depend on where you are, not on the size of the cave.

- **Full Carlsbad trail walk with streaming (2 × ~1977 m):**
  - every station reached, 0 rescues, 0 frames in the air, 0 times the player reached unloaded geometry
  - at most 115 chunks loaded; 954 loads / 941 unloads
  - worst frame 6.2 ms, 0 frames over budget
- **Overworld walks (450 m and 350 m):**
  - at most 108 chunks; about 65–110k triangles drawn and about 100 draw calls
  - worst streaming frame 4.8 ms

## Changelog

- **Round 12: Faster running, settlements, people, horses, jumping (+ playtest round-3 minors).**
  - *Running 3x:* standing sprint 4.6 → **13.8 m/s**; walk 2.3 → 2.6 m/s (crouch 1.35 / crawl 0.78 unchanged). Stride, footstep cadence and the caveman's run cycle lengthen with speed. The main loop now substeps by distance as well as time (≤ 0.15 m per step, max 16 per frame). Cave check (seed 42, bots shoving into walls at full sprint): 0 rescues, and crossings per metre travelled match the old 4.6 m/s baseline (without substeps it would be ~10x worse). Chunk streaming keeps up (LOAD_RING 4 × 64 m is ~19 s of sprinting ahead).
  - *Settlements* (`js/world/settlements.js`), seeded per world and placed 140-1050 m from the origin. They keep away from the Act I camp (≥130-260 m), the falls and every cave mouth (≥80-150 m), on flat, low ground: **2 lakeside towns** (a 22 × 8 m longhouse on a plaza, 38-52 huts, radial and ring paths, drying racks, canoes on a carved lake), **5 villages** (10-20 huts inside a palisade with a gate, racks, a central fire) and **9 camps** (3-5 hide tents round a fire). One village and two camps are always within a short run. Yards are flattened into the terrain, trees and wildlife stay out, and huts, tents, posts, fires, racks, the longhouse and the lake shore are solid. Each one is built lazily as about 8 instanced draws within 480 m (380 m on phones) and dropped past 600 m. Names show on the minimap (far ones as pips on the rim) and as the place label when you walk in.
  - *People* (`js/world/people.js`): low-poly cavefolk in 6 instanced draws for everyone. They walk between hut doors, racks, the shore and the fires (through the plaza), stand about, sit at fires, carry bundles on a shoulder, stop for you, and turn to look when you're close. Camp 3-5, village 8-14, town 22-30 each (about 45% on phones). **Cap 110 desktop / 40 phone**, drawn within 95 m / 60 m, removed with their settlement. They are non-hostile and can't be hurt: spears and arrows pass through them.
  - *Wild horses:* herds of 3-5 on open grassland (about 1 cell in 4) plus one herd 45-85 m from the Act I camp. They have bay and dun coats. Walking up only makes them watch you; running at them or hurting them makes the herd bolt. Unridden horses can be hunted (2 hits; 4 meat, 2 hide, 1 organ).
  - *Riding:* **E** (desktop) or the **Ride** button (phone) within 3.6 m of a horse mounts it; E / **Dismount** gets off to the side. Trot 5.5 m/s, gallop (Shift / stick pushed all the way) **19.5 m/s** with no stamina cost. You get a raised third-person camera (always third person while riding), hoofbeats, and a walk → gallop leg cycle. Spear and bow work from the saddle. Entering a cave leaves the horse at the mouth.
  - *Jumping:* **Space** or the **Jump** button, about 1.0 m (1.2 m on a horse). Standing or mounted only, not crouched or crawling. In caves the take-off is cut so the head never passes the ceiling, and there's no jump with under 0.25 m headroom. While airborne the wall collider also tests the body's raised heights. Seed-42 bot check with jumps every 20 frames: 0 rescues.
  - *Playtest round 3:* the chase camera now stays out of the camp's hut and tent hide cones (and the new settlement huts and longhouse); with no room it falls back to first person. The mouth cap is now unlit and exactly `CAVE_BG`, so there's no faint grey disc looking up the Natural Entrance.

- **Round 11: Playtest round-2 fixes.**
  - *No sky inside Carlsbad (the major):*
    - The pale patch about 16 m down the Natural Entrance (`placeAt("NE1")`) was the entrance's daylight disc, seen from 36 m through the span.
    - The disc now fades with distance from the viewer: full within 7 m, gone by 15 m. It is transparent and doesn't write depth.
    - A dark rock cap now sits just outside every cave mouth, behind the disc, so past the mouth there is rock, never sky or void. The chase camera treats the cap as solid.
    - `CAVE_BG` is darker (0x20160e → 0x0d0907) to match the black fog. A distant gap, such as an unstreamed cell far down the Natural Entrance (the "flat gray patch"), now reads as fogged dark instead of a gray slab.
    - Checked at NE1 over 24 angles (third and first person, 6 yaws × 2 pitches): no sky pixels. Standing at the mouth and looking out still shows daylight, as intended.
  - *About panel:* z-index 8 → 30 (above the main menu's 19), background 0.94 → 0.98 opacity. Credits and help are readable over the menu on desktop and phone.
  - *Camp props are solid:* the Act I fire ring (stones and logs) and the hide huts are now circle colliders in the overworld. You stop about 1.2 m from the fire's centre, still inside its 2.6 m use range, and about 2 m from a hut. This fixes the tent clipping from round 1. The torn shaman hut blocks only at its centre poles.
- **Round 10: Playtest round-1 fixes (licensing, camera, seams, first-minute polish).**
  - *Licensing (blocker):* `vendor/three-mesh-bvh.module.js` is identified by SHA-256 as the unmodified npm build of three-mesh-bvh **0.8.3** (MIT, © 2018 Garrett Johnson, github.com/gkjohnson/three-mesh-bvh). It now has a licence header. `vendor/three.module.min.js` is byte-identical to three r170 (`three@0.170.0`, MIT). Added `THIRD_PARTY_NOTICES.md` and full licence texts in `licenses/`. The in-game About credits and the README Stack / Licence sections now name both libraries. They also say that art and audio are procedural and list the Carlsbad NPS map sources (the old "no real survey is bundled" line is gone).
  - *Chase camera stays in the rock:* in caves the eye→camera segment is ray-cast against the rendered passage mesh (BVH, 5 parallel rays for the near-plane footprint, 0.35 m margin). The camera is pulled in front of any wall, the entrance's daylight disc, or the open cave mouth's plane. Cave starts now put Kra about 3 m inside the mouth instead of on its lip. Result: no sky or void behind Kra at `?seed=90210`, `?cave=carlsbad`, or when entering from the hills. If there's no room, the existing fallback switches to first person.
  - *Seams and holes:*
    - A tube that joins two halls no longer cuts their domes. Before, it removed ceiling that the tube itself never covered.
    - Overlapping halls keep a margin of dome (0.92 → 0.78 for the roof).
    - The daylight disc is now fogged, so it no longer shows as pale sky through gaps deep inside.
    - Mud Vein big hall (S87/S53), 12 look directions: void pixels dropped from 61,435 to 3,580 (−94%).
    - A soft short-range torch spill around the camera (cave only; 6, 8 m) lights rock lips that face away from the torch. These used to render as black triangles ("shards") at junctions.
    - Seed-42 checks unchanged from round 9: walk routes 15/15; wall-poke matches the round-9 build exactly (same crossings).
  - *Control hint:* now a small panel low on the screen (desktop) or under the HUD (phone), never over the title card. It appears after a game starts (after the Act I title card), hides on its own after about 8–9 s or about 2.5 s after the first move or click, and shows briefly again only when you leave mouse-look. The 15%-opacity "dim" state that lingered all session is gone.
  - *Spawn framing:* fresh overworld spawns look down 0.2 rad (was −0.05), so the camp, the bodies and Lume (Act I) or the cave mouth (Free Play) fill a desktop frame instead of the sky.
  - *Story-mode toolbar:* in Act I the toolbar shows only Main menu, Pack, Sound and Music. The prototype tools (Hills, New cave, Carlsbad, Seed/Load, Reset tally, Debug, Open survey) are hidden unless the URL has `?debug=1`. Free Play and direct cave starts keep the full toolbar.
  - *Smaller:* `__CAVE__.queryFloor` no longer throws outdoors. A duplicate `look` test hook is renamed `setLook`. Free Play starts at dusk (19:24) by design.
- **Round 9: Brighter torch, catchable game, a bow, cleaner junctions.**
  - *Torch about 5x:* PointLight intensity 12 → 26, decay 1.5 → 1.0, reach 24.5 → 45 m. That is about 5x the light at 8 m and about 7x at 16 m, but only about 1.9x at arm's length, so near walls don't wash out. Cave fog density 0.058 → 0.032. Cave ambient fill 0.5+1.1·hall → 1.5+1.0·hall (still dark brown). Hall lights reach torch + 20 m.
  - *Prey is easier:* flee speeds roughly halved (rabbit 6.2 → 3.2, bird 7.5 → 4.0, deer 8.2 → 4.2, boar 6.8 → 3.5, goat 7.4 → 3.8, fox 7.8 → 4.0 m/s). Alert radii are about 40% smaller, flee bursts last 2.5–3.5 s, and animals are "tired" for 3 s afterwards (no re-flee). Spear reach is 3.8–4.2 m (was 2.9–3.3) with a wider hit cone. Small prey and deer die in one hit; boar takes 2.
  - *3x animals:* overworld roaming groups are 4–5 per 64 m cell (lite 3–4; was 1–2), capped at 280 (lite 110). The camp has 15 rabbits, 12 birds and 3 deer herds. Measured: 243 animals on desktop (was 94), 58 on phone. Cave fauna caps: bats 480/200, spiders 120/54, fish 108/48 (was 170/70, 40/18, 36/16).
  - *Bow and arrow:* press **Q** or **B** (or the Bow/Spear button) to switch weapons. **F** or left-click shoots, aimed at the centre reticle; on phone the big button becomes SHOOT and the arrow flies along the camera centre. Arrows fly at 40 m/s with gravity, with automatic range compensation to the aimed point. They hit animals, cave fauna and the monster (kills count in the tally) and stick into rock or ground. Arrows are unlimited, with twang and hit sounds. New file: `js/archery.js`.
  - *Cave geometry:* the junction backfill is now lit, textured rock (it was a flat dark material that showed as black holes and shards). Tube and hub clip shells overlap slightly (0.99 → 0.86, 0.97 → 0.90), which closes the seams at junctions and openings. Wall-poke test: 6000 steps, 0 crossings. Cave background is dark rock-brown instead of black.
  - *Known remaining issues:* some flat facets at junctions. The seed-7 S33 squeeze is narrowed by a crossing passage.
- **Round 8: Solid rock, bigger halls, more life.**
  - **Walls and physics:** cave walls now collide against the rendered rock itself (BVH raycasts against the passage meshes, vendored `three-mesh-bvh`), so dead ends, stubs and side branches are solid everywhere. Rock noise bulges outward only, tubes are clipped where passages overlap (no stray wall slabs across junctions), and floor blending ignores passages on other levels, so ridges and junctions such as Mud Vein S6 no longer snag or lift you.
  - **Water:** the overworld stream was being back-face culled and was invisible; it is now drawn, sits on the real ground, and drinking only works within reach of it or the pool. Cave streams and pools are lifted onto the rendered floor as the rock streams in, and you can drink from them in story mode.
  - **Torch:** about 22% brighter (intensity 11.5 → 14) with a longer throw (21 → 24.5 m), and longer still in big halls; caves stay dark.
  - **Caverns:** halls are 2–3× wider and taller (22–36 m across, 18–30 m high) with two big side alcoves each. Their floors stay at passage level and they are placed clear of other passages. They are filled with formations: giant stalagmites, stalactites hanging from the dome, columns, flowstone drapes and rimstone. A faint fill light makes a hall's size readable.
  - **Animals:** the overworld now has a roaming population of rabbits, birds, deer, boar, goats and foxes, streamed per 64 m cell. Cells restock when you come back. Kills count in the Kills tally, and carcasses give meat, hide, pelt and organs. Free play can hunt too.
  - **Cave life (harmless):** bat flocks roost under high ceilings and scatter when the torch gets close or you make noise. Fish swim in cave streams and pools, and spiders sit on the walls and scuttle away from the torch. All of them can be speared: bats and fish give a scrap of meat, and each kill counts.
  - **Cave mouths:** a solid rock arch now frames each overworld entrance, so the black opening meets rock all round with no gaps.
  - **Known issues:**
    - Where two passages cross at different heights, a squeeze can be partly closed by the other passage's rock. The collision matches what you see there, but it can block the way (seen on seed 7 at S33).
    - Bats are simple flapping silhouettes.
    - The inside of the cave mouth is unchanged.

- **Round 7: Act I and the living sky.**
  - Day/night cycle and six blended weather states, with lightning, thunder and time-driven ambience; debug keys T and Y.
  - Act I is the new-game start: the ruined camp, Old Lume's dialogue with a murmured voice, survival meters, foraging, hunting (rabbits, birds, a deer herd), harvesting, fire and cooking, crafting (backpack, spear), and Waterfall Hollow with the rat-thing, blood glyphs, face-taking and Blood Memory.
  - Also added: saves, death returning you to the last save, the main menu, camp and dawn music, and contextual phone controls.
  - Tested with scripted playthroughs of the whole act on desktop 1280×800 and phone 390×844 with no console errors, plus a weather and time-lapse run and regression runs of free play, `?cave=carlsbad` and `?seed=42`.
  - **Known issues:**
    - The camera can sit behind Kra and hide what he is facing at close range; switch to first person (V).
    - Rain is faint against a bright overcast sky.
    - The headless test GPU cannot exercise pointer lock, so the "Click to look" hint stays visible in test screenshots.
    - Animals respawn about 60 s after harvest, only when you are far away.

- **Round 6: Streaming and the overworld.**
  - **Streaming:** a world-streaming system (ChunkManager, cave cells gated by passage distance, time-sliced builds, G debug overlay) replaces whole-cave meshes; see the architecture section.
  - **Overworld:** the first slice of the open world. Hills, a mountain ridge, pines, junipers, rocks, grass, a dusk sky with moon, and several random cave entrances (one is Carlsbad). Transitions fade in and out, and you return to the same entrance.
  - **Audio:** outdoor wind, night ambience and an outdoor music zone.
  - **Phone layout:** the "Low passage" hint now sits bottom-left, clear of the ☰ menu panel, and hides while the menu is open. The debug panel sits clear of the toolbar.
  - **Known issues:**
    - In one generated cave (seed 892277204), a junction near S3 has a collision pinch where a scripted walk sticks. It is pre-existing (the round 5 build does the same); you can walk around it.
    - On the steepest ridge slopes downhill, running can leave you briefly airborne (up to about 5 m) before you land.
    - Outdoors uses about 100–150 draw calls. The trees could be merged per LOD ring later.
    - The first startup build can show one long job (about 10 ms) before the first fade completes.
    - Phone performance is still tested only in an emulated viewport.
    - The seed 7 stress threshold is unchanged from round 5.


- **Round 5: Torch, caveman and monster.**
  - **Lighting:** the trail, handrails, posts, path lamps and electric floods/ceiling wash are removed. Lighting is now a single flickering torch with flame and ember particles, and dense black fog.
  - **Caveman:** a new caveman with a torch and a stone-tipped spear, a third-person chase camera with wall collision and a V toggle for first person.
  - **Monster:**
    - a pale, eyeless, hunting crawler with roam/investigate/chase/attack AI, hearing and torch sight, and graph navigation
    - a positional procedural voice set (shriek, growl, clicks, wails, pain, death howl) with music ducking
  - **Combat:** spear combat with a kill/death tally saved in localStorage, plus a death screen and respawn.
  - **Map:** more rooms, side tunnels, grottos and loops (random and Carlsbad), and a fog-of-war minimap.
  - **Phone layout:** the toolbar collapses into a ☰ menu, so it no longer covers the place name. There's a big Stab button.
  - **Known issues:**
    - Phone performance is tested only in an emulated 390×844 viewport, not on real hardware.
    - The stress test on seed 7 still flags a standing player getting within 0.75 m of a crawl station. It has no wall escapes; it's a strict test threshold, carried over from round 3.

- **Cinematic score:** replaces the old horror score with braams, low strings, clock ticks, spiccato ostinato, taiko drums, Shepard risers, sub drops and Big Room organ swells, keeping the zones and the intensity arc. Running now drives tension much harder than walking.
- **Analog movement:**
  - On phones, speed follows how far you push the joystick:
    - dead zone below 12%
    - slow creep up to a full walk (2.3 m/s) at 85%
    - running (4.6 m/s) at or past the edge; the ring glows warm when you're running
  - Speed eases in and out. Desktop walks by default and runs with **Shift**; crouch and crawl keep their speed caps.
  - Subtle head bob and footsteps whose rate follows your speed.
- **Smoother walking (Carlsbad playtest fix):**
  - The ground height is now continuous: junctions blend the sloped floors of their legs instead of using one flat floor. That flat floor caused the pop-up, then drop, and the blocked steps.
  - Rises are eased, small descents stick to the ground, and only real drops use gravity.
  - Named formations, such as the Iceberg Rock collider, are kept clear of the trail; the trail, rails, posts and lamps never collide.
  - Movement runs in fixed sub-steps, so it's frame-rate independent.
  - A scripted walk of the full Carlsbad trail (~2 km, 15–60 fps, walking and running, on and off the centre line) never gets stuck, has no rescues and never leaves the ground.
- **Phone performance:**
  - pixel ratio capped at 1.5 on touch devices, with adaptive resolution that drops when frames are slow and recovers when fast
  - no MSAA on phones
  - lighter dripstone geometry on phones
- Test hooks: `__CAVE__.walkRoute()`, `__CAVE__.joySpeedTable()`, `__CAVE__.musicMeter()`.

- **Realism pass:** triplanar rock texture, mud and wet sheen, strata colours, bump detail, irregular cavern walls and ceilings, ceiling fill light, headlamp dust.
- **Junction seams:** rock hubs at junctions, bends and dead ends, plus a back-face safety net. Fixes the dark holes at dead-end alcoves.
- **Waterfall:** layered strand sheets, droplets, mist, splash ripples, and correct placement on the floor.
- **Floor:** no more UV streaking.
- **Music:** creepy procedural score that responds to movement and depth. Music button plus **M** key; the setting is remembered.
- **Carlsbad Caverns mode:** map-based layout, show-cave lighting, trail and handrails, giant formations, named places on the HUD and minimap. See above.
- **Music v2:** zone-based moods with crossfades, a tension arc from creepy to heart-pounding (heartbeat, ostinato, drums, risers, stingers), and scripted "something's near" scares.
- Test hooks: `__CAVE__.placeAt()`, `__CAVE__.forceNear()`, `?shot=junction` and `?shot=fallclose`, plus `__CAVE__.audioState()` and `__CAVE__.water()`.

## Survey format

Caves are stored as JSON (or a simple CSV) so a real survey can be plugged in later. Coordinates are metres: `x` east, `y` north, `z` up. Each station has left, right, up, and down distances from the centerline, in the same spirit as Survex or Compass passage data.

See the in-game About panel for a complete example. Use **Open survey** to load a `.json` or `.csv` file.

This build does not ship a real-world survey. Layouts are generated from a seed, and the generator records the same character stats (typical widths, branching, leg length, slope, chambers) that a later survey could supply.

## Stack

Plain HTML, CSS, and JavaScript with [Three.js](https://threejs.org/) r170 (MIT) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.8.3 (MIT, Garrett Johnson), both vendored unmodified under `vendor/`. No build step.

## Licence

Game code in this folder is © 2026 Jeff Chadburn, released under the MIT License (see [LICENSE](LICENSE)). Third-party code: three.js r170 (MIT, © 2010-2024 three.js authors) and three-mesh-bvh 0.8.3 (MIT, © 2018 Garrett Johnson). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the full licence texts in `licenses/`. Textures, sound and music are procedural and original to this game; the Carlsbad layout is traced approximately from public NPS maps (sources in `data/carlsbad.json`), reference only, not affiliated with the NPS.
