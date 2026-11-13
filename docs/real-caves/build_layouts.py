#!/usr/bin/env python3
"""Build simplified game layouts of real caves for Flesh of the Ancients.

Writes only to:
  /workspace/cavegame/data/real-caves/<name>.json
  /workspace/cavegame/docs/real-caves/<name>.png
  /workspace/cavegame/docs/real-caves/index.json

Coordinates follow the game survey convention in js/cave-data.js:
  x = east (m), y = north (m), z = up (m), LRUD in metres from the centerline.
Huge systems are scaled down so they play at a similar size to the existing
Carlsbad model. Widths of tight squeezes are kept tight on purpose.

These are playable approximations, not surveys. See each file's source.license.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Rectangle
from matplotlib.collections import LineCollection
import matplotlib.patheffects as pe
import numpy as np

DATA = Path("/workspace/cavegame/data/real-caves")
DOCS = Path("/workspace/cavegame/docs/real-caves")
EXISTING_CARLSBAD = Path("/workspace/cavegame/data/carlsbad.json")

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def st(stations, id, x, y, z, left, right, up, down, kind="passage",
       label=None, zone=None, tags=None, lit=None, **kw):
    s = dict(id=id, x=round(float(x), 2), y=round(float(y), 2),
             z=round(float(z), 2),
             left=round(float(left), 2), right=round(float(right), 2),
             up=round(float(up), 2), down=round(float(down), 2),
             kind=kind)
    if label:
        s["label"] = label
    if zone:
        s["zone"] = zone
    if tags:
        s["tags"] = list(tags)
    if lit is not None:
        s["lit"] = bool(lit)
    s.update(kw)
    stations.append(s)
    return id


def chain(legs, *ids):
    for a, b in zip(ids, ids[1:]):
        legs.append({"from": a, "to": b})


def link(legs, a, b):
    legs.append({"from": a, "to": b})


def infer_modules(cave):
    """Tag each station with a modular piece type for the planned rebuild."""
    deg = {}
    for s in cave["stations"]:
        deg[s["id"]] = 0
    for leg in cave["legs"]:
        if leg["from"] in deg:
            deg[leg["from"]] += 1
        if leg["to"] in deg:
            deg[leg["to"]] += 1
    for s in cave["stations"]:
        tags = s.get("tags") or []
        kind = s.get("kind") or "passage"
        if "pit" in tags or kind == "pit":
            s["module"] = "pit"
        elif "squeeze" in tags or s.get("zone") == "squeeze" or (s["left"] + s["right"]) < 3.0 and s["up"] < 2.2:
            s["module"] = "squeeze"
        elif "hall" in tags or kind in ("cavern", "chamber") and (s["left"] + s["right"]) >= 10:
            s["module"] = "hall"
        elif deg.get(s["id"], 0) >= 3:
            s["module"] = "junction"
        else:
            s["module"] = "tunnel"
    return cave


def dump(cave):
    infer_modules(cave)
    name = cave["seed"]
    path = DATA / f"{name}.json"
    path.write_text(json.dumps(cave, indent=2) + "\n")
    print(f"wrote {path}  {len(cave['stations'])} stations, {len(cave['legs'])} legs")
    return path


# ---------------------------------------------------------------------------
# 1. Lascaux — approximate from published room sizes, not a traced plan
# ---------------------------------------------------------------------------

def build_lascaux():
    S, L = [], []
    # 1:1 metres. Layout follows the well-published branching order
    # (Hall of the Bulls, Axial Gallery west, Passage/Nave/Felines north,
    # Apse and Shaft to the east). Dimensions from standard references
    # (Hall of the Bulls 19 x 5.5–7.5 x ~7 m; Passage ~17 x 4 x 1.2–1.5 m;
    # Nave 18 x 6 x 2.5–8 m; Apse ~4.5 m; Shaft ~6 m deep).
    st(S, "ENT", 10, -2, 0, 2.4, 2.4, 2.2, 0.5, "entrance",
       "Original entrance", "entrance",
       tags=["entrance"])
    st(S, "VEST", 4, -1, -1.2, 2.2, 2.0, 2.4, 0.5, "passage",
       "Vestibule", "entrance", tags=["entrance"])
    # Hall of the Bulls ~19 m long, running WNW
    st(S, "HB1", 0, 0, -2.0, 3.0, 3.2, 6.5, 0.6, "chamber",
       "Hall of the Bulls (east)", "hall",
       tags=["hall", "art wall"])
    st(S, "HB2", -10, 3.5, -2.4, 3.5, 3.8, 7.0, 0.6, "chamber",
       "Hall of the Bulls", "hall",
       tags=["hall", "art wall"])
    st(S, "HB3", -19, 6, -2.8, 2.8, 3.0, 6.2, 0.6, "chamber",
       "Hall of the Bulls (west)", "hall",
       tags=["hall", "art wall"])
    # Axial Gallery ~22 m, hooking south to a dead end
    st(S, "AG1", -28, 4.5, -3.2, 1.8, 1.6, 4.5, 0.5, "passage",
       "Axial Gallery", "art",
       tags=["art wall"])
    st(S, "AG2", -36, 2.5, -3.6, 1.4, 1.5, 3.8, 0.5, "passage",
       None, "art", tags=["art wall"])
    st(S, "AG3", -40, -3, -4.0, 1.1, 1.0, 2.4, 0.4, "passage",
       "Axial Gallery end", "squeeze",
       tags=["squeeze", "art wall"])
    st(S, "AG4", -38, -8, -4.2, 0.9, 0.9, 1.8, 0.35, "passage",
       "Diverticule", "squeeze",
       tags=["squeeze", "art wall"])
    # Passageway north, low ceiling
    st(S, "PAS1", -16, 12, -3.2, 2.0, 2.0, 1.5, 0.4, "passage",
       "The Passageway", "squeeze",
       tags=["squeeze", "art wall"])
    st(S, "PAS2", -14, 20, -3.6, 2.0, 1.8, 1.3, 0.4, "passage",
       None, "squeeze",
       tags=["squeeze", "art wall"])
    # Apse + Shaft to the east
    st(S, "APS", -6, 23, -3.8, 2.3, 2.2, 2.4, 0.5, "chamber",
       "The Apse", "hall",
       tags=["hall", "art wall"])
    st(S, "SFT", 2, 26, -4.2, 1.4, 1.4, 2.0, 0.5, "passage",
       "The Shaft (lip)", "pit",
       tags=["pit"])
    st(S, "SFTB", 5, 28, -10.2, 2.0, 2.2, 2.8, 0.5, "chamber",
       "Shaft chamber", "pit",
       tags=["pit", "art wall"])
    # Nave
    st(S, "NAV1", -16, 30, -4.0, 3.0, 3.0, 5.5, 0.5, "chamber",
       "The Nave", "hall",
       tags=["hall", "art wall"])
    st(S, "NAV2", -19, 42, -4.4, 3.2, 2.8, 7.5, 0.5, "chamber",
       "Nave (crossed bison)", "hall",
       tags=["hall", "art wall"])
    # Chamber of Felines, winding and tightening
    st(S, "FEL1", -24, 52, -4.8, 1.4, 1.3, 2.2, 0.4, "passage",
       "Chamber of the Felines", "art",
       tags=["art wall"])
    st(S, "FEL2", -18, 62, -5.2, 1.1, 1.2, 1.8, 0.35, "passage",
       None, "squeeze",
       tags=["squeeze", "art wall"])
    st(S, "FEL3", -22, 72, -5.6, 0.8, 0.8, 1.4, 0.3, "passage",
       "Felines end", "squeeze",
       tags=["squeeze", "art wall"])
    chain(L, "ENT", "VEST", "HB1", "HB2", "HB3", "AG1", "AG2", "AG3", "AG4")
    chain(L, "HB3", "PAS1", "PAS2", "NAV1", "NAV2", "FEL1", "FEL2", "FEL3")
    link(L, "PAS2", "APS")
    link(L, "APS", "SFT")
    link(L, "SFT", "SFTB")
    features = [
        dict(type="pit", near="SFT", dx=2, dy=1, h=6.0, r=1.2, label="The Shaft"),
    ]
    return {
        "format": "cavern-centerline-v1",
        "name": "Lascaux",
        "seed": "lascaux",
        "style": "painted",
        "scale": 1.0,
        "units": "meters",
        "source": {
            "type": "approximate",
            "note": (
                "Approximate playable layout at 1:1 metres, built from widely "
                "published room sequence and dimensions (Hall of the Bulls, "
                "Axial Gallery, Passageway, Nave, Chamber of the Felines, "
                "Apse, Shaft). Not a survey and not a tracing of any published "
                "plan. A Wikimedia plan (File:Lascaux plan-ru.JPG) exists under "
                "CC BY-SA 3.0 / GFDL, but it is a redraw of A. Leroi-Gourhan "
                "1984 (L'art des cavernes, Ministère de la culture) and is "
                "treated here as inspiration only."
            ),
            "license": "Layout is an original approximation from published measurements. Do not treat it as survey data. Do not trace the 1984 atlas or its derivatives.",
            "usable": "approximate",
            "refs": [
                "https://archeologie.culture.gouv.fr/lascaux/en/lascaux-cave",
                "https://archeologie.culture.gouv.fr/lascaux/en/plan-site",
                "https://commons.wikimedia.org/wiki/File:Lascaux_plan-ru.JPG",
                "https://fr.wikipedia.org/wiki/Grotte_de_Lascaux",
            ],
        },
        "entranceId": "ENT",
        "exitId": "FEL3",
        "stations": S,
        "legs": L,
        "features": features,
        "pools": [],
    }


# ---------------------------------------------------------------------------
# 2. Carlsbad — reuse the existing traced NPS model, add tags
# ---------------------------------------------------------------------------

def build_carlsbad():
    cave = json.loads(EXISTING_CARLSBAD.read_text())
    # Do not mutate the original file; work on a copy.
    pit_ids = {"BPT"}
    stream_ids = {"DSP", "GLR", "GLO", "MIR", "LHT4"}
    art_ids = {"PGR"}  # Painted Grotto — colourful formations, not Palaeolithic art
    form_ids = {
        "HOG", "TSN", "CSD", "ROA", "PGR", "MIR", "BPT", "TOC", "SC1",
        "KPG", "QCH", "GLR", "WHM", "ICE", "PAP",
    }
    for s in cave["stations"]:
        tags = []
        if s.get("kind") == "entrance" or s["id"] == cave.get("entranceId"):
            tags.append("entrance")
        if s.get("kind") == "exit":
            tags.append("entrance")  # second way out
            # keep as exit via kind; also a useful entrance tag for recall
            tags = [t for t in tags if t != "entrance"]
        if s.get("zone") == "squeeze" or (s["left"] + s["right"] < 5 and s["up"] < 3.5):
            tags.append("squeeze")
        if s.get("kind") in ("cavern",) or s.get("zone") == "hall" or (s["left"] + s["right"] >= 20):
            if "squeeze" not in tags:
                tags.append("hall")
        if s["id"] in pit_ids or (s.get("label") or "").lower().find("pit") >= 0:
            tags.append("pit")
        if s["id"] in stream_ids:
            tags.append("stream")
        if s["id"] in form_ids:
            tags.append("formation zone")
        if s["id"] in art_ids:
            tags.append("art wall")
        # unique, stable order
        order = ["entrance", "hall", "squeeze", "pit", "stream", "formation zone", "art wall"]
        s["tags"] = [t for t in order if t in tags]
    cave["seed"] = "carlsbad"
    cave["scale"] = 1.0
    cave["units"] = "meters"
    cave["style"] = cave.get("style") or "carlsbad"
    src = cave.get("source") or {}
    src["license"] = (
        "US government work (National Park Service maps and tour descriptions) "
        "are public domain in the United States. This JSON is an approximate "
        "playable model, not survey data."
    )
    src["usable"] = "approximate-traced-from-pd"
    refs = list(src.get("refs") or [])
    extra = [
        "https://commons.wikimedia.org/wiki/File:Carlsbad_Cave_map-NPS.jpg",
        "https://www.nps.gov/cave/planyourvisit/selfguided_tours.htm",
    ]
    for r in extra:
        if r not in refs:
            refs.append(r)
    src["refs"] = refs
    if "note" in src:
        src["note"] = src["note"] + (
            " Station coordinates and LRUD come from the game's existing "
            "data/carlsbad.json model (tools/make_carlsbad.py). Tags were "
            "added for the modular-piece rebuild. Copied into data/real-caves/ "
            "without changing the original file."
        )
    cave["source"] = src
    return cave


# ---------------------------------------------------------------------------
# 3. Mammoth Cave — Historic Tour subset, scaled, from PD sources
# ---------------------------------------------------------------------------

def build_mammoth():
    """Historic Entrance to Mammoth Dome, plus a few named branches.

    Horizontal coordinates scaled by 0.35 so the 2-mile Historic Tour plays
    at a similar footprint to Carlsbad. Vertical scaled by 0.5. Tight
    squeezes keep near-real widths. Topology follows the Historic Tour
    sequence and the overall west-to-east trunk of the 1908 Kämper map
    (public domain), using published room sizes. Not a station-by-station
    digitisation of the 1908 sheet, and not a tracing of the modern
    copyrighted Richard Schlecht tour map.
    """
    S, L = [], []
    XY, Z = 0.35, 0.5

    def X(m): return m * XY
    def Zs(m): return m * Z

    # Real metres along an idealised centerline, then scaled.
    st(S, "ENT", X(0), X(40), 0, 16, 16, 14, 2.0, "entrance",
       "Historic Entrance", "entrance", tags=["entrance"])
    st(S, "NAR", X(40), X(20), Zs(-12), 3.5, 3.2, 5.0, 1.0, "passage",
       "The Narrows", "squeeze", tags=["squeeze"])
    # Rotunda: real 42 m wide, 12 m high — keep most of that presence
    st(S, "ROT", X(90), X(0), Zs(-28), 16, 16, 10, 1.8, "cavern",
       "The Rotunda", "hall", tags=["hall"])
    # Audubon Avenue branch, north from the Rotunda
    st(S, "AUD1", X(80), X(80), Zs(-30), 8, 8, 8, 1.4, "chamber",
       "Audubon Avenue", "corridor", tags=["hall"])
    st(S, "AUD2", X(60), X(150), Zs(-32), 6, 6, 7, 1.2, "chamber",
       "Audubon Avenue (north)", "corridor")
    # Broadway / Main Cave heading east-southeast
    st(S, "BR1", X(160), X(-20), Zs(-32), 12, 11, 10, 1.6, "cavern",
       "Broadway", "corridor", tags=["hall"])
    st(S, "MTH", X(260), X(-40), Zs(-36), 10, 10, 11, 1.6, "chamber",
       "Methodist Church", "hall", tags=["hall"])
    # Gothic Avenue, an upper-level signature passage
    st(S, "GTH1", X(250), X(20), Zs(-18), 4.0, 4.0, 4.5, 1.0, "passage",
       "Gothic Avenue", "corridor")
    st(S, "GTH2", X(210), X(50), Zs(-16), 3.5, 3.5, 4.0, 1.0, "chamber",
       "Gothic Avenue names", "corridor", tags=["art wall"])
    st(S, "COF", X(360), X(-55), Zs(-40), 10, 11, 9, 1.6, "chamber",
       "Giant's Coffin", "hall", tags=["hall"])
    st(S, "BR2", X(430), X(-70), Zs(-44), 9, 9, 9, 1.4, "chamber",
       "Main Cave", "corridor", tags=["hall"])
    st(S, "PIT", X(490), X(-50), Zs(-48), 6, 7, 10, 1.4, "chamber",
       "Bottomless Pit", "pit", tags=["pit"])
    # Fat Man's Misery: real ~30 m of tight winding passage. Keep it tight
    # and long enough to play as a squeeze, even at reduced scale.
    st(S, "MIS1", X(530), X(-80), Zs(-58), 1.1, 1.0, 1.6, 0.4, "passage",
       "Fat Man's Misery", "squeeze", tags=["squeeze"])
    st(S, "MIS2", X(555), X(-100), Zs(-64), 0.8, 0.9, 1.4, 0.35, "passage",
       None, "squeeze", tags=["squeeze"])
    st(S, "MIS3", X(575), X(-85), Zs(-68), 1.2, 1.1, 1.8, 0.4, "passage",
       None, "squeeze", tags=["squeeze"])
    st(S, "RVH", X(640), X(-90), Zs(-80), 8, 8, 7, 1.4, "chamber",
       "River Hall", "hall", tags=["hall", "stream"])
    # River Styx / Dead Sea branch (River Styx Tour continues here)
    st(S, "STYX", X(660), X(-140), Zs(-92), 5, 5, 4, 1.0, "passage",
       "River Styx", "stream", tags=["stream"])
    st(S, "DEAD", X(700), X(-170), Zs(-94), 6, 7, 4, 1.0, "chamber",
       "Dead Sea", "stream", tags=["stream"])
    st(S, "SPK", X(720), X(-70), Zs(-78), 4.5, 4.5, 5, 1.2, "passage",
       "Sparks Avenue", "corridor")
    # Mammoth Dome: real 58 m high. Keep a dramatic shaft.
    st(S, "DOM", X(800), X(-40), Zs(-76), 8, 8, 28, 2.0, "cavern",
       "Mammoth Dome", "hall", tags=["hall", "pit"])
    st(S, "EXT", X(820), X(-20), Zs(-20), 4, 4, 5, 1.2, "exit",
       "Carmichael Entrance (exit)", "entrance", tags=["entrance"])

    chain(L, "ENT", "NAR", "ROT", "BR1", "MTH", "COF", "BR2", "PIT",
          "MIS1", "MIS2", "MIS3", "RVH", "SPK", "DOM", "EXT")
    chain(L, "ROT", "AUD1", "AUD2")
    chain(L, "MTH", "GTH1", "GTH2")
    chain(L, "RVH", "STYX", "DEAD")

    features = [
        dict(type="boulder", near="COF", dx=4, dy=-2, h=8, r=5, label="Giant's Coffin"),
        dict(type="pit", near="PIT", dx=6, dy=4, h=22, r=5, label="Bottomless Pit"),
        dict(type="pit", near="DOM", dx=0, dy=0, h=28, r=7, label="Mammoth Dome shaft"),
    ]
    pools = [
        dict(near="STYX", dx=0, dy=-4, r=4.0),
        dict(near="DEAD", dx=2, dy=0, r=6.0),
    ]
    return {
        "format": "cavern-centerline-v1",
        "name": "Mammoth Cave (Historic Tour)",
        "seed": "mammoth",
        "style": "mammoth",
        "scale": 0.35,
        "verticalScale": 0.5,
        "units": "meters",
        "source": {
            "type": "approximate",
            "note": (
                "Simplified Historic Tour plus Audubon Avenue, Gothic Avenue "
                "and a River Styx spur. Horizontal coordinates are 0.35× real, "
                "vertical 0.5×, so the 2-mile tour plays near Carlsbad size. "
                "Room sizes (Rotunda ~42 m wide, Giant's Coffin, Fat Man's "
                "Misery ~30 m of tight passage, Mammoth Dome 192 ft / 58 m) "
                "come from NPS and earlier public-domain descriptions. The "
                "overall west-to-east trunk follows the 1908 Max Kämper map "
                "(public domain). Not a digitised survey. The modern NPS "
                "illustrated tour map by Richard Schlecht is copyrighted and "
                "was not traced."
            ),
            "license": "Layout is an original approximation. Source facts and the 1908 Kämper map are public domain. Do not trace the modern Schlecht map.",
            "usable": "approximate",
            "refs": [
                "https://commons.wikimedia.org/wiki/File:Max_K%C3%A4mper_1908_Map_of_Mammoth_Cave.jpg",
                "https://openparksnetwork.org/",
                "https://www.nps.gov/maca/planyourvisit/mammoth-cave-map-guide.htm",
                "https://www.nps.gov/places/fat-man-s-misery-beneath-your-feet.htm",
                "https://www.npshistory.com/publications/maca/hovey/sec2.htm",
                "https://npshistory.com/publications/geology/state/ky/kgs-sp-7/sec3.htm",
            ],
        },
        "entranceId": "ENT",
        "exitId": "EXT",
        "stations": S,
        "legs": L,
        "features": features,
        "pools": pools,
    }


# ---------------------------------------------------------------------------
# 4. Wind Cave — developed tour routes from the NPS public-domain tour map
# ---------------------------------------------------------------------------

def build_wind_cave():
    """Tour-route centerline from the NPS public-domain tour map.

    Elevations are converted from labelled tour-map values (feet) relative
    to the natural Cave Entrance at 4082 ft. Plan positions are a careful
    approximation of the published NPS tour-route map (US government work,
    public domain), scaled so the Natural Entrance tour is about 450 m
    long. The 150-mile maze is only hinted at with a few short boxwork
    spurs; those spurs are invented, not surveyed.
    """
    S, L = [], []

    def z_of(elev_ft):
        return round((elev_ft - 4082) * 0.3048, 2)

    # Plan coordinates in metres, entrance at origin. Estimated from the
    # NPS tour map relative positions.
    st(S, "ENT", 0, 0, 0, 6, 6, 5, 1.2, "entrance",
       "Natural Entrance (Cave Entrance)", "entrance",
       tags=["entrance"])
    st(S, "GUIDE", 5, -30, -4, 2.4, 2.4, 2.6, 0.8, "passage",
       "Guide's Discovery", "corridor")
    st(S, "NORTH", -35, 22, z_of(3983), 5, 5, 4.5, 1.0, "chamber",
       "North Room", "hall", tags=["hall", "formation zone"])
    st(S, "FAIRY", -110, 40, z_of(3970), 3.5, 3.5, 3.2, 0.8, "chamber",
       "Fairy Palace", "corridor", tags=["formation zone"])
    # Upper Specimen Route, east along the Natural Entrance Tour
    st(S, "USR1", 40, 8, z_of(4000), 3.0, 3.0, 3.2, 0.8, "passage",
       "Upper Specimen Route", "corridor", tags=["formation zone"])
    st(S, "ROE", 95, 6, z_of(3975), 1.6, 1.6, 1.8, 0.5, "passage",
       "Roe's Misery", "squeeze", tags=["squeeze"])
    st(S, "POST", 150, 28, z_of(3960), 3.2, 3.2, 3.0, 0.8, "chamber",
       "Post Office", "corridor", tags=["formation zone"])
    st(S, "USR2", 210, 12, z_of(3945), 2.8, 2.8, 3.0, 0.8, "passage",
       None, "corridor")
    st(S, "DEVIL", 270, 8, z_of(3931), 3.0, 3.2, 3.4, 0.8, "chamber",
       "Devil's Lookout", "corridor")
    st(S, "METH", 330, 22, z_of(3910), 4.5, 4.5, 4.0, 1.0, "chamber",
       "Methodist Church", "hall", tags=["hall"])
    st(S, "MODEL", 385, 28, z_of(3890), 3.0, 3.0, 3.2, 0.8, "passage",
       "Model Room", "corridor")
    st(S, "XROAD", 430, 32, z_of(3885), 3.5, 3.5, 3.4, 0.8, "passage",
       "Crossroads", "corridor")
    st(S, "ASM", 470, 14, z_of(3863), 5.5, 5.5, 5.0, 1.0, "chamber",
       "Assembly Room", "hall", tags=["hall", "formation zone"])
    st(S, "ELV", 500, 28, z_of(3863), 4.0, 4.0, 4.0, 1.0, "exit",
       "Elevator", "entrance", tags=["entrance"])

    # Garden of Eden tour (upper level, east loop)
    st(S, "GOE", 545, 55, z_of(4055), 4.0, 4.5, 3.5, 0.8, "chamber",
       "Garden of Eden", "hall",
       tags=["hall", "formation zone"])
    st(S, "ROME", 560, 10, z_of(4040), 3.0, 3.0, 3.0, 0.8, "passage",
       "Rome", "corridor", tags=["formation zone"])
    st(S, "MUD", 575, -25, z_of(4030), 3.2, 3.2, 2.8, 0.8, "chamber",
       "Muddle Room", "corridor")
    st(S, "GOE2", 530, 5, z_of(4000), 2.6, 2.6, 2.8, 0.7, "passage",
       "Garden of Eden Tour", "corridor")

    # Fairgrounds tour (north, mixed levels)
    st(S, "ELK", 445, 70, z_of(3911), 4.0, 4.0, 3.8, 0.8, "chamber",
       "Elks Room", "corridor", tags=["formation zone"])
    st(S, "MONTE", 455, 95, z_of(3880), 3.5, 3.5, 3.5, 0.8, "chamber",
       "Monte Cristo's Palace", "hall", tags=["hall", "formation zone"])
    st(S, "THREE", 420, 100, z_of(3865), 2.4, 2.4, 4.5, 0.8, "passage",
       "Three-way Stair", "corridor")
    st(S, "BLUE", 360, 105, z_of(3835), 3.5, 3.5, 4.0, 0.8, "chamber",
       "Blue Grotto", "hall", tags=["hall", "formation zone"])
    st(S, "FAIR", 305, 115, z_of(3967), 6, 6, 5.5, 1.0, "cavern",
       "Fairgrounds", "hall", tags=["hall", "formation zone"])
    st(S, "CHERT", 340, 80, z_of(3920), 2.8, 2.8, 3.0, 0.8, "passage",
       "Chert Room", "corridor")
    st(S, "TEMP", 370, 58, z_of(3900), 3.0, 3.0, 3.2, 0.8, "passage",
       "Temple Room", "corridor", tags=["formation zone"])
    st(S, "BACH", 470, 135, z_of(3920), 3.2, 3.2, 3.0, 0.8, "chamber",
       "Bachelor's Quarters", "corridor")

    # Candlelight tour (Pearly Gates / Attic)
    st(S, "ATTIC", 280, 155, z_of(3990), 3.0, 3.0, 2.6, 0.7, "passage",
       "The Attic", "corridor")
    st(S, "PEARL", 215, 140, z_of(3975), 2.2, 2.2, 2.4, 0.6, "passage",
       "Pearly Gates", "corridor", tags=["formation zone"])
    st(S, "STAND", 200, 95, z_of(3960), 3.5, 3.5, 4.0, 0.8, "chamber",
       "Standing Rock Chamber", "hall", tags=["hall"])
    st(S, "AMPH", 185, 70, z_of(3950), 4.0, 4.0, 4.5, 0.9, "chamber",
       "The Amphitheater", "hall", tags=["hall"])

    # A few invented boxwork maze spurs, to hint at the 150-mile maze
    # without attempting to reproduce it.
    st(S, "BOX1", 150, 60, z_of(3955), 1.2, 1.2, 1.6, 0.4, "passage",
       "Boxwork spur", "squeeze", tags=["squeeze", "formation zone"])
    st(S, "BOX2", 165, 85, z_of(3940), 1.0, 1.0, 1.4, 0.35, "passage",
       None, "squeeze", tags=["squeeze", "formation zone"])
    st(S, "BOX3", 130, 90, z_of(3930), 0.9, 0.9, 1.2, 0.3, "passage",
       None, "squeeze", tags=["squeeze"])
    st(S, "SNOW", 90, 70, z_of(3965), 2.0, 2.0, 2.2, 0.6, "passage",
       "Toward Snowdrift Avenue", "corridor")

    # Natural Entrance Tour
    chain(L, "ENT", "USR1", "ROE", "POST", "USR2", "DEVIL", "METH",
          "MODEL", "XROAD", "ASM", "ELV")
    link(L, "ENT", "GUIDE")
    link(L, "ENT", "NORTH")
    link(L, "NORTH", "FAIRY")
    # Garden of Eden loop
    chain(L, "ELV", "GOE", "ROME", "MUD", "GOE2", "ASM")
    # Fairgrounds
    chain(L, "XROAD", "ELK", "MONTE", "THREE", "BLUE", "FAIR")
    link(L, "FAIR", "CHERT")
    link(L, "CHERT", "TEMP")
    link(L, "TEMP", "ELK")
    link(L, "MONTE", "BACH")
    # Candlelight
    chain(L, "FAIR", "ATTIC", "PEARL", "STAND", "AMPH")
    link(L, "AMPH", "POST")
    # invented maze spurs
    chain(L, "POST", "BOX1", "BOX2", "BOX3")
    link(L, "BOX1", "SNOW")
    link(L, "SNOW", "NORTH")

    features = [
        dict(type="boxwork", near="ASM", dx=0, dy=0, h=3, r=4, label="Boxwork"),
        dict(type="frostwork", near="GOE", dx=2, dy=1, h=1.5, r=2, label="Frostwork"),
    ]
    return {
        "format": "cavern-centerline-v1",
        "name": "Wind Cave (tour routes)",
        "seed": "wind-cave",
        "style": "windcave",
        "scale": 1.0,
        "units": "meters",
        "source": {
            "type": "approximate",
            "note": (
                "Careful approximation of the developed tour routes (Natural "
                "Entrance, Garden of Eden, Fairgrounds, Candlelight) from the "
                "NPS public-domain tour-route map. Elevations are taken from "
                "labels on that map and converted to metres relative to the "
                "natural entrance (4082 ft). A few short boxwork spurs were "
                "invented to hint at the maze; they are not surveyed passages. "
                "The full 150-mile system shown on the NPS whole-cave lineplot "
                "is far too dense to load as a playable centerline."
            ),
            "license": "US government work (NPS tour maps) are public domain in the United States. This JSON is an approximate playable model, not a survey.",
            "usable": "approximate-from-pd-plan",
            "refs": [
                "https://commons.wikimedia.org/wiki/File:NPS_wind-cave-tour-map.jpg",
                "https://commons.wikimedia.org/wiki/File:NPS_wind-cave-whole-map.jpg",
                "https://npmaps.com/wp-content/uploads/wind-cave-tour-map.pdf",
                "https://www.nps.gov/wica/planyourvisit/guidedtours.htm",
            ],
        },
        "entranceId": "ENT",
        "exitId": "ELV",
        "stations": S,
        "legs": L,
        "features": features,
        "pools": [],
    }


# ---------------------------------------------------------------------------
# 5. Lehman Caves — NPS dimensions + published tour-route plan
# ---------------------------------------------------------------------------

def build_lehman():
    """Compact cluster of rooms at 1:1 metres.

    Depths and the two published room sizes (Talus Room 90 x 376 ft, 113 ft
    tall; Music Room 51 ft tall) come from the NPS dimensions page. Room
    arrangement follows the NPS visitor-center tour-route plan (US
    government work; a photo of the sign is on Commons). Approximate, not
    a survey and not a tracing of the photograph.
    """
    S, L = [], []
    # Depths beneath the surface, metres. Entrance z = 0 is the modern
    # blasted entrance tunnel, close to the Gothic Palace level.
    def depth_ft(ft):
        return -round(ft * 0.3048, 1)

    # Plan: entrance on the east, rooms spreading west and north.
    # Positions estimated from the NPS tour-route plan (scale 0–90 m).
    st(S, "ENT", 95, 0, 0, 3.0, 3.0, 3.2, 0.8, "entrance",
       "Entrance tunnel", "entrance", tags=["entrance"])
    st(S, "GOT", 45, 8, depth_ft(93.5), 7, 7, 8, 1.2, "chamber",
       "Gothic Palace", "hall", tags=["hall", "formation zone"])
    st(S, "NAT", 62, 28, depth_ft(60), 4, 4, 4, 1.0, "chamber",
       "Natural Entrance (covered)", "entrance", tags=["entrance"])
    st(S, "LOST", 85, 72, depth_ft(110), 2.4, 2.4, 2.6, 0.7, "passage",
       "Lost River Passage", "stream", tags=["stream"])
    st(S, "MUS", 22, -2, depth_ft(125), 5, 5, 15.5, 1.2, "chamber",
       "Music Room", "hall", tags=["hall", "formation zone"])
    st(S, "LOD", 8, -22, depth_ft(151), 6, 6, 6, 1.2, "chamber",
       "Lodge Room", "hall", tags=["hall", "stream", "formation zone"])
    st(S, "EXT1", 40, -28, depth_ft(80), 2.6, 2.6, 3.0, 0.8, "passage",
       "Exit tunnel", "corridor")
    st(S, "EXT", 95, -28, -2, 3.0, 3.0, 3.2, 0.8, "exit",
       "Exit", "entrance", tags=["entrance"])
    st(S, "INS", -42, -12, depth_ft(194), 4.5, 4.5, 4.0, 1.0, "chamber",
       "Inscription Room", "hall", tags=["hall", "art wall"])
    st(S, "WEST", -85, 8, depth_ft(170), 4.0, 4.0, 4.0, 1.0, "chamber",
       "West Room", "corridor", tags=["formation zone"])
    st(S, "CYP", 2, 28, depth_ft(167), 5, 5, 5, 1.0, "chamber",
       "Cypress Swamp", "hall", tags=["hall", "stream", "formation zone"])
    st(S, "GRD", -4, 58, depth_ft(167), 8, 8, 8, 1.2, "chamber",
       "Grand Palace", "hall", tags=["hall", "formation zone"])
    # Talus Room: real 27 m wide, 115 m long, 34 m tall — keep presence
    st(S, "TAL1", 2, 95, depth_ft(150), 12, 12, 20, 1.6, "cavern",
       "Talus Room", "hall", tags=["hall"])
    st(S, "TAL2", 0, 150, depth_ft(145), 13, 13, 28, 1.8, "cavern",
       "Talus Room (north)", "hall", tags=["hall"])
    st(S, "GYP1", -40, 175, depth_ft(140), 3.5, 3.5, 4.0, 0.8, "passage",
       "Gypsum Annex", "corridor", tags=["formation zone"])
    st(S, "GYP2", -70, 200, depth_ft(135), 3.0, 3.0, 3.5, 0.8, "chamber",
       "Gypsum Annex (west)", "corridor", tags=["formation zone"])
    st(S, "GYP3", -20, 220, depth_ft(132), 2.8, 2.8, 3.2, 0.8, "chamber",
       None, "corridor", tags=["formation zone"])

    chain(L, "ENT", "GOT", "MUS", "LOD", "INS", "WEST")
    link(L, "GOT", "NAT")
    link(L, "NAT", "LOST")
    chain(L, "LOD", "EXT1", "EXT")
    chain(L, "LOD", "CYP", "GRD", "TAL1", "TAL2", "GYP1", "GYP2")
    link(L, "GYP1", "GYP3")
    link(L, "INS", "CYP")

    features = [
        dict(type="shield", near="GRD", dx=3, dy=2, h=4, r=2.5, label="Parachute Shield"),
        dict(type="drapes", near="MUS", dx=0, dy=0, h=8, r=2.0, label="Music Room draperies"),
    ]
    pools = [
        dict(near="LOD", dx=2, dy=-2, r=3.0),
        dict(near="CYP", dx=1, dy=1, r=2.5),
        dict(near="LOST", dx=0, dy=4, r=1.5),
    ]
    return {
        "format": "cavern-centerline-v1",
        "name": "Lehman Caves",
        "seed": "lehman",
        "style": "lehman",
        "scale": 1.0,
        "units": "meters",
        "source": {
            "type": "approximate",
            "note": (
                "Approximate 1:1 layout of the tour rooms plus the off-tour "
                "Talus Room and Gypsum Annex. Depths and the Talus Room / "
                "Music Room sizes are from the NPS dimensions page (data "
                "credited to the Southern Nevada Grotto, NSS). Room "
                "arrangement follows the NPS visitor-center tour-route plan. "
                "A photograph of that sign is on Wikimedia Commons (CC BY-SA "
                "4.0, Famartin); the sign itself is a US government work. "
                "This JSON approximates the published plan structure and is "
                "not a tracing of the photograph, nor survey data."
            ),
            "license": "Facts and the underlying NPS plan are US government works (public domain in the US). The Commons photograph of the sign is CC BY-SA 4.0 (Famartin) and was not traced.",
            "usable": "approximate-from-pd-plan",
            "refs": [
                "https://www.nps.gov/grba/learn/nature/lehman-caves-dimensions.htm",
                "https://www.nps.gov/grba/planyourvisit/lehman-caves-tours.htm",
                "https://npshistory.com/publications/grba/brochures/caves.pdf",
                "https://commons.wikimedia.org/wiki/File:2015-01-14_13_02_47_Map_of_the_Lehman_Caves_Tour_Route_at_the_Lehman_Caves_Visitor_Center_in_Great_Basin_National_Park,_Nevada.JPG",
            ],
        },
        "entranceId": "ENT",
        "exitId": "EXT",
        "stations": S,
        "legs": L,
        "features": features,
        "pools": pools,
    }


# ---------------------------------------------------------------------------
# 6. Timpanogos — three caves in a cliff, from NPS descriptions
# ---------------------------------------------------------------------------

def build_timpanogos():
    """Hansen, Middle and Timpanogos caves in a west-running line.

    The NPS public-domain trail map shows the three caves in section along
    the cliff, entered at Hansen Cave (elevation 6,730 ft) and exited at
    the west end of Timpanogos Cave, connected by 1930s man-made tunnels.
    Room order and names come from NPS tour and history pages. The 2003
    Kowallis / Horrocks atlas is copyrighted and was not traced. 1:1 metres;
    total length is a playable ~200 m, consistent with a ~1/3-mile tour
    through small rooms and two short tunnels (Timpanogos Cave itself is
    published at about 800 ft / 244 m, of which the tour uses a subset).
    """
    S, L = [], []
    # x decreases westward, matching the NPS section (Hansen east, exit west).
    st(S, "ENT", 220, 0, 0, 3.5, 3.5, 3.5, 0.8, "entrance",
       "Hansen Cave entrance", "entrance", tags=["entrance"])
    st(S, "HAN1", 205, 8, -2, 3.0, 3.0, 3.2, 0.8, "chamber",
       "Hansen Cave", "corridor", tags=["formation zone"])
    st(S, "HLAKE", 188, 18, -3.5, 4.0, 4.0, 3.0, 0.8, "chamber",
       "Hansen Cave Lake", "hall", tags=["hall", "stream"])
    st(S, "HAN2", 172, 4, -5, 2.8, 2.8, 3.0, 0.7, "passage",
       None, "corridor", tags=["formation zone"])
    st(S, "TUN1", 152, 0, -6, 1.8, 1.8, 2.4, 0.6, "passage",
       "Tunnel to Middle Cave", "corridor")
    st(S, "MID1", 132, 14, -7, 3.2, 3.2, 3.0, 0.8, "chamber",
       "Middle Cave", "corridor", tags=["formation zone"])
    st(S, "MID2", 114, -12, -8, 2.6, 2.6, 2.8, 0.7, "passage",
       "Middle Cave passage", "corridor")
    st(S, "TUN2", 94, 0, -9, 1.8, 1.8, 2.4, 0.6, "passage",
       "Tunnel to Timpanogos Cave", "corridor")
    st(S, "JEWEL", 74, 16, -10, 2.4, 2.4, 2.6, 0.6, "chamber",
       "Father Time's Jewel Box", "corridor", tags=["formation zone"])
    st(S, "HIDE", 56, -4, -11, 3.5, 3.5, 3.0, 0.8, "chamber",
       "Hidden Lake", "hall", tags=["hall", "stream", "formation zone"])
    st(S, "HEART", 38, 18, -12, 3.0, 3.0, 4.0, 0.8, "chamber",
       "Great Heart of Timpanogos", "hall", tags=["hall", "formation zone"])
    st(S, "CHIME", 20, 2, -13, 3.2, 3.2, 3.4, 0.8, "chamber",
       "Chimes Chamber", "hall", tags=["hall", "formation zone"])
    st(S, "LOW", 10, -14, -12, 1.6, 1.6, 2.0, 0.5, "passage",
       "Lower Passage", "squeeze", tags=["squeeze"])
    st(S, "EXT", 0, 0, -8, 3.0, 3.0, 3.0, 0.8, "exit",
       "Timpanogos Cave exit", "entrance", tags=["entrance"])

    chain(L, "ENT", "HAN1", "HLAKE", "HAN2", "TUN1", "MID1", "MID2",
          "TUN2", "JEWEL", "HIDE", "HEART", "CHIME", "LOW", "EXT")

    features = [
        dict(type="heart", near="HEART", dx=0, dy=1, h=3.5, r=1.6,
             label="Great Heart of Timpanogos"),
        dict(type="helictites", near="CHIME", dx=0, dy=0, h=2.0, r=2.0,
             label="Helictites"),
        dict(type="stalactite", near="JEWEL", dx=0, dy=0, h=2.2, r=0.6,
             label="Father Time's Jewel Box"),
    ]
    pools = [
        dict(near="HLAKE", dx=0, dy=2, r=2.5),
        dict(near="HIDE", dx=1, dy=0, r=2.0),
    ]
    return {
        "format": "cavern-centerline-v1",
        "name": "Timpanogos Cave System",
        "seed": "timpanogos",
        "style": "timpanogos",
        "scale": 1.0,
        "units": "meters",
        "source": {
            "type": "approximate",
            "note": (
                "Approximate 1:1 layout of the regular tour through Hansen, "
                "Middle and Timpanogos caves. The three-cave order, the two "
                "man-made tunnels, and named rooms (Hansen Cave Lake, Father "
                "Time's Jewel Box, Hidden Lake, Great Heart, Chimes Chamber) "
                "come from NPS tour and history pages. The public-domain NPS "
                "trail map provides the east-to-west cliff section (entrance "
                "at Hansen Cave, exit at Timpanogos Cave, elevation 6,730 ft). "
                "The 2003 Timpanogos Cave Atlas (survey by Rodney D. Horrocks, "
                "map by Brandon K. Kowallis) is copyrighted and was not traced."
            ),
            "license": "Layout is an original approximation from NPS public-domain descriptions and the NPS trail-map section. Do not trace the Kowallis atlas.",
            "usable": "approximate",
            "refs": [
                "https://www.nps.gov/tica/planyourvisit/cavetours.htm",
                "https://www.nps.gov/tica/learn/historyculture/heart-of-the-mountain.htm",
                "https://commons.wikimedia.org/wiki/File:NPS_timpanogos-cave-trail-map.jpg",
                "https://npshistory.com/publications/tica/nss-v36n1-5.pdf",
                "http://www.jonjasper.com/MapGallery/TimpCaveAtlasWeb.pdf",
            ],
        },
        "entranceId": "ENT",
        "exitId": "EXT",
        "stations": S,
        "legs": L,
        "features": features,
        "pools": pools,
    }


# ---------------------------------------------------------------------------
# previews
# ---------------------------------------------------------------------------

TAG_COLORS = {
    "entrance": "#d4a017",
    "hall": "#c4a574",
    "squeeze": "#5a3a22",
    "pit": "#8b1e1e",
    "stream": "#2a6f9b",
    "formation zone": "#3d8b74",
    "art wall": "#c45c26",
}
DEFAULT_COLOR = "#6b6258"


def primary_tag(s):
    tags = s.get("tags") or []
    for t in ("art wall", "pit", "squeeze", "stream", "entrance", "hall", "formation zone"):
        if t in tags:
            return t
    return None


def station_color(s):
    t = primary_tag(s)
    return TAG_COLORS.get(t, DEFAULT_COLOR)


def render_preview(cave, out_path):
    smap = {s["id"]: s for s in cave["stations"]}
    fig, ax = plt.subplots(figsize=(11, 8.5), dpi=160)
    fig.patch.set_facecolor("#f4efe4")
    ax.set_facecolor("#f4efe4")

    # passages as variable-width segments
    for leg in cave["legs"]:
        a, b = smap.get(leg["from"]), smap.get(leg["to"])
        if not a or not b:
            continue
        width = max(0.6, 0.45 * ((a["left"] + a["right"] + b["left"] + b["right"]) / 2))
        color = station_color(a)
        ax.plot([a["x"], b["x"]], [a["y"], b["y"]],
                color=color, linewidth=max(1.6, width * 0.55),
                solid_capstyle="round", alpha=0.9, zorder=2)

    xs = [s["x"] for s in cave["stations"]]
    ys = [s["y"] for s in cave["stations"]]
    zs = [s["z"] for s in cave["stations"]]
    sizes = [28 + 6 * (s["left"] + s["right"]) for s in cave["stations"]]
    colors = [station_color(s) for s in cave["stations"]]
    ax.scatter(xs, ys, s=sizes, c=colors, zorder=3, edgecolors="#2b241c", linewidths=0.5)

    # labels for named stations
    effects = [pe.withStroke(linewidth=3, foreground="#f4efe4")]
    labeled = [s for s in cave["stations"] if s.get("label")]
    for i, s in enumerate(labeled):
        # Stagger labels above/below so neighbours are less likely to collide.
        dy = 7 if i % 2 == 0 else -9
        dx = 5 if i % 3 != 2 else -5
        ax.annotate(
            s["label"],
            (s["x"], s["y"]),
            textcoords="offset points",
            xytext=(dx, dy),
            fontsize=6.5,
            color="#2b241c",
            path_effects=effects,
            zorder=4,
            ha="left" if dx > 0 else "right",
            va="bottom" if dy > 0 else "top",
        )

    ax.set_aspect("equal", adjustable="datalim")
    ax.margins(0.12)
    ax.set_xlabel("east →  (metres in the game model)")
    ax.set_ylabel("north →  (metres in the game model)")
    ax.grid(True, color="#d7cbb6", linewidth=0.6)
    for spine in ax.spines.values():
        spine.set_color("#c9bda8")

    scale = cave.get("scale", 1.0)
    vscale = cave.get("verticalScale", 1.0)
    depth = (max(zs) - min(zs)) if zs else 0
    title = cave["name"]
    ax.set_title(title, fontsize=14, color="#2b241c", pad=12, loc="left")

    # north arrow
    xmin, xmax = ax.get_xlim()
    ymin, ymax = ax.get_ylim()
    nx = xmax - 0.08 * (xmax - xmin)
    ny = ymax - 0.14 * (ymax - ymin)
    ax.annotate("N", xy=(nx, ny), xytext=(nx, ny - 0.10 * (ymax - ymin)),
                arrowprops=dict(arrowstyle="-|>", color="#2b241c", lw=1.4),
                ha="center", va="top", fontsize=9, color="#2b241c",
                annotation_clip=False)

    # scale bar ~ 1/5 of width, rounded
    span = max(xmax - xmin, 1)
    raw = span / 5
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    bar = max(mag, round(raw / mag) * mag)
    bx = xmin + 0.08 * (xmax - xmin)
    by = ymin + 0.07 * (ymax - ymin)
    ax.plot([bx, bx + bar], [by, by], color="#2b241c", lw=2.2, zorder=5)
    ax.plot([bx, bx], [by - 0.01 * (ymax - ymin), by + 0.01 * (ymax - ymin)],
            color="#2b241c", lw=2.2, zorder=5)
    ax.plot([bx + bar, bx + bar], [by - 0.01 * (ymax - ymin), by + 0.01 * (ymax - ymin)],
            color="#2b241c", lw=2.2, zorder=5)
    ax.text(bx + bar / 2, by + 0.02 * (ymax - ymin), f"{int(bar) if bar >= 1 else bar} m",
            ha="center", va="bottom", fontsize=8, color="#2b241c")

    # legend
    used = []
    for s in cave["stations"]:
        t = primary_tag(s)
        if t and t not in used:
            used.append(t)
    handles = [
        plt.Line2D([0], [0], marker="o", color="none",
                   markerfacecolor=TAG_COLORS[t], markeredgecolor="#2b241c",
                   markersize=7, label=t)
        for t in used
    ]
    if handles:
        leg = ax.legend(handles=handles, loc="lower right", frameon=True,
                        fontsize=7, title="tags", title_fontsize=8)
        leg.get_frame().set_facecolor("#f7f2ea")
        leg.get_frame().set_edgecolor("#c9bda8")

    src = cave.get("source") or {}
    note = (
        f"Game model, not a survey.  xy scale {scale}×"
        + (f", z scale {vscale}×" if vscale != 1 else "")
        + f".  Depth range {min(zs):.0f} to {max(zs):.0f} m.  "
        f"{len(cave['stations'])} stations, {len(cave['legs'])} legs.  "
        f"{src.get('license', '')}"
    )
    fig.text(0.02, 0.01, note, fontsize=6.2, color="#4a4338", ha="left", va="bottom", wrap=True)
    fig.tight_layout(rect=(0.02, 0.05, 0.98, 0.98))
    fig.savefig(out_path, dpi=160)
    plt.close(fig)
    print(f"wrote {out_path}")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    caves = [
        build_lascaux(),
        build_carlsbad(),
        build_mammoth(),
        build_wind_cave(),
        build_lehman(),
        build_timpanogos(),
    ]
    index = []
    for cave in caves:
        dump(cave)
        png = DOCS / f"{cave['seed']}.png"
        render_preview(cave, png)
        index.append({
            "seed": cave["seed"],
            "name": cave["name"],
            "json": f"data/real-caves/{cave['seed']}.json",
            "preview": f"docs/real-caves/{cave['seed']}.png",
            "stations": len(cave["stations"]),
            "legs": len(cave["legs"]),
            "scale": cave.get("scale", 1),
            "usable": (cave.get("source") or {}).get("usable"),
            "entranceId": cave.get("entranceId"),
            "exitId": cave.get("exitId"),
        })
    (DOCS / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print("wrote", DOCS / "index.json")


if __name__ == "__main__":
    main()
