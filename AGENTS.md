# AGENTS.md: working on this codebase

This file is for AI agents (and humans) continuing development. Read it first,
then `docs/ARCHITECTURE.md`. `docs/ROADMAP.md` is the backlog; `docs/EXTENDING.md`
has step-by-step recipes for common changes.

## What this is

A browser remake of the 1998 economy/war strategy game *Knights and Merchants*.
It is plain ES modules with no bundler and no build step. three.js is vendored,
and the only tooling is Node (for tests) plus optional Playwright (for browser
checks).

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Serve the repo at http://localhost:8000 (`tools/serve.mjs`, zero dependencies). ES modules need a server, so opening `index.html` from disk does not work. |
| `npm test` | Headless simulation and architecture tests (`node --test`). Needs nothing installed. |
| `npm run smoke` | Drives the real UI in headless Chromium, once per renderer, and writes screenshots to `shots/`. Needs Playwright (see below). |
| `npm run check` | `test` + `smoke`. Run this before you call a change done. |

Playwright: `npm i --no-save playwright && npx playwright install chromium`, or use a
global install (`tools/smoke.mjs` finds either). Without a GPU, Chromium falls back to
SwiftShader. The 3D view then runs at a few fps, which is fine for checks but
meaningless for performance numbers (see "Measuring" below).

## Repository map

```
index.html            page shell + import map ("three" -> vendor/three)
css/style.css         all styling
src/main.js           boot; exposes window.km (debug/automation handle)
src/game.js           Game: loop, renderer choice, event -> sound/message, overlays, save/load, exec(command)
src/core/             THE SIMULATION: pure, deterministic, Node-compatible (no DOM)
  data.js             content tables: goods, citizens, soldiers, buildings, difficulty
  map.js              GameMap + procedural generation
  path.js             A* (general 8-dir, road-only 4-dir)
  world.js            World: tick loop, placement, roads, logistics, construction, staffing, win check
  units.js            UnitBehaviour mixin: movement, serfs, laborers, workers, eating
  buildings.js        BuildingBehaviour mixin: school, barracks, tower + building commands
  combat.js           CombatBehaviour mixin: groups, formations, soldiers, projectiles
  setup.js            starting towns, auto-layout (used by the AI too)
  ai.js               computer opponent
  commands.js         player command layer + CommandLog (replays)
  events.js           the event contract (sim -> shell)
  save.js             saveWorld / loadWorld
  index.js            public API (re-exports everything above)
src/render/
  renderer.js         renderer contract + factory (createRenderer)
  renderer2d.js       classic top-down canvas renderer (fallback)
  three/              three.js renderer (default): renderer3d, terrain, models, actors
  art2d.js            procedural 2D sprites, terrain painter, tile painters (shared with 3D textures)
  minimap.js          minimap (shared)
src/ui/ui.js          input, side panel, selection, placement ghost
src/ui/audio.js       WebAudio cues
test/                 node:test suites (sim, commands, contracts)
tools/                serve.mjs, smoke.mjs
vendor/three/         three.js r180, pinned (see VERSION)
docs/                 ARCHITECTURE, EXTENDING, ROADMAP, DECISIONS
```

## Invariants (the tests enforce most of these)

1. **`src/core` is pure.** No DOM, no `window`, no timers, no storage, no
   `Math.random`/`Date.now`, and no imports from `render/`, `ui/` or `three`.
   Randomness comes from `world.rng`, time from `world.time`, which advances only in
   `world.step()` (fixed `TICK` = 0.1 s). This is what makes tests, saves, replays
   and future multiplayer work. *(test/contracts.test.js)*
2. **Deterministic.** Same seed + same commands at the same ticks = same world.
   Iterate `Map`s in insertion order and never over object keys whose order could
   differ. *(test/sim.test.js, test/commands.test.js)*
3. **Player actions are commands.** The UI never mutates the world directly: it calls
   `game.exec({ type, owner, ... })` and the command layer (`src/core/commands.js`)
   validates ownership. New player actions get a new command type.
   *(test/contracts.test.js)*
4. **Renderers are read-only views.** A renderer reads `world` and `ui.state`
   and writes neither. Placement rules and picking logic live in the UI and core,
   not in renderers. The UI talks to renderers only through the contract in
   `src/render/renderer.js`. *(test/contracts.test.js)*
5. **Events are a contract.** Every `world.emit(type)` is declared in
   `src/core/events.js` and handled in `src/game.js handleEvents()`: no silent
   events and no dead handlers. *(test/contracts.test.js)*
6. **Content is data.** Goods, buildings, units and recipes live in
   `src/core/data.js`. Every good needs a producer and a consumer, and every
   building needs 2D and 3D art. *(test/contracts.test.js)*
7. **Both renderers keep working.** 3D is the default, and 2D is the fallback
   when WebGL is missing (and a menu option). Feature parity is nice but not
   required; a new world feature must at least not crash either renderer.
   *(npm run smoke)*
8. **Saves are versioned.** If you change the shape of saved state, bump
   `SAVE_VERSION` in `src/core/save.js` (old saves are then refused cleanly).
9. **No build step and no runtime dependencies.** If you add a library, vendor it
   under `vendor/` with its license and version, and map it in the import map.

## Working rules

- **Units:** everything in the sim is in tiles. Tile `(x, y)` covers `[x, x+1)`;
  +x is east, +y is south. A tile index is `y * W + x`. In three.js,
  tile `(x, y)` maps to `(x, height, y)`.
- **Where logic goes:** simulation rules go in `core`. How things look goes in
  `render/`. Input and panels go in `ui/`. Glue (sound, messages, overlays) goes in
  `game.js`.
- **Tests:** a change to rules gets a headless test in `test/`. Prefer asserting
  outcomes (a building completes, a good gets produced) over internals.
- **Visual changes:** run `npm run smoke` and **look at** `shots/*.png`
  before claiming a visual change works. For a focused look, drive the page with
  `window.km` (see below).
- **Keep files cohesive:** if a file grows past ~700 lines, split it along an
  existing seam, as with the `units` / `buildings` / `combat` mixins.
- **Style:** 2-space indent, single quotes, semicolons, `const` by default, small
  pure helpers, and comments that explain *why*. Match the surrounding code.

## Debug handle (`window.km` in the browser)

```js
km.world                      // live World
km.step(600)                  // advance 60 s synchronously
km.game.exec({ type: 'place', owner: 0, btype: 'sawmill', x: 20, y: 70 })
km.core.autoPlace(km.world, 0, 'farm', 17, 78, true)   // any core export
km.game.renderer.cam          // { x, y, zoom }
km.game.log.entries           // commands issued this game (replayable)
localStorage['km.renderer'] = '2d'   // force a renderer, then reload
```

## Measuring

- **Simulation:** `test/sim.test.js` has a performance test (10 game minutes must
  simulate in under 6 s). Profile with `node --cpu-prof`.
- **Rendering:** run a real browser with a GPU. SwiftShader numbers are 50–100×
  slower than hardware. The 3D renderer's JavaScript side costs under 1 ms per
  frame (≈50 draw calls). Measure that by wrapping the renderer methods, as
  `docs/ARCHITECTURE.md` describes.
- **Game clock:** game time must track wall time (ratio ≈ 1.0) even on slow
  frames. `MAX_FRAME` is 0.25 s on purpose; don't lower it.

## Definition of done

- [ ] `npm test` passes, and any new rule has a test
- [ ] `npm run smoke` passes, and you looked at the screenshots for visual changes
- [ ] New events, commands and content are declared where the invariants say
- [ ] Docs updated: this file for new rules, ROADMAP for status, EXTENDING for new recipes
