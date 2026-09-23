# Knights & Merchants — browser remake

A fan-made browser rebuild of the classic 1998 medieval economy and war
strategy game. Build a road-connected town, run long production chains,
feed your people, forge weapons and march on the red lord.

Plain ES modules with no build step and no runtime dependencies. It renders in
3D with three.js (vendored), with a classic 2D canvas view as a fallback. All
art is generated procedurally at runtime.

## Play

```sh
npm start            # serves the folder at http://localhost:8000
```

ES modules need an HTTP server, so opening `index.html` directly from disk won't
work. Any static server will do. Switch between 3D and classic 2D graphics in the
☰ menu.

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

## Developing

Start with **[AGENTS.md](AGENTS.md)**: commands, repository map, invariants and
the definition of done. Then read:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the simulation, logistics, combat, AI, saves, commands and renderers
- [docs/EXTENDING.md](docs/EXTENDING.md): step-by-step recipes (new building, good, soldier, command, event...)
- [docs/ROADMAP.md](docs/ROADMAP.md): prioritized backlog with acceptance criteria
- [docs/DECISIONS.md](docs/DECISIONS.md): why things are the way they are

```sh
npm test         # headless simulation + architecture tests (no install needed)
npm run smoke    # browser run of both renderers, screenshots in shots/ (needs Playwright)
```

---

This is a fan tribute and is not affiliated with the original developers or
publishers.
