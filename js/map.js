'use strict';
// ---------------------------------------------------------------------------
// Tile map and procedural map generation.
// ---------------------------------------------------------------------------

const T_GRASS = 0, T_WATER = 1, T_MOUNTAIN = 2, T_SAND = 3;
const ORE_NAMES = ['', 'coal', 'iron', 'gold'];
const TREE_MATURE = 5;
const TREE_STAGE_TIME = 45;     // seconds per growth stage
const FIELD_GROW_TIME = 110;    // corn seconds from sowing to ripe
const WINE_GROW_TIME = 130;

class GameMap {
  constructor(W, H) {
    this.W = W; this.H = H;
    const N = W * H;
    this.N = N;
    this.terrain = new Uint8Array(N);
    this.ore = new Uint8Array(N);
    this.tree = new Uint8Array(N);       // 0 none, 1..4 growing, 5 mature
    this.treeT = new Float32Array(N);
    this.stone = new Uint8Array(N);      // stone left in deposit
    this.fish = new Uint8Array(N);
    this.road = new Uint8Array(N);
    this.roadOwner = new Int8Array(N).fill(-1);
    this.field = new Uint8Array(N);      // 0 none, 1 corn, 2 wine
    this.fieldStage = new Uint8Array(N); // 0 bare, 1 growing, 2 ripe
    this.fieldT = new Float32Array(N);
    this.fieldOwner = new Int8Array(N).fill(-1);
    this.plan = new Uint8Array(N);       // 0 none, 1 road, 2 corn field, 3 wine field
    this.planOwner = new Int8Array(N).fill(-1);
    this.planJob = new Int32Array(N);
    this.bld = new Int32Array(N);        // building id occupying tile
    this.reserve = new Int32Array(N);    // unit id working this tile
    this.height = new Float32Array((W + 1) * (H + 1)); // vertex heights for shading
    this.version = new Uint32Array(Math.ceil(W / 16) * Math.ceil(H / 16)); // terrain chunk revisions
    this.growing = new Set();            // tiles with growing trees
  }
  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  walkable(i) { return this.terrain[i] !== T_WATER && this.stone[i] === 0 && this.bld[i] === 0; }
  // Tile cost used by pathfinding (1 = grass).
  cost(i, owner) {
    if (this.road[i]) return 0.6;
    const t = this.terrain[i];
    let c = t === T_MOUNTAIN ? 1.5 : t === T_SAND ? 1.1 : 1;
    if (this.tree[i]) c += 0.3;
    if (this.field[i]) c += 0.15;
    return c;
  }
  speedFactor(i) {
    if (this.road[i]) return 1.3;
    const t = this.terrain[i];
    if (t === T_MOUNTAIN) return 0.7;
    if (this.tree[i] >= 3) return 0.85;
    return 1;
  }
  clearForBuilding(i) {
    const t = this.terrain[i];
    return (t === T_GRASS || t === T_SAND) && !this.tree[i] && !this.stone[i] && !this.bld[i] &&
      !this.road[i] && !this.field[i] && !this.plan[i];
  }
  canRoad(i) {
    const t = this.terrain[i];
    return t !== T_WATER && !this.tree[i] && !this.stone[i] && !this.bld[i] && !this.road[i] && !this.field[i] && !this.plan[i];
  }
  canField(i) { return this.terrain[i] === T_GRASS && this.clearForBuilding(i); }
  touch(i) { // mark terrain chunk for re-render
    const x = i % this.W, y = (i / this.W) | 0;
    this.version[(y >> 4) * Math.ceil(this.W / 16) + (x >> 4)]++;
  }
  // Is any tile of the given kind within radius (Chebyshev-ish circle) of (cx,cy)?
  forRadius(cx, cy, r, fn) {
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.H - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.W - 1, Math.ceil(cx + r)); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) if (fn(this.idx(x, y), x, y) === true) return true;
      }
    return false;
  }
}

// ---------------------------------------------------------------------------
function generateMap(seed, W = 96, H = 96) {
  const rng = new RNG(seed * 7919 + 13);
  const m = new GameMap(W, H);
  const elev = new Float32Array(W * H);
  const moist = new Float32Array(W * H);
  const starts = [{ x: 17, y: H - 18 }, { x: W - 18, y: 17 }];

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = m.idx(x, y);
    let e = fbm(x / 20, y / 20, seed, 4);
    // Stretch contrast so we get real lakes and ridges.
    e = clamp((e - 0.5) * 1.9 + 0.5, 0, 1);
    for (const s of starts) {
      const d = dist(x, y, s.x, s.y);
      e = lerp(0.5, e, smoothstep(10, 17, d));
    }
    // Keep map edges mostly dry land.
    elev[i] = e;
    moist[i] = fbm(x / 11, y / 11, seed + 101, 3);
  }

  for (let i = 0; i < W * H; i++) {
    const e = elev[i];
    m.terrain[i] = e < 0.27 ? T_WATER : e > 0.74 ? T_MOUNTAIN : T_GRASS;
  }

  // --- resource stamps, placed for player 0 and mirrored for player 1 ---
  const mirror = (p, k) => (k === 0 ? p : { x: W - 1 - p.x, y: H - 1 - p.y });
  const blob = (cx, cy, r, fn) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (!m.inb(x, y)) continue;
        const wob = 0.8 + 0.4 * valueNoise(x * 0.7, y * 0.7, seed + 55);
        if (dist(x, y, cx, cy) <= r * wob) fn(m.idx(x, y), x, y);
      }
  };
  const s0 = starts[0];
  const stamps = [];
  // Offsets relative to player 0 start (bottom-left). Direction to center is up-right.
  stamps.push({ kind: 'forest', x: s0.x + 1, y: s0.y - 12, r: 6 });
  stamps.push({ kind: 'forest', x: s0.x + 13, y: s0.y + 6, r: 5 });
  stamps.push({ kind: 'stone', x: s0.x - 9, y: s0.y - 5, r: 2.4 });
  stamps.push({ kind: 'stone', x: s0.x + 11, y: s0.y - 6, r: 1.8 });
  stamps.push({ kind: 'mountain', x: s0.x - 7, y: s0.y - 25, r: 5.5 });
  stamps.push({ kind: 'lake', x: s0.x + 22, y: s0.y - 2, r: 3.6 });

  for (let k = 0; k < 2; k++) {
    for (const st of stamps) {
      const c = mirror(st, k);
      if (st.kind === 'mountain') {
        blob(c.x, c.y, st.r, i => { m.terrain[i] = T_MOUNTAIN; m.tree[i] = 0; });
        // Ore seams: three clusters within the mountain.
        const seams = [[1, -2.5, -1.5], [2, 2.2, -1.2], [3, 0, 2.6], [1, -1.5, 2.2]];
        for (const [ore, ox, oy] of seams) {
          const sx = k === 0 ? ox : -ox, sy = k === 0 ? oy : -oy;
          blob(c.x + sx, c.y + sy, 1.7, i => { if (m.terrain[i] === T_MOUNTAIN) m.ore[i] = ore; });
        }
      } else if (st.kind === 'lake') {
        blob(c.x, c.y, st.r, i => { m.terrain[i] = T_WATER; m.tree[i] = 0; m.stone[i] = 0; });
      }
    }
  }
  // Random ore in other mountains.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = m.idx(x, y);
    if (m.terrain[i] !== T_MOUNTAIN || m.ore[i]) continue;
    const n = valueNoise(x / 3, y / 3, seed + 300);
    if (n > 0.72) m.ore[i] = 1 + Math.floor(valueNoise(x / 6, y / 6, seed + 301) * 2.999);
  }

  // Sand shores
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = m.idx(x, y);
    if (m.terrain[i] !== T_GRASS) continue;
    let nearWater = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (m.inb(x + dx, y + dy) && m.terrain[m.idx(x + dx, y + dy)] === T_WATER) nearWater = true;
    }
    if (nearWater && elev[i] < 0.34 + 0.06 * hash2(x, y, seed)) m.terrain[i] = T_SAND;
  }

  // Forests from moisture, plus scattered trees.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = m.idx(x, y);
    if (m.terrain[i] !== T_GRASS) continue;
    if ((moist[i] > 0.63 && rng.chance(0.62)) || rng.chance(0.025)) {
      m.tree[i] = rng.chance(0.85) ? TREE_MATURE : rng.int(1, 4);
    }
  }
  for (let k = 0; k < 2; k++) for (const st of stamps) {
    const c = mirror(st, k);
    if (st.kind === 'forest') blob(c.x, c.y, st.r, i => {
      if (m.terrain[i] === T_GRASS && rng.chance(0.7)) m.tree[i] = rng.chance(0.85) ? TREE_MATURE : rng.int(1, 4);
    });
    if (st.kind === 'stone') blob(c.x, c.y, st.r, i => {
      if (m.terrain[i] !== T_WATER) { m.stone[i] = rng.int(7, 12); m.tree[i] = 0; if (m.terrain[i] === T_MOUNTAIN) m.terrain[i] = T_GRASS; }
    });
  }
  // A few extra stone outcrops scattered in the middle of the map.
  for (let n = 0; n < 7; n++) {
    const cx = rng.int(20, W - 20), cy = rng.int(20, H - 20);
    if (starts.some(s => dist(cx, cy, s.x, s.y) < 16)) continue;
    blob(cx, cy, rng.range(1, 1.8), i => { if (m.terrain[i] === T_GRASS) { m.stone[i] = rng.int(5, 10); m.tree[i] = 0; } });
  }

  // Clear the town areas.
  for (const s of starts) {
    for (let y = s.y - 9; y <= s.y + 9; y++) for (let x = s.x - 9; x <= s.x + 9; x++) {
      if (!m.inb(x, y)) continue;
      const i = m.idx(x, y);
      if (dist(x, y, s.x, s.y) <= 9.5) { m.terrain[i] = T_GRASS; m.tree[i] = 0; m.stone[i] = 0; m.ore[i] = 0; }
    }
  }

  // Ensure the two bases are connected by walkable land, and every resource
  // stamp (mountain seams, forests) is reachable from its own town.
  ensureConnected(m, starts[0], starts[1]);
  for (let k = 0; k < 2; k++) for (const st of stamps) {
    if (st.kind !== 'mountain' && st.kind !== 'forest') continue;
    const c = mirror(st, k);
    ensureConnected(m, starts[k], { x: clamp(Math.round(c.x), 1, W - 2), y: clamp(Math.round(c.y), 1, H - 2) });
  }

  for (let i = 0; i < W * H; i++) {
    if (m.terrain[i] === T_WATER) m.fish[i] = 3;
    if (m.tree[i] && m.tree[i] < TREE_MATURE) { m.growing.add(i); m.treeT[i] = rng.range(0, TREE_STAGE_TIME); }
  }

  // Vertex heights for relief shading.
  const th = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = m.idx(x, y);
    const t = m.terrain[i];
    let h = elev[i] * 1.2;
    if (t === T_MOUNTAIN) h = 1.4 + fbm(x / 3, y / 3, seed + 900, 3) * 1.6;
    else if (t === T_WATER) h = 0.1;
    else h += fbm(x / 5, y / 5, seed + 901, 2) * 0.3;
    th[i] = h;
  }
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const tx = x + dx, ty = y + dy;
      if (m.inb(tx, ty)) { s += th[m.idx(tx, ty)]; n++; }
    }
    m.height[y * (W + 1) + x] = s / n;
  }
  m.starts = starts;
  return m;
}

function ensureConnected(m, a, b) {
  const W = m.W;
  const seen = new Uint8Array(m.N);
  const q = [m.idx(a.x, a.y)];
  seen[q[0]] = 1;
  const pass = i => m.terrain[i] !== T_WATER && !m.stone[i];
  while (q.length) {
    const i = q.pop();
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!m.inb(nx, ny)) continue;
      const j = m.idx(nx, ny);
      if (!seen[j] && pass(j)) { seen[j] = 1; q.push(j); }
    }
  }
  if (seen[m.idx(b.x, b.y)]) return;
  // Carve a wide sandy causeway along the diagonal.
  const steps = Math.ceil(dist(a.x, a.y, b.x, b.y));
  for (let s = 0; s <= steps; s++) {
    const cx = Math.round(lerp(a.x, b.x, s / steps)), cy = Math.round(lerp(a.y, b.y, s / steps));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!m.inb(cx + dx, cy + dy)) continue;
      const i = m.idx(cx + dx, cy + dy);
      if (m.terrain[i] === T_WATER) m.terrain[i] = T_SAND;
      m.stone[i] = 0;
    }
  }
}
