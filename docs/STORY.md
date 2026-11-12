# Flesh of the Ancients — story & design foundation (from the user, 2026-11-11)

## Core premise
You play Kra, a lone young caveman of the River-Tooth tribe, last survivor after the "Night of Open Mouths." Open world: vast, (as realistic as the browser allows) Pleistocene landscape: snow-dusted mountains, roaring waterfalls, crystal streams, misty forests, berry valleys, herds of animals (bison, dire wolves, woolly rhinos, saber-toothed cats, fish, birds, deer). Grounded, beautiful survival: track, hunt, harvest, craft, build camps, improve skills.
Caves are the opposite: procedural, dark, wet, increasingly demented. Twisted monsters (mutated beasts, flesh-constructs, spirit-possessed horrors) whose blood is used for cave paintings and whose organs are eaten for power. Dead tribe members (and other tribes) lie throughout; their face skins are taken, dried, sewn into a growing suit of decaying faces granting armor, health and eerie passives. A backpack is crafted from the body skin of "friends."
Length target 12–18 h. Manual saves at camps, autosaves after major story beats. Death returns to last save (no loss of sewn faces or major skills).

## Act 1: The Empty Camp (~2–3 h)
Kra wakes at dawn in the ruined River-Tooth camp. Fire cold. Tribe gone or dead in open-mouthed poses. Shaman's hut torn open; ground painted with spirals of old blood. Old Lume, barely alive, whispers "the caves opened their throats" and Kra must "wear the faces so the mouths stay closed." Lume dies after giving Kra a crude stone knife and a half-finished bone spear.
Opening goals:
- Survival basics: gather berries and roots, drink from streams, craft a simple backpack from the first animal hide or the skin of a dead tribesmate near camp.
- Hunt first animals (rabbits, birds, then deer). Animal organs = minor stamina; monster organs later = permanent stat gains.
- Discover the first small cave entrance near a waterfall. Inside: darkness, dripping water, first weak monster (pale, elongated cave rat-thing with too many teeth). Killing it lets Kra paint a simple blood glyph on the wall (painting tutorial). He finds the first dead caveman and takes the face skin.
First skill unlocks: basic tracking, simple stone tools, fire-starting, "Blood Memory" (eating a monster organ permanently raises Strength or Health).

## World & systems
Open world: dynamic weather, day/night, realistic animal AI (herds migrate, predators hunt, scavengers gather at kills). Resources: wood, stone, bone, sinew, hides, plants (edible/medicinal/poisonous), berries, mushrooms, clay, flint. Crafting: stone -> bone-reinforced -> monster-bone/fang weapons. Face armor stacks (each face adds health, damage resistance, small unique bonus: night vision, fear aura, stamina regen). Camps: shelters, drying racks for skins/faces, cooking pits, save points. Backpack starts small, upgraded by sewing larger skins (incl. "friend" skins).
Caves: torch or bioluminescent fungus only. Wrong sounds (breathing walls, distant chewing, amplified heartbeat). Monsters escalate: early pale scavengers, bone-crawlers; mid stitched multi-animal beasts, face-stealers; late living cave paintings, blood golems, "Mouths" (huge tooth-filled orifices whispering in the tribe's language). Blood paintings: record events, open secret passages, weaken monsters, mark a cave "cleansed" for safer revisits. Face suit visibly decays, sinew-stitched; more faces = stronger, but world reacts (animals fear him, weather turns, distant caves "call").

## Acts 2–3: Gathering Faces & Growing Power (~6–10 h)
Biomes: river valley, high mountains, deep forest, frozen plateau.
- The Hunter of Faces: rival Ash-Walker caveman also collecting faces; trades info, warns "wearing too many opens you to the First Mouth"; later mini-boss or ally by choice.
- The Living Cave: walls of moving paintings of the tribe's last days; paint over with monster blood to calm or enrage spirits.
- Spirit of the Shaman: visions after enough faces; teaches advanced crafting, poison, ritual painting; demands faces and organs.
- Set-piece caves: Waterfall Cave (flooded, underwater attackers); Bone Cathedral (stacked bones, boss made of many dead cavemen); The Whispering Gallery (psychological horror, wall faces speak in dead tribe's voices).
Progression: 5 faces -> armor/health boost + backpack upgrade from a friend's full skin. 10+ faces -> monsters appear outside caves at night; paintings start moving. Skill trees: Hunting (tracking, traps, ranged bone spears), Crafting (weapons, face-sewing), Blood Rites (bigger organ bonuses, stronger paintings).

## Act 4: The First Mouth (~3–5 h)
All caves connect to The Throat. The First Mouth: ancient colossal entity opened by a ritual gone wrong; calls the tribe's dead into the caves and births monsters from their flesh and fear; the dead Kra harvested were killed by its servants.
Finale: paint a massive blood mural with blood of several elite monsters while wearing nearly the full suit; the suit becomes partly alive and tries to turn on or protect him (choice/skill check); boss fight vs the First Mouth (multi-faced, uses voices of every collected face).
Endings by faces collected + organs eaten: Sealed (seals Mouth, walks into sunlight in control), Worn (consumed, becomes the new cave guardian), Burned (destroys suit and paintings, escapes weaker but free).

## Supporting systems
Side activities: legendary hunts, rare plants for medicine, optional caves with unique faces, permanent main camp. Saves: camps (manual), after each major story cave, at entrances of big cave systems.

## Additional user requests
- Torch brighter so monsters are visible (done 2026-11-11).
- Day/night cycle with sunrise/sunset, clouds, weather changes.

## Implementation status (round 7, 2026-11-11)

- **Act 1, playable slice (about 20–40 min).** Done:
  - wake at dawn in the ruined camp: huts, the torn shaman hut, open-mouthed dead, blood spirals
  - Old Lume's dialogue and murmur voice, and his gifts (stone knife, half-finished bone spear)
  - hunger, thirst and stamina
  - foraging and the stream
  - rabbits, birds and a fleeing deer herd; harvesting hide, meat and organs
  - organ stamina boost; fire relighting and cooking
  - crafting: a backpack from hide or Tor's skin, finishing the spear
  - Waterfall Hollow: the rat-thing, blood collection, persistent blood glyphs, the dead hunter's face (face count, +1 heart), Blood Memory (+Strength or +Health)
  - skills panel; save at the fire, autosave after the cave, death returning to the save with faces and skills kept
  - main menu (Continue / New Game / Free Play)
- **World.** Done: day/night, the six weather states, ambience and music zones for the camp and dawn.
- **Not yet built:**
  - Acts 2–4: Gathering Faces, Growing Power, The First Mouth
  - more creature types, tribes and NPCs, and a larger crafting tree
  - Kra's face suit as a visible model
  - the full skill tree
  - the act's 2–3 h of content (the slice is a condensed version)

## Implementation status (round 8, 2026-11-11)

- **Done:**
  - solid cave walls (collision uses the rendered rock)
  - smoother slopes and junctions
  - a visible overworld stream, with drinking that matches the real water in caves and outdoors
  - a brighter torch
  - 2–3× larger halls full of formations
  - a roaming overworld population (rabbits, birds, deer, boar, goats, foxes) that respawns as you move, with kills counted
  - harmless cave fauna: bat flocks that scatter, fish, wall spiders (all huntable for small food)
  - rock arches around cave mouths
- **Still to do:** see round 7's list (Acts 2–4, tribes and NPCs, the face suit model, the full skill tree).

## Quest chain (round 16, 2026-11-12)
Act I is quest 1, "The Empty Camp". After it, Kra sees smoke to the west and the chain continues with living people.
In the default world, the town is Tako, the hold is Dunrin Hold, the travellers' camp is Kanatu Rest and the cave is Ash Gallery. Other seeds use their own nearest equivalents.
1. **Smoke to the West:** travel to the lake town and speak with **Elder Haska** (old, slow voice), who sees the dead man's face on Kra.
2. **Proof of the Hunt** (Haska): bring down 2 deer and bring their hides. Reward: the bone-arrow recipe.
3. **The Painted Hall** (Haska): enter the long hall and study the painting of the open mouth. Story beat: the Mouth woke once before, and the old ones shut it with blood on stone.
4. **Throat of Ash** (Haska): explore the nearby cave and bring back flint ("breathing walls; it is spreading west"). Reward: the flint-spear recipe.
5. **Word to the Hold** (Haska): carry a notched message stick to **Warden Orrek**, who reports a stranger in a coat of faces. Reward: the hide-cloak pattern.
6. **The Hunter of Faces** (Orrek): meet **the Ash-Walker** at the travellers' camp. He wears eleven faces and warns: "Wear too many and you open yourself to the First Mouth." **Act II: Gathering Faces** begins.
Side quests: **Neka** (stew: roots and berries, which teaches the salve), **Brannoc** (rabbit pelts, which teaches the fur cap), **Mosi** (feathers for bone).
The skill tree follows the "Skill trees" line above: Hunting, Crafting, Survival and Spirit (the Blood Rites branch, simplified for now).
Next: the Ash-Walker's ally-or-rival choice, more faces, and the Living Cave.

## World regions (round 18, 2026-11-12)

The overworld is now 6.4 km across (±3.2 km). North is −z.

- **Layout:** `js/world/biomes.js` mixes regions by weight. Large-scale noise warps a north–south climate gradient.
  - The **temperate heartland** (start, River-Tooth camp, Tako and the towns, all quest places) is kept within about 1.05 km of the origin and is unchanged.
  - **South** (about 1.0–1.45 km out and beyond): **red-rock canyon country** (banded mesas and benches, winding canyons, hoodoos, rare arches, juniper and sage) and **salt flats & dunes**.
  - **East:** **marsh** (standing water, reeds, dead trees).
  - **North:** **alpine peaks** (ridged, snowcapped, spruce), then **tundra & taiga** beyond about 2 km (spruce, snowfields, glacier ice).
  - **West:** the **ocean** behind a wandering coastline, with a sandy beach (a dark rocky shore in the north).
- **Water:**
  - About 14 rivers start in the high country. Each picks the lowest ground in a fan of headings toward the sea or a lower lake, with a water level that only ever falls, so rises are cut through as gorges.
  - About 16 lakes sit in low, gentle ground, plus the lakes at river ends.
  - Everything is carved into the height function and rendered per chunk as one water sheet with a flowing / rolling shader.
- **Wading and swimming:** wading slows Kra. Deeper than 1.15 m he swims at the surface (slow, no running). A "Swim to shore" button appears, and he is pulled to the nearest dry ground after 60 s or 12 s without progress.
- **Boats (next step):** `terrain.bio.bodies` lists every water body. `terrain.bio.navigable(x, z)` says where a boat could float.


## Settlements & ages (round 20, 2026-11-12)

**Lore.** After the First Mouth swallowed the River-Tooth camp, the tribe that survives is the one Kra builds. The ages are the tribe's rise out of the dark:

| Age | What it means in the story | Needs |
|---|---|---|
| Hide & Hut | The first hearth since the camp went silent: a Founding Stone, a fire, hides on poles. | (found it) |
| Timber | Log walls and thatch, a place meant to last a winter. | 3 people, 40 wood, 10 stone, a workshop |
| Stone | Dressed stone and walls: the tribe stops running from the dark. | 5 people, 40 wood, 60 stone, a quarry |
| Bronze | "Green stone" from the deep caves melted into gold-red metal. The caves that ate the camp now feed it. | 7 people, stone, clay, copper, tin, a kiln + copper smelting |
| Iron & Steel | Black iron, then steel: brick, beams and chimneys. A town, not a camp. | 9 people, iron, coal, stone, a forge + iron working |
| Modern | Stub (later round). | — |

- **Townsfolk** are ordinary people of the other camps. They have heard of the River-Tooth massacre. They fear the face-wearer, warm to a hunter who brings meat, and only follow Kra once they trust him (gifts, trade, deeds). Their rumours point back to the story: caves not yet found, the Ash-Walker, and ore glinting in the deep caves.
- **Unlock in the story:** after the second task (m2), or once Kra knows Herb Lore or Woodcutting. Free play: always.
- **Design notes:** villagers reuse the instanced townsfolk renderer; built buildings are merged into one mesh per settlement; the economy ticks once a second; far-away and offline settlements use an abstract tick (offline catch-up capped at 2 h, at half rate). Colony data is saved in its own key and also inside the story save. NPC towns do not evolve (skipped).
