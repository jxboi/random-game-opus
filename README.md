# Knights & Merchants — browser remake

A fan-made browser rebuild of the classic 1998 medieval economy and war
strategy game. Build a road-connected town, run long production chains,
feed your people, forge weapons and march on the red lord.

Plain HTML, CSS and JavaScript. There are no dependencies and no build step,
and all art is drawn procedurally at runtime.

## Play

Open `index.html` in a browser. Or serve the folder:

```sh
npm start            # python3 -m http.server 8000 → http://localhost:8000
```

## How it plays

- **Roads are everything.** Serfs only carry goods along roads. Every
  building's entrance (the yellow marker when you place it) must join your
  road network. Each road tile costs one stone.
- **Construction.** Laborers level the site, serfs bring timber and stone,
  and then the house goes up.
- **Workers.** Each workshop needs a specific citizen, trained at the
  **School** for one gold chest. A workshop with no worker shows a red 👤.
- **Food.** Everyone gets hungry. Keep the **Inn** stocked with bread,
  sausages, wine or fish, or people starve.
- **Army.** Recruits from the School go to the **Barracks**, which equips
  them with weapons and armor. Nine unit types: militia, axe fighters,
  lance carriers, bowmen, swordsmen, pikemen, crossbowmen, scouts and
  knights. Lances and pikes are strong against horsemen.
- **Win** by destroying the enemy's storehouse, school and barracks and
  killing all of their soldiers.

### Production chains

| Chain | Buildings |
| --- | --- |
| Timber | Woodcutter's (trees) → Sawmill |
| Stone | Quarry (stone deposits) |
| Bread | Farm + corn fields → Mill → Bakery |
| Sausages & leather | Farm corn → Swine farm → Butcher's / Tannery |
| Wine, fish | Vineyard + wine fields, Fisherman's hut |
| Iron gear | Coal + iron mines (on mountain seams) → Iron smelter → Weapon / Armor smithy |
| Wooden gear | Timber → Weapons workshop (axe, lance, bow), Armory workshop (shield; leather → armor) |
| Gold | Gold mine + coal → Metallurgist's |
| Horses | Farm corn → Stables |

### Controls

| Action | Input |
| --- | --- |
| Scroll | WASD / arrow keys, right-drag, or the minimap |
| Zoom | Mouse wheel, `+` / `-` |
| Select | Left-click; drag a box to select several soldier groups; Shift-click to add |
| Move / attack | Right-click ground, an enemy unit or an enemy building |
| Road / corn field / wine field | `R` / `F` / `V`, then drag |
| Demolish | `X` |
| Pause / speed | `Space`, `1` `2` `3` |
| Next group / halt | `Tab` / `G` |
| Home / cancel | `H` / `Esc` |

On touch screens: drag to pan, pinch to zoom, tap to select, and tap the
ground or an enemy to order the selected troops.

Games can be saved and loaded from the ☰ menu. There is one save slot,
kept in the browser's local storage.

## Difficulty

| Level | First attack | Enemy army cap |
| --- | --- | --- |
| Peaceful | never | 20 |
| Easy | ~22 min | 18 |
| Normal | ~16 min | 30 |
| Hard | ~11 min | 50 |

The computer runs the same economy you do from a prebuilt town. It also gets
a small supply trickle in place of the mines and smithies it doesn't build.
It defends its town, rebuilds what you burn and sends larger waves over time.

## Code layout

| File | Purpose |
| --- | --- |
| `js/data.js` | Goods, citizens, soldiers, buildings, difficulty tables |
| `js/map.js` | Tile map and procedural map generation (fair, mirrored resources) |
| `js/path.js` | A* pathfinding (general and road-only) |
| `js/world.js` | Simulation core: placement, roads, logistics, construction, staffing |
| `js/units.js` | Movement and citizen behaviour (serfs, laborers, workers, eating) |
| `js/buildings.js` | School, barracks, watchtower |
| `js/combat.js` | Groups, formations, soldiers, projectiles |
| `js/setup.js` | Starting towns and the auto-layout used by the AI |
| `js/ai.js` | Computer opponent |
| `js/save.js` | Save / load |
| `js/art.js`, `js/render.js` | Procedural sprites and the canvas renderer |
| `js/audio.js` | WebAudio sound cues |
| `js/ui.js`, `js/main.js` | Input, side panel, overlays, game loop |

The simulation (`data` through `save`) never touches the DOM. It runs at a
fixed 10 ticks per second and is deterministic for a given seed. The renderer
interpolates between ticks.

## Tests

```sh
npm test
```

The Node tests run the simulation headlessly. They cover:

- map fairness and reachability across seeds
- construction, and road-only deliveries
- the full food and iron chains
- combat balance, including pikes beating knights
- AI waves, and peaceful mode never attacking
- determinism, and save/load continuing identically
- performance

---

This is a fan tribute and is not affiliated with the original developers or
publishers.
