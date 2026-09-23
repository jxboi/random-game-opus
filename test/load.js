'use strict';
// Loads the simulation scripts (no DOM) into a shared VM context for Node tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SIM_FILES = ['data.js', 'util.js', 'map.js', 'path.js', 'world.js', 'units.js',
  'buildings.js', 'combat.js', 'setup.js', 'ai.js'];

function loadSim() {
  const ctx = vm.createContext({ console, Math, Date, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } });
  for (const f of SIM_FILES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  // Expose lexical globals (class/const declarations) through a getter script.
  return vm.runInContext('({ World, BUILDINGS, SOLDIERS, GOODS, TICK, T_WATER, T_MOUNTAIN, TREE_MATURE, lineTiles, autoPlace, roadPath: (w, owner, start) => roadPathToNetwork(w, owner, start, new Set()) })', ctx);
}
module.exports = { loadSim, SIM_FILES };
