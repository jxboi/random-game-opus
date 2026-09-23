// Browser entry point. Loaded as an ES module from index.html.
import * as core from './core/index.js';
import { Game } from './game.js';

window.addEventListener('load', () => {
  const game = new Game();
  // Debug / automation handle for the console, tools/shots.mjs and agents:
  //   km.game.world          the live World (see src/core/world.js)
  //   km.core.autoPlace(...) any simulation export
  //   km.step(n)             advance the simulation n ticks synchronously
  window.game = game;
  window.km = {
    core,
    game,
    get world() { return game.world; },
    step(n = 1) { for (let i = 0; i < n; i++) game.world.step(); },
  };
});
