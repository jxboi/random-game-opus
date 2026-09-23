# Design decisions

Short records of choices that shape the codebase. Add a new entry when you make
a similar call; don't silently reverse one. Reversing is fine, but write down why.

### D1: Plain ES modules, no bundler, vendored dependencies
Anyone (or any agent) can run the game with `npm start` and edit a file with
nothing to install or build. three.js is pinned under `vendor/three` and resolved
by an import map. Cost: opening `index.html` from `file://` doesn't work (module
CORS), so a static server is required (`tools/serve.mjs`, zero dependencies).

### D2: A deterministic fixed-tick simulation, isolated from the browser
The core runs at 10 ticks per second, uses only its seeded `RNG`, and never
touches the DOM or clocks. This buys headless tests, exact save/load, replays
and a clear path to lockstep multiplayer and a Web Worker. Rendering interpolates
between ticks, so 10 Hz still looks smooth.

### D3: Entities are plain objects referenced by id
There are no class instances or object references between entities: units hold
building ids, groups hold unit ids. Saves are JSON, and stale references show
up as `undefined` lookups instead of zombie objects. Every lookup of a stored id
must handle "gone".

### D4: World behaviour split into mixins
`World` holds state and core systems; `units.js`, `buildings.js` and `combat.js`
export method objects mixed into `World.prototype` at the end of `world.js`.
This keeps files focused without an ECS rewrite. Mixins may call each other's
methods through `this`.

### D5: Player actions are serializable commands
All UI actions go through `applyCommand`, which checks ownership. This is a
prerequisite for replays and multiplayer, and a single place to validate.
The AI still calls World methods directly because it runs inside the
deterministic simulation.

### D6: Two renderers behind one contract; three.js is the default
The 3D view is closer to the original and has the higher ceiling (models,
lighting, camera). The 2D canvas renderer stays as a fallback for no-WebGL
environments and as a cheap second implementation that keeps the contract
honest. The UI computes placement previews and picks units in screen space, so
renderers stay dumb.

### D7: The 3D terrain reuses the 2D painters
Terrain textures come from the same `renderTerrainChunk` and tile painters as the
2D view, drawn into per-chunk canvas textures and repainted only when tiles
change. That means one art path for ground detail (roads, fields, ore), and 2D
art improvements show up in 3D for free.

### D8: The AI gets a supply trickle
A prebuilt, working AI town plus a small periodic stock grant stands in for
full economic planning. It keeps the AI simple and tunable per difficulty.
Replacing it with real planning is roadmap item G3.
