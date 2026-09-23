# Architecture

```
             ┌──────────────────────── browser ─────────────────────────┐
  input ───► │ ui/ui.js ──exec(cmd)──► game.js ──applyCommand──► core   │
             │    ▲  state.ghost/sel        │  drainEvents()     World │
             │    │                          ▼                     │    │
             │ render/renderer.js ◄── draw(alpha, ui.state) ◄───────┘    │
             │   ├ three/renderer3d.js (default)     reads world only   │
             │   └ renderer2d.js       (fallback)                        │
             └───────────────────────────────────────────────────────────┘
  Node tests / tools import src/core directly (no DOM).
```

## Layers

| Layer | Owns | May import |
| --- | --- | --- |
| `src/core` | all game rules and state | only `src/core` |
| `src/render` | drawing; camera; picking helpers | `core` (read-only), `three` |
| `src/ui` | input, panels, transient UI state (`ui.state`) | `core` (read-only), `render/art2d`, `render/minimap` |
| `src/game.js` | loop, renderer lifecycle, events → feedback, save/load, command log | everything |

## The loop (`src/game.js`)

A fixed-timestep accumulator. Each frame adds `min(dt, 0.25) × speed` to the
accumulator and runs `world.step()` while it holds at least `TICK` (0.1 s), up to
64 steps per frame. The renderer interpolates unit positions between ticks with
`alpha = acc / TICK`. The 0.25 s clamp is deliberately high so that game time
tracks wall time on slow devices; the step cap bounds the catch-up work instead.

## World (`src/core/world.js`)

`new World({ seed, difficulty, W, H, noAI })` generates the map, lays out both
starting towns (`setup.js`) and creates the AI. All state is plain objects in
`Map`s keyed by id, and entities reference each other **by id**, never by object.
That is why saves are simple and replays are exact.

```
world.map        GameMap: typed arrays per tile (terrain, ore, tree, stone, road, field, plan, bld, ...)
world.players    [Player]  per-player road components (comp), stats, alert timers
world.units      Map<id, Unit>
world.buildings  Map<id, Building>
world.groups     Map<id, Group>       soldier groups (formations)
world.cjobs      Map<id, CJob>        construction jobs: 'road' | 'field' | 'site'
world.projectiles, world.effects      short-lived arrays (effects are visual-only but deterministic)
world.rng        seeded RNG; the only randomness allowed in core
world.time, world.tickN
world.over       null | { winner, time }
```

### Tick order (`World.step`)

1. Advance `time` and `tickN`; recompute road components for players whose roads changed.
2. `rebuildGrid()`: 8×8-tile spatial buckets for enemy queries.
3. `updateUnit(u)` for every unit (citizens by type; soldiers via `updateSoldier`).
4. `separateSoldiers()`: soft push-apart so melee doesn't stack.
5. `updateBuilding(b)`: school training, barracks equipping, tower shots.
6. `updateGroup(g)`: order bookkeeping (move finished, target dead → regroup).
7. Projectiles, then effects.
8. Every 10 ticks (1 s): `updateNature()` for tree growth, crop growth and fish regrowth.
9. Every 5 ticks: `runLogistics(p)` and `runConstruction(p)` per player.
10. `tick % 10 === 5`: `runStaffing(p)` (workers to workshops, recruits to towers/barracks).
11. `tick % 10 === 3`: `ai.think()`.
12. `tick % 10 === 7`: `checkEnd()`.

### Entities (main fields)

**Unit**: `{ id, owner, type, kind: 'citizen'|'soldier', x, y, px, py (previous tick,
for interpolation), dir, speed, hp, maxHp, cond (hunger 0..1), path, pi, goal,
job, home, inside, carry, group, target, targetB, slot, cd, act, moving }`

- `job` is a small state machine object whose `kind` is one of `deliver`, `return`,
  `build`, `gohome`, `work`, `eat`, `enlist`, `guard` or `wander`, plus a phase and
  timers.
- `inside` is the id of the building the unit is in (the unit is hidden).
  `home` is the workshop the unit works at.
- `act` is set each tick for animation (`dig`, `hammer`, `chop`, `mine`, `fish`,
  `fight` or `shoot`).

**Building**: `{ id, type, def, owner, x, y, w, h, door, dx, dy, state: 'site'|'done',
hp, maxHp, site: { level, delivered, used, total, cj }, stock, incoming, outRes, worker,
orders, rr, queue, train, recruits, guard, blocked, active, lastHit }`

- The footprint is `w × h` tiles from `(x, y)`. The entrance tile `(dx, dy)` sits
  just below the bottom row and is always a road.
- `incoming[g]` counts goods on their way here. `outRes[g]` counts goods reserved
  for pickup. Tests assert `0 <= outRes <= stock`.

**Group**: `{ id, owner, type, members: [unitId], cols, fx, fy (facing), ax, ay (anchor),
order: { kind: 'idle'|'move'|'attack'|'attackB', ... }, rally, offensive }`

**CJob**: `{ id, owner, type: 'road'|'field'|'site', idx (tile), bid?, laborer, stone,
stoneInc, retryAt }`

### Movement and pathfinding (`path.js`, `units.js`)

- `walkTo(u, goal, opts)` returns 1 when arrived, 0 while walking and -1 if
  unreachable. It plans lazily with A* and re-plans when the next tile becomes
  blocked.
- General movement is 8-directional with no corner cutting. Road tiles cost 0.6,
  mountains 1.5 and trees 1.3.
- `roadOnly` is 4-directional over the owner's roads. Serfs use it while carrying,
  which is the core rule of the genre. The start and goal tiles may be off-road.
- Units don't collide (soldiers separate softly). There is one unit position per
  unit, in tile units.

### Logistics (`World.runLogistics`)

Every 0.5 s, per player:

1. **Collect idle serfs.**
2. **Collect offers:** producer output stock minus reservations, and storehouse
   stock.
3. **Collect demands:** each building's `want(b, g)`: missing site materials,
   workshop inputs, inn food, school gold, barracks warfare and tower stones. A
   road plan with no stone yet also demands one.
4. **Sort demands** by priority: sites and roads first, then school and inn, then
   workshops, then the barracks.
5. **Match.** In round-robin passes, each demand takes the nearest offer on a
   **shared road component** (storehouse offers carry a small distance penalty),
   and the offer takes the nearest idle serf.
6. **Store the surplus.** Leftover producer output goes to the nearest storehouse
   that accepts it.

Road components come from a flood fill over each player's road tiles
(`computeRoadComps`). A building is connected if its entrance tile, or a
neighbouring tile, is on a component.

### Construction

A site job moves through three stages:

1. A laborer levels the ground (`site.level` goes from 0 to 1).
2. Serfs deliver timber and stone.
3. The laborer spends 2.2 s per delivered unit. At `used === total` the building
   completes.

Laborers leave sites that have nothing to build yet and come back when
materials arrive (`siteNeedsLaborer`). Roads need one stone each and fields need
labour only.

### Production

Workers walk to their workshop and go inside, and the worker drives the cycle
(`workerThink`):

- **`convert` / `mine`:** consume a recipe's inputs, wait `time`, then add the
  outputs. Multi-recipe shops rotate through their enabled recipes.
- **`gather` / `farm`:** reserve a target tile (tree, stone, water or field), walk
  out, work, then carry the result home.

Output is capped at 6 per building; after that the worker waits.

### Combat (`combat.js`)

- **Groups:** soldiers belong to groups. Moving a group assigns formation slot
  tiles around the anchor, facing the direction of travel.
- **Target selection** runs each tick, in this order:
  1. the current target, leashed to 14 tiles from the slot while idle;
  2. the group order target;
  3. the nearest enemy in aggro range (idle groups only);
  4. retaliation against a recent attacker;
  5. helping a group mate.
- **Melee** hits directly. **Ranged** units spawn lightly homing projectiles.
- **Damage** is `atk × (0.8–1.2) × (1 − armour)`, times `bonusMounted` against
  horsemen.

### AI (`ai.js`)

The AI thinks once a second:

- **School:** keeps serfs and laborers topped up, staffs its workshops, and trains
  recruits up to the army cap.
- **Barracks:** equips the best soldier its stock allows.
- **Defence:** idle groups attack enemies near its buildings.
- **Attack waves:** from `diff.firstAttack` onwards, every `diff.interval`, once
  it has `wave + waves × waveGrow` soldiers.
- **Supply trickle:** stands in for the mines and smithies it doesn't build.
- **Rebuilding:** re-places any building from its original layout that was
  destroyed.

### Save format (`save.js`)

`saveWorld(w)` returns plain JSON: entity arrays plus the map's typed arrays as
base64, with `v: SAVE_VERSION`. `loadWorld(data)` rebuilds a World without
regenerating the map. A save/load round trip continues identically to an
uninterrupted run (tested).

### Commands and replays (`commands.js`)

`applyCommand(world, { type, owner, ... })` is the only mutation path for players.
`CommandLog` records `{ tick, cmd }`, and `CommandLog.replay(freshWorld, entries,
tick)` reproduces a match exactly (tested). `game.exec()` records every UI action
in `game.log`.

## Rendering

### Contract (`src/render/renderer.js`)

The contract lists the methods every renderer implements. The UI picks units in
**screen space** with `toScreen(x, y, h)`, so that works for any camera. It picks
buildings with `pickBuilding()` first and falls back to the tile under the cursor.
The UI computes `ui.state.ghost` (placement preview) and `hoverBuilding`;
renderers only draw them.

### 3D (`src/render/three/`)

- **`terrain.js`:** one 16×16-tile chunk mesh per chunk, built over a vertex
  height grid (`map.height × HS`) with seamless normals. Each chunk gets a
  512 px canvas texture. The base layer comes from `renderTerrainChunk` (shared
  with 2D). Roads, fields and plans are painted on top with the shared tile
  painters, and a chunk is repainted only when a per-tile signature changes.
  Ground under buildings is flattened.
- **`models.js`:** procedural low-poly buildings, merged per material and cached
  per (type, owner). Also tree and rock geometry.
- **`actors.js`:** `Batch` wraps an `InstancedMesh` that is refilled every frame.
  Units are assembled from instanced parts; projectiles and effects work the same
  way.
- **`renderer3d.js`:** camera (fixed pitch, looking north), sun with a
  view-following shadow frustum, and sync of trees, rocks and buildings. The 2D
  HUD canvas draws health bars, badges, floaters and the selection box.

Per-frame JavaScript cost is under 1 ms with about 50 draw calls. To profile,
wrap `renderer.syncNature / syncBuildings / drawActors / drawHud / gl.render`
with `performance.now()` in the page.

### 2D (`renderer2d.js`)

Terrain chunks are pre-rendered at 32 px per tile. Ground overlays are drawn per
frame. Trees, stones, buildings and units are depth-sorted by y and drawn as
cached sprites or paths.

## UI (`src/ui/ui.js`)

- **`ui.state`:** `tool`, `hover`, `drag`, `box`, `selGroups`, `selBuilding`,
  `selUnit`, `ghost`, `hoverBuilding` and `tab`.
- **Input:** pointer events bind to `#stage`, so they survive renderer swaps.
- **Panel:** the side panel is re-rendered as an HTML string every 250 ms, and only
  swapped in when it changed. Clicks use event delegation on `data-act`.
