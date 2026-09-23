# Extending the game: recipes

Each recipe lists every place a change must touch. The tests in
`test/contracts.test.js` catch most omissions. Run `npm test` after each step.

## Add a good

1. Add it to `GOODS` in `src/core/data.js` with a name, an icon (an emoji, used by
   the UI) and a colour (used for carried goods and the 3D crates).
2. Give it a producer (a recipe `out` or a gatherer `out`) and a consumer (a recipe
   `in`, `FOODS`, `WARFARE` or a construction cost). The contracts test fails
   otherwise.
3. If it's food, add it to `FOODS` with its nourishment value; the inn accepts it
   automatically. If it's warfare, add it to `WARFARE`; the barracks stores it
   automatically.

## Add a production building

1. **Data:** add an entry to `BUILDINGS` in `src/core/data.js`. Choose a `kind`:
   - `convert`: inputs → outputs inside, via `recipes: [{ in, out, time }]`.
   - `mine`: like `convert` with no inputs. Set `ore` (1 coal, 2 iron, 3 gold);
     placement then requires that seam.
   - `gather`: walks out to tiles. Needs a new `case` in
     `findOutdoorTask()` (`src/core/units.js`) and a resolution in
     `workOutdoor()`.
   - `farm`: works fields of kind `field`.

   Also set `worker` (a key of `CITIZENS`), `w` / `h`, `cost` and a `group` for the
   build menu. `inputs` and `outputs` are derived automatically.
2. **2D art:** add a `BSTYLE` entry in `src/render/art2d.js`, either a generic house
   (`wall`, `roof`, `H`, `roofH`, `props`) or `special` with a new draw function.
3. **3D art:** add a `STYLE` entry in `src/render/three/models.js` (same idea), or
   a `case` in `buildBuilding()` for a bespoke model. The model frame puts the
   origin at the footprint's north-west corner and the entrance on the +z side.
   Set `meta.chimney` for smoke or `meta.hub` for rotating parts.
4. **AI (optional):** add the type to `AI_TOWN` in `src/core/setup.js` so the AI
   builds it. If it's a gatherer, add an `AUTO_REQ` check so the auto-layout places
   it near its resource.
5. **Test:** extend the "full economy" test in `test/sim.test.js`, or add one that
   places it with `autoPlace()`, runs the world and asserts
   `players[0].stats.produced[good] > 0`.

## Add a citizen profession

Add an entry to `CITIZENS` in `data.js` (the tunic colour is used by both
renderers) and reference it as some building's `worker`. The school panel lists
it automatically.

## Add a soldier type

1. Add an entry to `SOLDIERS` in `data.js` with `hp`, `atk`, `arm`, `range`, `cd`,
   `speed` and `needs`. Add `ranged: 'arrow' | 'bolt'`, `mounted` and
   `bonusMounted` as needed.
2. **2D:** draw its weapon in `drawWeapon()` in `src/render/renderer2d.js`.
3. **3D:** draw its weapon in `Actors.weapon()` in `src/render/three/actors.js`, and
   add it to `IRON` if it wears plate.
4. **AI:** add it to the preference order in `AIController.think()`.
5. **Balance test:** add a matchup test like "pikemen beat knights" in
   `test/sim.test.js`.

## Add a player action

1. Add the rule to a World method or a behaviour mixin in `src/core`.
2. Add a command to `COMMANDS` in `src/core/commands.js`. It must be
   JSON-serializable, check ownership and carry a doc string.
3. Call `this.game.exec({ type, owner: 0, ... })` from `src/ui/ui.js`. Never call
   World methods directly from the UI (a test enforces this).
4. Add a test in `test/commands.test.js`.

## Add an event (sim → feedback)

1. Declare it in `EVENTS` in `src/core/events.js`, with its payload.
2. Emit it with `this.emit('name', { owner, x, y, ... })` from core.
3. Handle it in `Game.handleEvents()` in `src/game.js`: a sound, a message or a
   renderer `floater` / `flash`. The contracts test fails if any of the three
   steps is missing.

## Add a renderer feature

- If it's **state**, it belongs in core (or in `ui.state` for transient UI such as
  a new preview). Renderers only read.
- If the UI needs a new capability from renderers, add it to the contract comment
  in `src/render/renderer.js`, implement it in **both** renderers, and add the name
  to `CONTRACT` in `test/contracts.test.js`.
- In 3D, prefer instancing (a `Batch` in `actors.js`) for anything with many
  copies. Build static models once, merged per material, as in `models.js`.

## Add a map feature or terrain type

- Generation lives in `generateMap()` in `src/core/map.js`. It must stay
  deterministic in the seed (`RNG`, `hash2`, `valueNoise`) and keep resources
  reachable; the fairness test checks 10 seeds.
- New per-tile state goes in a typed array on `GameMap`, and in `MAP_ARRAYS` in
  `src/core/save.js` so saves include it (bump `SAVE_VERSION`).
- If it changes ground appearance, handle it in `renderTerrainChunk()` (both
  renderers use it). If it changes over time, add it to the chunk signature in
  `Terrain.update()` so the 3D textures repaint.

## Tune balance

- Economy timings: recipe `time` in `data.js`; `SCHOOL_TIME`; growth constants in
  `map.js`.
- Combat: the `SOLDIERS` table.
- AI pressure: `DIFFICULTY` (first attack, interval, wave size, army cap, trickle).

Then run `npm test`. "AI trains troops, attacks, and a passive player eventually
loses on hard" and "peaceful AI never attacks" guard the extremes.

## Vendor a library

Put the ES module build under `vendor/<name>/` with its LICENSE and a VERSION
note. Add it to the import map in `index.html`, and import it only from
`src/render` or `src/ui`, never from `src/core`.
