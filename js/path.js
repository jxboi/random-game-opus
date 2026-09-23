'use strict';
// ---------------------------------------------------------------------------
// A* pathfinding on the tile grid.
//   General movement: 8-directional, no corner cutting, roads are cheap.
//   Road-only movement (serfs carrying goods): 4-directional over the owner's
//   roads, but the start and goal tiles may be off-road.
// ---------------------------------------------------------------------------

const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

class PathFinder {
  constructor(map) {
    this.map = map;
    const N = map.N;
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 0;
    this.heap = new MinHeap(4096);
    this.expanded = 0; // stats
  }

  // start, goal: tile indices. opts: { roadOnly, owner, goalFn, hx, hy, maxNodes }
  // Returns an array of tile indices from the first step to the goal (excluding start), or null.
  find(start, goal, opts = {}) {
    const m = this.map, W = m.W;
    if (start === goal && !opts.goalFn) return [];
    const goalFn = opts.goalFn || null;
    if (goalFn && goalFn(start)) return [];
    const roadOnly = !!opts.roadOnly, owner = opts.owner;
    const maxNodes = opts.maxNodes || 14000;
    const hx = goalFn ? opts.hx : goal % W, hy = goalFn ? opts.hy : (goal / W) | 0;
    const gen = ++this.gen;
    const g = this.g, from = this.from, seen = this.seen, closed = this.closed, heap = this.heap;
    heap.clear();
    seen[start] = gen; g[start] = 0; from[start] = -1;
    heap.push(start, 0);
    const passable = i => {
      if (i === goal) return m.terrain[i] !== T_WATER;
      if (roadOnly) return m.road[i] === 1 && m.roadOwner[i] === owner && m.bld[i] === 0;
      return m.walkable(i);
    };
    const hmul = roadOnly ? 1 : 0.75;
    let found = -1, nodes = 0;
    while (heap.n > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (goalFn ? goalFn(cur) : cur === goal) { found = cur; break; }
      if (++nodes > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const nd = roadOnly ? 4 : 8;
      for (let d = 0; d < nd; d++) {
        const dx = DIRS8[d][0], dy = DIRS8[d][1];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.H) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        const isGoal = goalFn ? false : ni === goal;
        if (!isGoal && !passable(ni)) {
          if (!(goalFn && m.terrain[ni] !== T_WATER && goalFn(ni) && m.walkable(ni))) continue;
        }
        if (dx && dy) { // no corner cutting
          if (!m.walkable(cy * W + nx) || !m.walkable(ny * W + cx)) continue;
        }
        const ng = g[cur] + DIRS8[d][2] * (roadOnly ? 1 : m.cost(ni, owner));
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; from[ni] = cur;
          const ddx = Math.abs(nx - hx), ddy = Math.abs(ny - hy);
          const h = (ddx + ddy + (1.414 - 2) * Math.min(ddx, ddy)) * hmul;
          heap.push(ni, ng + h);
        }
      }
    }
    this.expanded += nodes;
    if (found < 0) return null;
    const path = [];
    for (let c = found; c !== start; c = from[c]) path.push(c);
    path.reverse();
    return path;
  }
}
