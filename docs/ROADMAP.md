# Roadmap and backlog

Status of the foundation, then a prioritized backlog. Each item has an ID,
acceptance criteria and the files it touches, so an agent can pick one up
without other context. When you finish an item, move it to "Done" with a
one-line note.

## Current state (foundation)

| Area | State |
| --- | --- |
| Simulation | Complete single-player loop: 25 buildings, 28 goods, 14 professions, 9 soldier types, hunger, logistics, construction, combat, AI with 4 difficulties, win and lose |
| Architecture | Pure deterministic core; command layer with replay; event contract; renderer contract; save/load |
| Renderers | three.js 3D (default); canvas 2D (fallback / option) |
| Tests | 23 headless tests (sim, commands, contracts); a browser smoke run over both renderers |
| Tooling | Zero-dependency dev server, smoke harness with screenshots, CI workflow |

## Backlog

Priority: **P1** makes the game meaningfully better; **P2** is a solid
improvement; **P3** is nice to have.

### Gameplay

- **G1 (P1) Fog of war.** Each player sees only what's near its units and
  buildings, and remembers explored terrain.
  - *Accept:* a per-player `seen` / `visible` array in core, updated at 1 Hz from
    unit and building sight radii; both renderers darken unexplored tiles and hide
    enemy units outside vision; the minimap respects it; the AI keeps its current
    omniscience (documented).
  - *Files:* `core/world.js` (new visibility system), `render/*`,
    `render/minimap.js`, `save.js` (bump the version).
- **G2 (P1) Missions and scenarios.** Scripted maps with goals ("survive 20
  minutes", "destroy the keep"), starting stock and triggers.
  - *Accept:* scenario JSON (map seed or tile data, towns, stock, armies, goals)
    loaded by `new World({ scenario })`; a mission picker on the start screen; win
    conditions come from goals instead of `checkEnd` defaults.
  - *Files:* new `core/scenario.js`, `setup.js`, `world.js checkEnd`, `game.js`.
- **G3 (P1) AI builds its own economy** instead of relying on the supply trickle:
  mines, smelter and smithies on nearby seams; scaled by difficulty.
  - *Accept:* with the trickle disabled, a normal AI fields iron troops by minute
    25 (a new headless test).
  - *Files:* `core/ai.js`, `setup.js` (`autoPlace` for mines on seams).
- **G4 (P2) Distribution settings** as in the original: the share of coal and iron
  sent to each smithy versus the smelter, and food priorities.
  - *Accept:* a per-player distribution table in core that `runLogistics` honours;
    a UI panel; a test showing the split.
- **G5 (P2) Storehouse and barracks management:** multiple storehouses, a "stop
  accepting" flag per good (the storehouse part exists), and serfs evacuating goods
  from a blocked store.
- **G6 (P2) Soldier food:** serfs carry food to hungry troops in the field
  (the original's "feed" order) instead of troops walking to the inn.
  - *Files:* `combat.js cmdFeed`, `units.js` (a serf job).
- **G7 (P3) Morale and retreat,** formation facing bonuses and flanking.
- **G8 (P3) Trade / marketplace building.**

### Presentation

- **R1 (P1) 3D polish pass.**
  - Roofs: ridge beams, overhang, tile texture.
  - Construction sites: material piles, as the 2D view has.
  - Water: animated shader.
  - Units: walk cycles on arms.
  - Trees: sway.
  - Buildings: burning and damage states.
  - *Accept:* side-by-side smoke screenshots show each item; per-frame JavaScript
    stays under 3 ms.
  - *Files:* `render/three/*`.
- **R2 (P1) Graphics quality setting:** shadows on/off, pixel ratio, antialias.
  The default adapts to measured frame time.
  - *Accept:* a menu option persisted in localStorage; the smoke test covers low
    quality.
- **R3 (P2) Camera rotation and tilt** in 3D (Q/E, middle-drag). Picking already
  works in screen space; models need back sides detailed.
- **R4 (P2) glTF asset pipeline.** Load authored models for buildings and units
  when present, falling back to the procedural ones.
  - *Files:* `render/three/models.js` (keep the frame and `meta` contract); vendor
    `GLTFLoader`.
- **R5 (P2) Music and ambient sound** (birdsong near forests, forge clangs near
  smithies), positional by camera.
- **R6 (P3) Day/night or weather** (visual only; the sim stays unaware).

### UX

- **U1 (P1) Tutorial / first-session guidance:** step-by-step goals for the first
  10 minutes (build a woodcutter, connect roads, ...) driven by events.
- **U2 (P2) Hotkeys for buildings and groups** (Ctrl+1–9 group assignment),
  double-click to select all of a type, and a building "cycle" button.
- **U3 (P2) Mobile-first layout** with a collapsible panel and larger touch targets.
- **U4 (P2) Statistics screen:** graphs of production over time
  (`players[i].stats`, sampled per minute).
- **U5 (P3) Localization:** move UI strings out of `ui.js` into a string table.

### Engine

- **E1 (P1) Simulation in a Web Worker.** Post commands in and snapshots or
  diffs out; renderers interpolate. Core is already DOM-free and commands are
  serializable.
  - *Accept:* the UI stays at 60 fps with the simulation at 4× on a 128×128 map.
- **E2 (P2) Replays:** download and upload the command log and seed from the
  menu, then play back with speed controls. The core pieces exist
  (`CommandLog`, determinism tests).
- **E3 (P2) Lockstep multiplayer** over WebRTC or WebSocket using the command
  log, with desync detection by periodic world hashes.
- **E4 (P2) Larger maps and map sizes** (128², 160²): chunk culling in 2D, path
  caching, and a hierarchical path search.
- **E5 (P3) Map editor** writing scenario JSON (see G2).

## Known issues

- The 3D view's construction sites show a growing model but no material piles
  (the 2D view shows them). See R1.
- Enemy road plans are drawn only faintly, and field plans are hidden.
- The AI does not build mines or smithies; its iron gear comes from the trickle.
  See G3.
- Under software GL (headless Chromium with no GPU), 3D runs at about 3 fps. This
  is expected; don't optimize for it.
- Hungry soldiers walk to the inn even from far away. See G6.
- Seen once under SwiftShader and not reproducible since: a smoke screenshot
  where the land north of the town looked submerged, as if a terrain chunk hadn't
  drawn for that frame. If you see it again, suspect `Terrain.flatten()` →
  `writeGeometry()` (bounding volumes / attribute upload) in
  `src/render/three/terrain.js`.

## Done

- Foundation: modular ES layout; pure core; command layer with replay; event and
  renderer contracts with tests; three.js renderer; smoke harness; agent docs.
