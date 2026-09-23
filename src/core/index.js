// Public entry point of the simulation. Everything under src/core is pure
// logic: no DOM, no canvas, no timers. It runs in Node for tests and tools.
export * from './data.js';
export * from './util.js';
export * from './map.js';
export * from './path.js';
export * from './world.js';
export * from './units.js';
export * from './buildings.js';
export * from './combat.js';
export * from './setup.js';
export * from './ai.js';
export * from './save.js';
export * from './events.js';
export * from './commands.js';
