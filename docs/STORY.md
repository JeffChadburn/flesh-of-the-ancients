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
