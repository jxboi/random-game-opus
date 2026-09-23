// Command layer: ownership checks and deterministic replay.
import test from 'node:test';
import assert from 'node:assert';
import { World, applyCommand, CommandLog, COMMANDS, BUILDINGS } from '../src/core/index.js';

const snap = w => JSON.stringify([w.tickN, w.nextId, w.stockTotals(0), w.players.map(p => p.stats),
  [...w.units.values()].map(u => [u.id, u.x.toFixed(4), u.y.toFixed(4), u.hp.toFixed(3)]),
  [...w.buildings.values()].map(b => [b.id, b.type, b.state, b.hp.toFixed(2)])]);

test('every command has a doc string and a handler', () => {
  for (const [k, c] of Object.entries(COMMANDS)) {
    assert.ok(typeof c.doc === 'string' && c.doc.length > 5, `${k} doc`);
    assert.strictEqual(typeof c.run, 'function', `${k} run`);
  }
  assert.throws(() => applyCommand(new World({ seed: 1, noAI: true }), { type: 'nope', owner: 0 }));
});

test('commands cannot act on another player\'s things', () => {
  const w = new World({ seed: 3, noAI: true });
  const enemyGroup = [...w.groups.values()].find(g => g.owner === 1);
  const enemySchool = [...w.buildings.values()].find(b => b.owner === 1 && b.type === 'school');
  assert.strictEqual(applyCommand(w, { type: 'groupMove', owner: 0, gid: enemyGroup.id, x: 10, y: 10 }), false);
  assert.strictEqual(enemyGroup.order.kind, 'idle');
  assert.strictEqual(applyCommand(w, { type: 'schoolQueue', owner: 0, bid: enemySchool.id, utype: 'serf' }), false);
  assert.strictEqual(enemySchool.queue.length, 0);
  assert.strictEqual(applyCommand(w, { type: 'demolishBuilding', owner: 0, bid: enemySchool.id }), false);
  assert.ok(w.buildings.has(enemySchool.id));
});

test('a recorded command log replays to the identical world state', () => {
  const live = new World({ seed: 9, difficulty: 'normal' });
  const log = new CommandLog();
  const exec = cmd => { log.record(live, cmd); return applyCommand(live, cmd); };
  const s = live.map.starts[0];
  const run = n => { for (let i = 0; i < n; i++) live.step(); };
  // Find a valid spot for a woodcutter near the town and connect it.
  let placed = null;
  for (let dy = -8; dy <= 8 && !placed; dy++) for (let dx = -8; dx <= 8 && !placed; dx++) {
    const x = s.x + dx, y = s.y + dy;
    if (!live.canPlace(0, 'woodcutter', x, y)) placed = exec({ type: 'place', owner: 0, btype: 'woodcutter', x, y });
  }
  assert.ok(placed, 'placed a woodcutter');
  const store = [...live.buildings.values()].find(b => b.owner === 0 && b.type === 'storehouse');
  exec({ type: 'plan', owner: 0, kind: 1, x0: placed.dx, y0: placed.dy, x1: placed.dx, y1: store.dy });
  exec({ type: 'plan', owner: 0, kind: 1, x0: placed.dx, y0: store.dy, x1: store.dx, y1: store.dy });
  run(300);
  const school = [...live.buildings.values()].find(b => b.owner === 0 && b.type === 'school');
  exec({ type: 'schoolQueue', owner: 0, bid: school.id, utype: 'serf' });
  const g = [...live.groups.values()].find(g => g.owner === 0);
  exec({ type: 'groupMove', owner: 0, gid: g.id, x: s.x + 8, y: s.y - 8 });
  run(200);
  const split = exec({ type: 'groupSplit', owner: 0, gid: g.id });
  assert.ok(split > 0, 'split returns the new group id');
  exec({ type: 'groupJoin', owner: 0, gid: split, into: g.id });
  run(500);

  const replayed = CommandLog.replay(new World({ seed: 9, difficulty: 'normal' }), JSON.parse(JSON.stringify(log)), live.tickN);
  assert.strictEqual(snap(replayed), snap(live));
  assert.ok(BUILDINGS.woodcutter);
});
