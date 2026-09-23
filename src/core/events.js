// The event contract between the simulation and the app shell.
//
// The simulation calls world.emit(type, payload); the shell drains them once
// per frame (world.drainEvents()) and turns them into sound, messages and
// visual feedback in src/game.js. Every type listed here must be emitted
// somewhere in src/core and handled in src/game.js — test/contracts.test.js
// enforces both directions, so add new events here first.
//
// All payloads also carry { type, t } (t = world.time when emitted).
// Coordinates are in tiles.
export const EVENTS = {
  placed:    'A construction site was placed. { owner, bid }',
  planned:   'Road or field plans were laid. { owner, n }',
  completed: 'A building finished construction. { owner, bid, btype, x, y }',
  destroyed: 'A building was destroyed or demolished. { owner, btype, x, y, cause }',
  trained:   'The school trained a citizen. { owner, utype, x, y }',
  soldier:   'The barracks equipped a soldier. { owner, utype, x, y }',
  produced:  'A building owned by player 0 produced a good. { owner, g, x, y }',
  hit:       'A unit took damage. { owner, x, y, melee }',
  hitb:      'A building took damage. { owner, x, y }',
  shoot:     'A projectile was fired. { owner, kind, x, y }',
  death:     'A unit died. { owner, x, y, soldier, cause }',
  attacked:  'Throttled "under attack" alert for the victim. { owner, x, y }',
  hungry:    'Throttled starvation warning for player 0. { owner, x, y }',
  wave:      'The computer launched an attack wave. { owner, n }',
  victory:   'Player 0 won the match. {}',
  defeat:    'Player 0 lost the match. {}',
};
