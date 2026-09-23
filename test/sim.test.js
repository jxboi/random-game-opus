// Headless simulation tests. Run with: npm test
import test from 'node:test';
import assert from 'node:assert';
import * as S from '../src/core/index.js';

const { World, T_WATER, T_MOUNTAIN, autoPlace, saveWorld, loadWorld } = S;

function run(w, seconds) { for (let i = 0; i < seconds * 10; i++) w.step(); }
function near(w, x, y, r, pred) {
  const m = w.map;
  let n = 0;
  m.forRadius(x, y, r, i => { if (pred(i)) n++; });
  return n;
}
function checkInvariants(w) {
  for (const b of w.buildings.values()) {
    for (const g in b.stock) assert.ok(b.stock[g] >= 0, `${b.type} stock ${g} negative`);
    for (const g in b.outRes) assert.ok(b.outRes[g] >= 0 && b.outRes[g] <= (b.stock[g] || 0), `${b.type} reserved ${g} out of range`);
    for (const g in b.incoming) assert.ok(b.incoming[g] >= 0, `${b.type} incoming ${g} negative`);
  }
  for (const u of w.units.values()) {
    assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y), 'unit position finite');
    assert.ok(u.x >= 0 && u.y >= 0 && u.x <= w.map.W && u.y <= w.map.H, 'unit on map');
  }
}

test('maps are fair: both towns reach each other and have every resource nearby', () => {
  for (const seed of [1, 7, 42, 1234, 99999, 3, 314, 2718, 5000, 8080]) {
    const w = new World({ seed, noAI: true });
    const m = w.map;
    for (const s of m.starts) {
      assert.ok(near(w, s.x, s.y, 20, i => m.tree[i] > 0) > 30, `seed ${seed}: trees near start`);
      assert.ok(near(w, s.x, s.y, 20, i => m.stone[i] > 0) >= 6, `seed ${seed}: stone near start`);
      assert.ok(near(w, s.x, s.y, 30, i => m.terrain[i] === T_WATER) >= 10, `seed ${seed}: water near start`);
      // Ore must be reachable on foot, not just nearby.
      const reach = new Uint8Array(m.N), q = [m.idx(s.x, s.y + 3)];
      reach[q[0]] = 1;
      while (q.length) {
        const i = q.pop(), x = i % m.W, y = (i / m.W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!m.inb(x + dx, y + dy)) continue;
          const j = m.idx(x + dx, y + dy);
          if (!reach[j] && m.walkable(j)) { reach[j] = 1; q.push(j); }
        }
      }
      for (const ore of [1, 2, 3]) assert.ok(near(w, s.x, s.y, 34, i => reach[i] && m.terrain[i] === T_MOUNTAIN && m.ore[i] === ore) >= 3, `seed ${seed}: reachable ore ${ore}`);
    }
    const a = m.starts[0], b = m.starts[1];
    const path = w.pf.find(m.idx(a.x, a.y + 3), m.idx(b.x, b.y + 3), { maxNodes: 100000 });
    assert.ok(path && path.length > 40, `seed ${seed}: towns connected by land`);
  }
});

test('every mine type can be placed near the player start', () => {
  for (const seed of [1, 42, 555]) {
    const w = new World({ seed, noAI: true });
    const s = w.map.starts[0];
    for (const type of ['coalmine', 'ironmine', 'goldmine']) {
      let ok = false;
      for (let y = s.y - 34; y <= s.y + 10 && !ok; y++) for (let x = s.x - 16; x <= s.x + 30 && !ok; x++) {
        if (!w.canPlace(0, type, x, y)) ok = true;
      }
      assert.ok(ok, `seed ${seed}: ${type} placeable`);
    }
  }
});

test('construction: laborers level, serfs deliver along roads, buildings complete', () => {
  const w = new World({ seed: 42, noAI: true });
  const s = w.map.starts[0];
  const placed = ['woodcutter', 'sawmill', 'quarry'].map(t => autoPlace(w, 0, t, s.x, s.y, false));
  assert.ok(placed.every(Boolean), 'all placed');
  run(w, 240);
  for (const b of placed) assert.strictEqual(w.buildings.get(b.id).state, 'done', `${b.type} completed`);
  run(w, 240);
  const pr = w.players[0].stats.produced;
  assert.ok(pr.trunk > 0 && pr.wood > 0 && pr.stone > 0, 'woodcutter, sawmill and quarry produce: ' + JSON.stringify(pr));
  checkInvariants(w);
});

test('buildings without a road connection never receive materials', () => {
  const w = new World({ seed: 42, noAI: true });
  const s = w.map.starts[0];
  // Find a clear spot well away from any road and place without connecting it.
  let b = null;
  for (let y = s.y - 16; y < s.y - 8 && !b; y++) for (let x = s.x + 8; x < s.x + 20 && !b; x++) {
    if (!w.canPlace(0, 'sawmill', x, y)) {
      const d = w.doorOf(S.BUILDINGS.sawmill, x, y);
      if (w.tileComps(w.players[0], w.map.idx(d.x, d.y)).length === 0) b = w.placeBuilding(0, 'sawmill', x, y);
    }
  }
  assert.ok(b, 'placed an isolated site');
  run(w, 120);
  assert.strictEqual(b.site.delivered.wood + b.site.delivered.stone, 0, 'nothing delivered');
  assert.strictEqual(b.state, 'site');
});

test('full economy: food chain and iron chain up to weapons', () => {
  const w = new World({ seed: 42, noAI: true });
  const s = w.map.starts[0];
  const st = [...w.buildings.values()].find(b => b.owner === 0 && b.type === 'storehouse');
  st.stock.wood = 200; st.stock.stone = 200; st.stock.gold = 60; st.stock.coal = 10;
  for (const t of ['woodcutter', 'sawmill', 'quarry', 'farm', 'mill', 'bakery', 'swine', 'butcher', 'smelter', 'weaponsmith', 'armorsmith', 'barracks'])
    assert.ok(autoPlace(w, 0, t, s.x, s.y, false), 'placed ' + t);
  // Mines on the nearby mountain, connected to the network with planned roads.
  const m = w.map;
  let mines = 0;
  for (const type of ['coalmine', 'ironmine']) {
    search: for (let y = s.y - 34; y <= s.y; y++) for (let x = s.x - 16; x <= s.x + 30; x++) {
      if (w.canPlace(0, type, x, y)) continue;
      const b = w.placeBuilding(0, type, x, y);
      const path = S.roadPathToNetwork(w, 0, b.door, new Set());
      if (!path) { w.destroyBuilding(b, 'demolish'); continue; }
      for (const i of path) if (!m.road[i] && !m.plan[i]) w.planTile(0, i % m.W, (i / m.W) | 0, 1);
      mines++;
      break search;
    }
  }
  assert.strictEqual(mines, 2, 'both mines placed with roads');
  const school = [...w.buildings.values()].find(b => b.owner === 0 && b.type === 'school');
  for (const t of ['miner', 'miner', 'metallurgist', 'smith', 'smith', 'breeder', 'butcher']) school.queue.push(t);
  run(w, 1500);
  const pr = w.players[0].stats.produced;
  for (const g of ['bread', 'sausage', 'coal', 'iron_ore', 'iron']) assert.ok(pr[g] > 0, `produced ${g}: ${JSON.stringify(pr)}`);
  assert.ok((pr.sword || 0) + (pr.pike || 0) + (pr.crossbow || 0) + (pr.iron_armor || 0) + (pr.iron_shield || 0) > 0, 'smithies forged something');
  checkInvariants(w);
});

test('combat resolves: stronger force wins and kills are recorded', () => {
  const w = new World({ seed: 3, noAI: true });
  // Remove existing armies.
  for (const u of [...w.units.values()]) if (u.kind === 'soldier') w.removeUnit(u);
  const mk = (owner, type, n, x, y) => {
    const g = w.newGroup(owner, type, x + 0.5, y + 0.5);
    for (let k = 0; k < n; k++) w.addToGroup(g, w.makeUnit(owner, type, x, y));
    w.assignSlots(g);
    return g;
  };
  const a = mk(0, 'swordsman', 6, 48, 48);
  const b = mk(1, 'militia', 6, 52, 48);
  w.cmdAttack(a.id, w.units.get(b.members[0]).id);
  run(w, 60);
  assert.ok(!w.groups.has(b.id), 'militia group destroyed');
  assert.ok(w.groups.has(a.id), 'swordsmen survive');
  assert.ok(w.players[0].stats.kills >= 6);
});

test('pikemen beat knights (anti-cavalry bonus matters)', () => {
  const w = new World({ seed: 3, noAI: true });
  for (const u of [...w.units.values()]) if (u.kind === 'soldier') w.removeUnit(u);
  const mk = (owner, type, n, x, y) => {
    const g = w.newGroup(owner, type, x + 0.5, y + 0.5);
    for (let k = 0; k < n; k++) w.addToGroup(g, w.makeUnit(owner, type, x, y));
    w.assignSlots(g);
    return g;
  };
  const pk = mk(0, 'pikeman', 6, 48, 48);
  const kn = mk(1, 'knight', 5, 52, 48);
  w.cmdAttack(kn.id, w.units.get(pk.members[0]).id);
  run(w, 90);
  assert.ok(!w.groups.has(kn.id), 'knights destroyed by pikemen');
});

test('AI trains troops, attacks, and a passive player eventually loses on hard', () => {
  const w = new World({ seed: 11, difficulty: 'hard' });
  let wave = false;
  for (let s = 0; s < 1800 && !w.over; s++) {
    run(w, 1);
    for (const e of w.drainEvents()) if (e.type === 'wave') wave = true;
    if (s % 300 === 0) checkInvariants(w);
  }
  assert.ok(w.players[1].stats.soldiers > 5, 'AI equipped soldiers');
  assert.ok(wave, 'AI launched an attack wave');
  assert.ok(w.over && w.over.winner === 1, 'passive player is defeated');
});

test('peaceful AI never attacks', () => {
  const w = new World({ seed: 11, difficulty: 'peaceful' });
  run(w, 1500);
  assert.ok(!w.over);
  assert.strictEqual(w.players[0].stats.buildingsLost, 0);
});

test('simulation is deterministic for a seed', () => {
  const snap = () => {
    const w = new World({ seed: 77, difficulty: 'normal' });
    run(w, 300);
    return JSON.stringify([w.time.toFixed(1), w.units.size, w.stockTotals(0), w.stockTotals(1), [...w.units.values()].slice(0, 20).map(u => [u.x.toFixed(3), u.y.toFixed(3)])]);
  };
  assert.strictEqual(snap(), snap());
});

test('demolish removes buildings, plans and roads; walkable again', () => {
  const w = new World({ seed: 42, noAI: true });
  const s = w.map.starts[0];
  const b = autoPlace(w, 0, 'sawmill', s.x, s.y, false);
  const i = w.map.idx(b.x, b.y);
  assert.ok(!w.map.walkable(i));
  assert.strictEqual(w.demolish(0, b.x, b.y), BUILDINGS_NAME('sawmill'));
  assert.ok(w.map.walkable(i));
  assert.ok(!w.buildings.has(b.id));
  function BUILDINGS_NAME(t) { return S.BUILDINGS[t].name; }
});

test('performance: 10 minutes of a full match simulates quickly', () => {
  const w = new World({ seed: 5, difficulty: 'normal' });
  const t0 = process.hrtime.bigint();
  run(w, 600);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 6000, `took ${ms.toFixed(0)} ms`);
});

test('save / load round-trips and the game continues identically', () => {
  const a = new World({ seed: 21, difficulty: 'hard' });
  const s0 = a.map.starts[0];
  autoPlace(a, 0, 'woodcutter', s0.x, s0.y, false);
  autoPlace(a, 0, 'farm', s0.x, s0.y, false);
  run(a, 400);
  const blob = JSON.stringify(saveWorld(a));
  assert.ok(blob.length < 2e6, 'save is small enough for localStorage: ' + blob.length);
  const b = loadWorld(JSON.parse(blob));
  run(a, 500); run(b, 500);
  const snap = w => JSON.stringify([w.time.toFixed(1), w.nextId, w.stockTotals(0), w.stockTotals(1), w.players.map(p => p.stats),
    [...w.units.values()].map(u => [u.id, u.x.toFixed(3), u.y.toFixed(3), u.hp.toFixed(2)])]);
  assert.strictEqual(snap(b), snap(a));
  checkInvariants(b);
});

test('a serf stranded with goods walks them back to the storehouse', () => {
  const w = new World({ seed: 42, noAI: true });
  const st = [...w.buildings.values()].find(b => b.owner === 0 && b.type === 'storehouse');
  const serf = [...w.units.values()].find(u => u.owner === 0 && u.type === 'serf');
  const before = st.stock.corn || 0;
  serf.x = st.dx + 6.5; serf.y = st.dy + 4.5; serf.job = null; serf.carry = 'corn';
  run(w, 30);
  assert.strictEqual(serf.carry, null, 'dropped the goods');
  // No mill or swine farm exists, so nothing else wants the corn: it must be in the storehouse.
  assert.strictEqual(st.stock.corn || 0, before + 1, 'corn reached the storehouse');
  assert.ok(!serf.job || serf.job.kind !== 'return', 'not stuck in return');
});
