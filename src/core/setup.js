// ---------------------------------------------------------------------------
// Starting towns and the auto-layout helpers used by the computer player.
// ---------------------------------------------------------------------------
import { BUILDINGS } from './data.js';
import { T_WATER } from './map.js';
import { dist, hash2 } from './util.js';

export const SPIRAL = (() => {
  const out = [];
  for (let dy = -18; dy <= 18; dy++) for (let dx = -18; dx <= 18; dx++) {
    const d = Math.hypot(dx, dy);
    if (d <= 18) out.push([dx, dy, d + hash2(dx, dy, 77) * 0.5]);
  }
  out.sort((a, b) => a[2] - b[2]);
  return out;
})();

// Shortest 4-connected road route from `start` to the owner's existing road network.
// Returns tiles that need road (including start if it is not a road yet), [] if already
// on a road, or null if unreachable.
export function roadPathToNetwork(w, owner, start, blocked) {
  const m = w.map, W = m.W;
  const own = i => m.road[i] && m.roadOwner[i] === owner;
  if (own(start)) return [];
  let anyRoad = false;
  for (let i = 0; i < m.N; i++) if (own(i)) { anyRoad = true; break; }
  if (!anyRoad) return m.canRoad(start) ? [start] : null;
  const prev = new Map();
  prev.set(start, -1);
  const q = [start];
  let head = 0, found = -1;
  const ok = i => (m.canRoad(i) && !blocked.has(i)) || (m.plan[i] === 1 && m.planOwner[i] === owner);
  if (!ok(start)) return null;
  while (head < q.length && head < 4000) {
    const c = q[head++];
    const x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!m.inb(nx, ny)) continue;
      const n = m.idx(nx, ny);
      if (prev.has(n)) continue;
      if (own(n) && !m.bld[n]) { found = c; prev.set(n, c); head = q.length; break; }
      if (!ok(n)) continue;
      prev.set(n, c);
      q.push(n);
    }
  }
  if (found < 0) return null;
  const path = [];
  for (let c = found; c !== -1; c = prev.get(c)) path.push(c);
  return path.reverse();
}

// Resource requirement checks for gatherers when choosing a spot automatically.
export const AUTO_REQ = {
  woodcutter: (w, x, y) => { let n = 0; w.map.forRadius(x + 1, y + 1, 7, i => { if (w.map.tree[i]) n++; }); return n >= 8; },
  quarry: (w, x, y) => { let n = 0; w.map.forRadius(x + 1, y + 1, 8, i => { if (w.map.stone[i]) n++; }); return n >= 3; },
  fisher: (w, x, y) => { let n = 0; w.map.forRadius(x + 1, y + 1, 8, i => { if (w.map.terrain[i] === T_WATER) n++; }); return n >= 5; },
  farm: (w, x, y) => { let n = 0; w.map.forRadius(x + 1.5, y + 1, 4, i => { if (w.map.canField(i)) n++; }); return n >= 14; },
  vineyard: (w, x, y) => { let n = 0; w.map.forRadius(x + 1.5, y + 1, 4, i => { if (w.map.canField(i)) n++; }); return n >= 12; },
};

export function autoPlace(w, owner, type, cx, cy, instant) {
  const def = BUILDINGS[type], m = w.map;
  const req = AUTO_REQ[type];
  for (const [dx, dy] of SPIRAL) {
    const x = Math.round(cx + dx) - (def.w >> 1), y = Math.round(cy + dy) - (def.h >> 1);
    if (w.canPlace(owner, type, x, y)) continue;
    if (req && !req(w, x, y)) continue;
    const blocked = new Set(w.footprint(def, x, y));
    // Keep a margin so later buildings still fit.
    const d = w.doorOf(def, x, y);
    const path = roadPathToNetwork(w, owner, m.idx(d.x, d.y), blocked);
    if (!path) continue;
    const b = w.placeBuilding(owner, type, x, y, instant);
    if (!b) continue;
    for (const i of path) {
      if (instant) { if (!m.road[i]) w.buildRoadNow(owner, i); }
      else if (!m.road[i] && !m.plan[i]) w.planTile(owner, i % m.W, (i / m.W) | 0, 1);
    }
    if (def.kind === 'farm') layFields(w, b, instant ? 10 : 8, instant);
    return b;
  }
  return null;
}

export function layFields(w, b, n, instant) {
  const m = w.map;
  const cand = [];
  m.forRadius(b.x + b.w / 2, b.y + b.h / 2, 4.5, (i, x, y) => {
    if (!m.canField(i)) return;
    // don't pave over the tile right below any door
    if (m.road[i - m.W] || m.road[i + m.W]) return;
    cand.push([i, dist(x + 0.5, y + 0.5, b.x + b.w / 2, b.y + b.h / 2)]);
  });
  cand.sort((a, c) => a[1] - c[1]);
  for (const [i] of cand.slice(0, n)) {
    if (instant) {
      w.buildFieldNow(b.owner, i, b.def.field);
      if (w.rng.chance(0.6)) { m.fieldStage[i] = 1; m.fieldT[i] = w.rng.range(0, 90); }
    } else w.planTile(b.owner, i % m.W, (i / m.W) | 0, b.def.field + 1);
  }
}

export function randomNear(w, x, y, r) {
  const m = w.map;
  for (let k = 0; k < 40; k++) {
    const nx = x + w.rng.int(-r, r), ny = y + w.rng.int(-r, r);
    if (m.inb(nx, ny) && m.walkable(m.idx(nx, ny))) return [nx, ny];
  }
  return [x, y];
}

export function spawnGroup(w, owner, type, n, ax, ay, fx, fy) {
  if (n <= 0) return null;
  const g = w.newGroup(owner, type, ax + 0.5, ay + 0.5);
  g.fx = fx; g.fy = fy;
  for (let k = 0; k < n; k++) {
    const u = w.makeUnit(owner, type, ax, ay);
    u.cond = 0.85 + w.rng.next() * 0.15;
    w.addToGroup(g, u);
  }
  w.assignSlots(g);
  const W = w.map.W;
  for (const id of g.members) {
    const u = w.units.get(id);
    u.x = u.px = (u.slot % W) + 0.5; u.y = u.py = ((u.slot / W) | 0) + 0.5;
    u.dir = Math.atan2(fy, fx);
  }
  return g;
}

export const PLAYER_TOWN = ['school', 'inn'];
export const AI_TOWN = ['school', 'inn', 'barracks', 'sawmill', 'woodcutter', 'quarry', 'farm', 'mill', 'bakery',
  'weaponshop', 'armorshop', 'woodcutter', 'swine', 'butcher'];

export function setupTowns(w, opts = {}) {
  const m = w.map;
  const sa = w.diff.startArmy;
  for (const p of w.players) {
    const s = m.starts[p.id];
    const st = w.placeBuilding(p.id, 'storehouse', s.x - 1, s.y - 2, true);
    for (let x = s.x - 7; x <= s.x + 7; x++) { const i = m.idx(x, st.dy); if (m.canRoad(i)) w.buildRoadNow(p.id, i); }
    const town = p.isAI ? AI_TOWN : PLAYER_TOWN;
    for (const type of town) autoPlace(w, p.id, type, s.x, s.y, true);
    // Watchtowers face the enemy.
    const tx = p.isAI ? -1 : 1, ty = p.isAI ? 1 : -1;
    if (p.isAI) {
      autoPlace(w, p.id, 'tower', s.x + tx * 8, s.y + ty * 8, true);
      autoPlace(w, p.id, 'tower', s.x + tx * 2, s.y + ty * 10, true);
      autoPlace(w, p.id, 'tower', s.x + tx * 10, s.y + ty * 2, true);
    }
    // Stock
    st.stock = p.isAI
      ? { wood: 40, stone: 40, trunk: 10, gold: 14, bread: 30, sausage: 20, wine: 20, fish: 10, corn: 10,
          axe: 10, bow: 6, lance: 6, wooden_shield: 8, leather_armor: 14 }
      : { wood: 45, stone: 45, trunk: 12, gold: 30, bread: 25, sausage: 15, wine: 20, fish: 10, corn: 8,
          axe: 4, bow: 2, lance: 2, wooden_shield: 2, leather_armor: 4 };
    for (const b of w.buildings.values()) {
      if (b.owner !== p.id) continue;
      if (b.def.kind === 'inn') { b.stock = { bread: 8, sausage: 6, wine: 8 }; }
      if (b.def.kind === 'school') b.stock = { gold: 3 };
      if (b.def.kind === 'tower') b.stock = { stone: 5 };
      if (b.def.worker) { // prebuilt workshops come staffed
        const u = w.makeUnit(p.id, b.def.worker, b.dx, b.dy);
        u.home = b.id; u.inside = b.id; b.worker = u.id;
        u.job = { kind: 'work', phase: 'inside', t: 2 + w.rng.next() * 4 };
      }
      if (b.def.kind === 'tower') {
        const u = w.makeUnit(p.id, 'recruit', b.dx, b.dy);
        u.home = b.id; u.inside = b.id; b.guard = u.id; u.job = { kind: 'guard' };
      }
    }
    const people = p.isAI
      ? { serf: 10, laborer: 4, recruit: 6 }
      : { serf: 10, laborer: 6, woodcutter: 2, stonemason: 2, carpenter: 2, farmer: 2, baker: 2, fisher: 1, recruit: 2 };
    for (const t in people) for (let k = 0; k < people[t]; k++) {
      const [x, y] = randomNear(w, st.dx, st.dy + 2, 4);
      w.makeUnit(p.id, t, x, y);
    }
    // Armies
    const ax = s.x + tx * 6, ay = s.y + ty * 6;
    if (p.isAI) {
      spawnGroup(w, p.id, 'militia', Math.round(6 * sa), ax - 3, ay - 2, tx, ty);
      spawnGroup(w, p.id, 'axeman', Math.round(6 * sa), ax + 2, ay + 2, tx, ty);
      spawnGroup(w, p.id, 'bowman', Math.round(4 * sa), ax - 1, ay - 5, tx, ty);
      if (sa >= 1) spawnGroup(w, p.id, 'lancer', Math.round(4 * sa), ax + 5, ay - 1, tx, ty);
    } else {
      spawnGroup(w, p.id, 'militia', 6, ax - 3, ay + 2, tx, ty);
      spawnGroup(w, p.id, 'axeman', 4, ax + 1, ay - 1, tx, ty);
      spawnGroup(w, p.id, 'bowman', 4, ax - 3, ay - 3, tx, ty);
    }
  }
  for (const p of w.players) w.computeRoadComps(p);
}
