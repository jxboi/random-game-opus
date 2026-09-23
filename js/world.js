'use strict';
// ---------------------------------------------------------------------------
// World: owns the map, players, entities and the fixed-step simulation.
// Unit behaviour lives in units.js, buildings in buildings.js, combat in
// combat.js and the computer opponent in ai.js; they extend World.prototype.
// ---------------------------------------------------------------------------

class Player {
  constructor(id, isAI) {
    this.id = id;
    this.isAI = isAI;
    this.color = PLAYER_COLORS[id];
    this.name = isAI ? 'Enemy' : 'You';
    this.comp = null;
    this.compDirty = true;
    this.defeated = false;
    this.stats = { produced: {}, trained: 0, soldiers: 0, kills: 0, lost: 0, built: 0, buildingsLost: 0 };
    this.lastAttackAlert = -999;
    this.lastHungryAlert = -999;
    this.lastIdleAlert = -999;
  }
}

class World {
  constructor(opts = {}) {
    this.seed = opts.seed != null ? opts.seed : 1;
    this.difficulty = opts.difficulty || 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    this.map = generateMap(this.seed, opts.W || 96, opts.H || 96);
    this.pf = new PathFinder(this.map);
    this.players = [new Player(0, false), new Player(1, true)];
    for (const p of this.players) p.comp = new Int32Array(this.map.N);
    this.units = new Map();
    this.buildings = new Map();
    this.groups = new Map();
    this.cjobs = new Map();
    this.projectiles = [];
    this.effects = [];
    this.events = [];
    this.nextId = 1;
    this.time = 0;
    this.tickN = 0;
    this.rng = new RNG((this.seed ^ 0x5bd1e995) >>> 0);
    this.grid = new Map();
    this.over = null;         // { winner, reason } when the match ends
    this.fieldTiles = new Set();
    setupTowns(this, opts);
    this.ai = opts.noAI ? null : new AIController(this, this.players[1]);
  }

  newId() { return this.nextId++; }
  emit(type, data = {}) {
    data.type = type; data.t = this.time;
    this.events.push(data);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------------------------------------------------------------- stepping
  step() {
    if (this.over) return;
    this.time += TICK;
    this.tickN++;
    const tick = this.tickN;
    for (const p of this.players) if (p.compDirty) this.computeRoadComps(p);
    this.rebuildGrid();
    for (const u of this.units.values()) this.updateUnit(u);
    for (const b of this.buildings.values()) this.updateBuilding(b);
    for (const g of this.groups.values()) this.updateGroup(g);
    this.updateProjectiles();
    this.updateEffects();
    if (tick % 10 === 0) this.updateNature();
    if (tick % 5 === 0) for (const p of this.players) { this.runLogistics(p); this.runConstruction(p); }
    if (tick % 10 === 5) for (const p of this.players) this.runStaffing(p);
    if (tick % 10 === 3 && this.ai) this.ai.think();
    if (tick % 10 === 7) this.checkEnd();
  }

  // ---------------------------------------------------------------- units
  makeUnit(owner, type, x, y) {
    const isSoldier = !!SOLDIERS[type];
    const u = {
      id: this.newId(), owner, type, kind: isSoldier ? 'soldier' : 'citizen',
      x: x + 0.5, y: y + 0.5, px: x + 0.5, py: y + 0.5, dir: Math.PI / 2,
      speed: isSoldier ? SOLDIERS[type].speed : 2.0,
      hp: isSoldier ? SOLDIERS[type].hp : 30,
      maxHp: isSoldier ? SOLDIERS[type].hp : 30,
      cond: 0.7 + this.rng.next() * 0.3,
      path: null, pi: 0, goal: -1, moving: false,
      job: null, home: 0, inside: 0, carry: null,
      idleT: this.rng.next() * 5, eatRetry: 0, act: null,
      group: 0, target: 0, targetB: 0, cd: 0, slot: -1, chaseGoal: -1, chaseT: 0,
      lastAttacker: 0, lastHitT: -99, walkPhase: this.rng.next() * 6, dead: false,
    };
    this.units.set(u.id, u);
    return u;
  }
  unitTile(u) { return Math.floor(u.y) * this.map.W + Math.floor(u.x); }

  // ------------------------------------------------------------ placement
  footprint(def, x, y) {
    const out = [];
    for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) out.push(this.map.idx(x + dx, y + dy));
    return out;
  }
  doorOf(def, x, y) { return { x: x + Math.floor(def.w / 2), y: y + def.h }; }

  // Returns null when placement is allowed, otherwise a reason string.
  canPlace(owner, type, x, y) {
    const def = BUILDINGS[type], m = this.map;
    if (!def) return 'Unknown building';
    if (x < 1 || y < 1 || x + def.w > m.W - 1 || y + def.h > m.H - 2) return 'Too close to the edge';
    let oreOk = false;
    for (const i of this.footprint(def, x, y)) {
      if (def.kind === 'mine') {
        if (m.terrain[i] !== T_MOUNTAIN || m.bld[i] || m.road[i] || m.plan[i] || m.stone[i]) return 'Mines must sit on open mountain';
        if (m.ore[i] === def.ore) oreOk = true;
      } else if (!m.clearForBuilding(i)) {
        if (m.terrain[i] === T_WATER) return 'Cannot build on water';
        if (m.terrain[i] === T_MOUNTAIN) return 'Only mines go on mountains';
        if (m.tree[i]) return 'Trees are in the way';
        if (m.stone[i]) return 'Stone is in the way';
        return 'Blocked';
      }
    }
    if (def.kind === 'mine' && !oreOk) return 'No ' + ORE_NAMES[def.ore] + ' seam here';
    // Keep a walkable ring: no other building directly adjacent.
    for (let yy = y - 1; yy <= y + def.h; yy++) for (let xx = x - 1; xx <= x + def.w; xx++) {
      if (!m.inb(xx, yy)) continue;
      if (m.bld[m.idx(xx, yy)]) return 'Too close to another building';
    }
    const d = this.doorOf(def, x, y);
    const di = m.idx(d.x, d.y);
    const ownRoad = m.road[di] && m.roadOwner[di] === owner;
    const ownPlan = m.plan[di] === 1 && m.planOwner[di] === owner;
    if (!ownRoad && !ownPlan && !m.canRoad(di)) return 'Entrance is blocked';
    if (type === 'fisher' && !m.forRadius(x + 1, y + 1, def.radius, i => m.terrain[i] === T_WATER)) return 'No water nearby';
    if (type === 'quarry' && !m.forRadius(x + 1, y + 1, def.radius, i => m.stone[i] > 0)) return 'No stone nearby';
    return null;
  }

  placeBuilding(owner, type, x, y, prebuilt = false) {
    if (this.canPlace(owner, type, x, y)) return null;
    const def = BUILDINGS[type], m = this.map;
    const d = this.doorOf(def, x, y);
    const b = {
      id: this.newId(), type, def, owner, x, y, w: def.w, h: def.h,
      door: m.idx(d.x, d.y), dx: d.x, dy: d.y,
      state: prebuilt ? 'done' : 'site',
      hp: prebuilt ? def.hp : def.hp * 0.3, maxHp: def.hp,
      site: prebuilt ? null : { level: 0, delivered: { wood: 0, stone: 0 }, used: 0, total: (def.cost.wood || 0) + (def.cost.stone || 0), cj: 0 },
      stock: {}, incoming: {}, outRes: {},
      worker: 0, orders: def.recipes ? def.recipes.map(() => true) : [], rr: 0,
      queue: [], train: null, recruits: 0, guard: 0, cd: 0,
      blocked: {}, active: 0, lastHit: -99, placedAt: this.time,
    };
    for (const i of this.footprint(def, x, y)) m.bld[i] = b.id;
    this.buildings.set(b.id, b);
    if (prebuilt) {
      if (!(m.road[b.door] && m.roadOwner[b.door] === owner)) this.buildRoadNow(owner, b.door);
    } else {
      const cj = { id: this.newId(), owner, type: 'site', bid: b.id, idx: b.door, laborer: 0, created: this.time, retryAt: 0 };
      this.cjobs.set(cj.id, cj);
      b.site.cj = cj.id;
      if (!m.road[b.door] && !m.plan[b.door]) this.planTile(owner, d.x, d.y, 1);
    }
    // Shove any units standing on the footprint out of the way.
    for (const u of this.units.values()) {
      if (u.inside) continue;
      if (m.bld[this.unitTile(u)] === b.id) { u.x = d.x + 0.5; u.y = d.y + 0.5; u.path = null; u.goal = -1; }
    }
    if (!prebuilt) this.emit('placed', { owner, bid: b.id });
    return b;
  }

  // kind: 1 road, 2 corn field, 3 wine field
  planTile(owner, x, y, kind) {
    const m = this.map;
    if (!m.inb(x, y)) return false;
    const i = m.idx(x, y);
    if (kind === 1 ? !m.canRoad(i) : !m.canField(i)) return false;
    // Fields may not be laid directly on building entrances' neighbours of other players? keep it simple.
    m.plan[i] = kind; m.planOwner[i] = owner;
    const cj = { id: this.newId(), owner, type: kind === 1 ? 'road' : 'field', fieldKind: kind - 1, idx: i, laborer: 0, stone: 0, stoneInc: 0, created: this.time, retryAt: 0 };
    this.cjobs.set(cj.id, cj);
    m.planJob[i] = cj.id;
    return true;
  }

  // Road plans along an L-shaped line; returns number of tiles planned.
  planLine(owner, x0, y0, x1, y1, kind) {
    let n = 0;
    for (const [x, y] of lineTiles(x0, y0, x1, y1)) if (this.planTile(owner, x, y, kind)) n++;
    if (n) this.emit('planned', { owner, n });
    return n;
  }

  cancelPlan(i) {
    const m = this.map;
    const cj = this.cjobs.get(m.planJob[i]);
    if (cj) this.cjobs.delete(cj.id);
    m.plan[i] = 0; m.planOwner[i] = -1; m.planJob[i] = 0;
  }

  buildRoadNow(owner, i) {
    const m = this.map;
    if (m.plan[i]) this.cancelPlan(i);
    m.road[i] = 1; m.roadOwner[i] = owner; m.tree[i] = 0;
    m.growing.delete(i);
    this.players[owner].compDirty = true;
  }

  buildFieldNow(owner, i, kind) {
    const m = this.map;
    if (m.plan[i]) this.cancelPlan(i);
    m.field[i] = kind; m.fieldOwner[i] = owner; m.fieldStage[i] = 0; m.fieldT[i] = 0;
    this.fieldTiles.add(i);
  }

  // Player demolish tool. Returns a short description of what was removed, or null.
  demolish(owner, x, y) {
    const m = this.map;
    if (!m.inb(x, y)) return null;
    const i = m.idx(x, y);
    const b = this.buildings.get(m.bld[i]);
    if (b) {
      if (b.owner !== owner) return null;
      this.destroyBuilding(b, 'demolish');
      return b.def.name;
    }
    if (m.plan[i] && m.planOwner[i] === owner) { this.cancelPlan(i); return 'plan'; }
    if (m.road[i] && m.roadOwner[i] === owner) {
      m.road[i] = 0; m.roadOwner[i] = -1; this.players[owner].compDirty = true; return 'road';
    }
    if (m.field[i] && m.fieldOwner[i] === owner) {
      m.field[i] = 0; m.fieldOwner[i] = -1; m.fieldStage[i] = 0; this.fieldTiles.delete(i); return 'field';
    }
    return null;
  }

  destroyBuilding(b, cause) {
    if (!this.buildings.has(b.id)) return;
    const m = this.map;
    for (const i of this.footprint(b.def, b.x, b.y)) m.bld[i] = 0;
    this.buildings.delete(b.id);
    if (b.site && b.site.cj) {
      const cj = this.cjobs.get(b.site.cj);
      if (cj) this.cjobs.delete(cj.id);
    }
    for (const u of this.units.values()) {
      if (u.inside === b.id) { u.inside = 0; u.x = b.dx + 0.5; u.y = b.dy + 0.5; u.px = u.x; u.py = u.y; u.job = null; u.path = null; u.goal = -1; }
      if (u.home === b.id) { u.home = 0; u.job = null; this.releaseReserve(u); }
    }
    // Recruits waiting in the barracks walk back out.
    for (let k = 0; k < Math.min(b.recruits || 0, 12); k++) this.makeUnit(b.owner, 'recruit', b.dx, b.dy);
    this.effects.push({ kind: 'rubble', x: b.x, y: b.y, w: b.w, h: b.h, t: 0, dur: 40 });
    for (let k = 0; k < 10; k++) this.effects.push({ kind: 'dust', x: b.x + this.rng.next() * b.w, y: b.y + this.rng.next() * b.h, t: 0, dur: 1.2 + this.rng.next() });
    const p = this.players[b.owner];
    if (cause !== 'demolish') p.stats.buildingsLost++;
    this.emit('destroyed', { owner: b.owner, btype: b.type, x: b.x + b.w / 2, y: b.y + b.h / 2, cause });
  }

  completeBuilding(b) {
    b.state = 'done';
    b.hp = b.maxHp;
    const cj = b.site && this.cjobs.get(b.site.cj);
    if (cj) this.cjobs.delete(cj.id);
    b.site = null;
    this.players[b.owner].stats.built++;
    this.emit('completed', { owner: b.owner, bid: b.id, btype: b.type, x: b.x + b.w / 2, y: b.y + b.h / 2 });
  }

  // ------------------------------------------------------------- roads
  computeRoadComps(p) {
    const m = this.map, W = m.W, comp = p.comp;
    comp.fill(0);
    let c = 0;
    const stack = [];
    for (let i = 0; i < m.N; i++) {
      if (!m.road[i] || m.roadOwner[i] !== p.id || comp[i]) continue;
      c++;
      comp[i] = c; stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        const x = j % W, y = (j / W) | 0;
        if (x > 0) visit(j - 1);
        if (x < W - 1) visit(j + 1);
        if (y > 0) visit(j - W);
        if (y < m.H - 1) visit(j + W);
      }
    }
    function visit(k) { if (m.road[k] && m.roadOwner[k] === p.id && !comp[k]) { comp[k] = c; stack.push(k); } }
    p.compDirty = false;
  }

  // Road network components that can reach tile i (itself, or a neighbouring road).
  tileComps(p, i) {
    const m = this.map, W = m.W;
    if (m.road[i] && m.roadOwner[i] === p.id) return [p.comp[i]];
    const out = [];
    const x = i % W, y = (i / W) | 0;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < W - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - W);
    if (y < m.H - 1) nb.push(i + W);
    for (const j of nb) if (m.road[j] && m.roadOwner[j] === p.id && !m.bld[j] && out.indexOf(p.comp[j]) < 0) out.push(p.comp[j]);
    return out;
  }

  // --------------------------------------------------------- nature (1 Hz)
  updateNature() {
    const m = this.map;
    for (const i of m.growing) {
      m.treeT[i] += 1;
      if (m.treeT[i] >= TREE_STAGE_TIME) {
        m.treeT[i] = 0;
        m.tree[i]++;
        if (m.tree[i] >= TREE_MATURE) { m.tree[i] = TREE_MATURE; m.growing.delete(i); }
      }
    }
    for (const i of this.fieldTiles) {
      if (!m.field[i]) { this.fieldTiles.delete(i); continue; }
      if (m.fieldStage[i] === 1) {
        m.fieldT[i] += 1;
        if (m.fieldT[i] >= (m.field[i] === 1 ? FIELD_GROW_TIME : WINE_GROW_TIME)) m.fieldStage[i] = 2;
      }
    }
    if (this.tickN % 600 === 0) {
      for (let i = 0; i < m.N; i++) if (m.terrain[i] === T_WATER && m.fish[i] < 3 && this.rng.chance(0.5)) m.fish[i]++;
    }
  }

  // ------------------------------------------------------- spatial grid
  rebuildGrid() {
    const g = this.grid;
    for (const arr of g.values()) arr.length = 0;
    for (const u of this.units.values()) {
      if (u.inside) continue;
      const k = ((u.y >> 3) << 8) | (u.x >> 3);
      let arr = g.get(k);
      if (!arr) { arr = []; g.set(k, arr); }
      arr.push(u);
    }
  }
  // Nearest enemy unit of `owner` within r tiles of (x,y). soldiersFirst prefers armed targets.
  nearestEnemy(owner, x, y, r, soldiersFirst = true) {
    let best = null, bd = r * r, bestS = null, bsd = r * r;
    const x0 = Math.max(0, (x - r) >> 3), x1 = (x + r) >> 3, y0 = Math.max(0, (y - r) >> 3), y1 = (y + r) >> 3;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const arr = this.grid.get((cy << 8) | cx);
      if (!arr) continue;
      for (const u of arr) {
        if (u.owner === owner || u.dead || u.inside) continue;
        const d = (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
        if (d < bd) { bd = d; best = u; }
        if (u.kind === 'soldier' && d < bsd) { bsd = d; bestS = u; }
      }
    }
    return (soldiersFirst && bestS) ? bestS : best;
  }

  // ------------------------------------------------------- logistics
  // How many more of good g does building b want delivered?
  want(b, g) {
    const def = b.def;
    const have = (b.stock[g] || 0) + (b.incoming[g] || 0);
    if (b.state === 'site') {
      const need = (def.cost[g] || 0) - (b.site.delivered[g] || 0) - (b.incoming[g] || 0);
      return need;
    }
    switch (def.kind) {
      case 'convert': case 'mine': {
        let used = false;
        def.recipes.forEach((r, k) => { if (b.orders[k] && r.in[g]) used = true; });
        if (!used) return 0;
        return (g === 'corn' ? 6 : 5) - have;
      }
      case 'inn': return FOODS[g] ? 16 - have : 0;
      case 'school': return g === 'gold' ? 4 - have : 0;
      case 'barracks': return WARFARE.includes(g) ? 80 - have : 0;
      case 'tower': return g === 'stone' ? 5 - have : 0;
    }
    return 0;
  }
  isProducer(b) { const k = b.def.kind; return k === 'convert' || k === 'mine' || k === 'gather' || k === 'farm'; }

  runLogistics(p) {
    const serfs = [];
    for (const u of this.units.values())
      if (u.owner === p.id && u.type === 'serf' && !u.job && !u.inside && u.cond > 0.12) serfs.push(u);
    if (!serfs.length) return;
    const offers = [], demands = [];
    const m = this.map, W = m.W;
    for (const b of this.buildings.values()) {
      if (b.owner !== p.id) continue;
      const comps = this.tileComps(p, b.door);
      if (!comps.length) continue;
      if (b.state === 'done') {
        if (b.def.kind === 'store') {
          for (const g in b.stock) { const n = b.stock[g] - (b.outRes[g] || 0); if (n > 0) offers.push({ b, g, n, x: b.dx, y: b.dy, comps, store: true }); }
        } else if (this.isProducer(b)) {
          for (const g of b.def.outputs) { const n = (b.stock[g] || 0) - (b.outRes[g] || 0); if (n > 0) offers.push({ b, g, n, x: b.dx, y: b.dy, comps, store: false }); }
        }
      }
      const goods = b.state === 'site' ? ['wood', 'stone'] : b.def.inputs;
      if (b.state === 'site' && b.site.level < 1 && this.time - b.placedAt < 2) continue;
      for (const g of goods) {
        const n = this.want(b, g);
        if (n <= 0) continue;
        const k = b.def.kind;
        const prio = b.state === 'site' ? 0 : (k === 'school' || k === 'inn') ? 1 : k === 'barracks' ? 3 : 2;
        demands.push({ b, cj: null, g, n, x: b.dx, y: b.dy, comps, prio, order: b.id });
      }
    }
    for (const cj of this.cjobs.values()) {
      if (cj.owner !== p.id || cj.type !== 'road') continue;
      if (cj.stone + cj.stoneInc >= 1) continue;
      const comps = this.tileComps(p, cj.idx);
      if (!comps.length) continue;
      demands.push({ b: null, cj, g: 'stone', n: 1, x: cj.idx % W, y: (cj.idx / W) | 0, comps, prio: 0, order: cj.id });
    }
    demands.sort((a, b) => a.prio - b.prio || a.order - b.order);
    const inter = (a, b) => { for (const c of a) if (b.indexOf(c) >= 0) return true; return false; };
    const takeSerf = (x, y) => {
      let bi = -1, bd = 1e9;
      for (let k = 0; k < serfs.length; k++) {
        const s = serfs[k];
        const d = Math.abs(s.x - x) + Math.abs(s.y - y);
        if (d < bd) { bd = d; bi = k; }
      }
      return bi < 0 ? null : serfs.splice(bi, 1)[0];
    };
    let progress = true;
    while (serfs.length && progress) {
      progress = false;
      for (const d of demands) {
        if (!serfs.length) break;
        if (d.n <= 0) continue;
        let best = null, bd = 1e9;
        for (const o of offers) {
          if (o.g !== d.g || o.n <= 0 || o.b === d.b) continue;
          if (!inter(o.comps, d.comps)) continue;
          const dd = Math.abs(o.x - d.x) + Math.abs(o.y - d.y) + (o.store ? 4 : 0);
          if (dd < bd) { bd = dd; best = o; }
        }
        if (!best) continue;
        const s = takeSerf(best.x, best.y);
        this.assignDelivery(s, best.b, d.b, d.cj, d.g);
        best.n--; d.n--; progress = true;
      }
    }
    // Surplus production goes to the nearest storehouse that accepts it.
    if (!serfs.length) return;
    const stores = [];
    for (const b of this.buildings.values())
      if (b.owner === p.id && b.state === 'done' && b.def.kind === 'store') stores.push({ b, comps: this.tileComps(p, b.door) });
    for (const o of offers) {
      if (o.store) continue;
      while (o.n > 0 && serfs.length) {
        let best = null, bd = 1e9;
        for (const s of stores) {
          if (s.b.blocked[o.g] || !inter(s.comps, o.comps)) continue;
          const dd = Math.abs(s.b.dx - o.x) + Math.abs(s.b.dy - o.y);
          if (dd < bd) { bd = dd; best = s.b; }
        }
        if (!best) break;
        this.assignDelivery(takeSerf(o.x, o.y), o.b, best, null, o.g);
        o.n--;
      }
    }
  }

  assignDelivery(serf, from, toB, toCj, g) {
    from.outRes[g] = (from.outRes[g] || 0) + 1;
    if (toB) toB.incoming[g] = (toB.incoming[g] || 0) + 1;
    if (toCj) toCj.stoneInc++;
    serf.job = { kind: 'deliver', from: from.id, toB: toB ? toB.id : 0, toCj: toCj ? toCj.id : 0, g, phase: 0, t: 0 };
    serf.path = null; serf.goal = -1;
  }

  // ------------------------------------------------ construction workers
  siteNeedsLaborer(cj) {
    if (cj.laborer || cj.retryAt > this.time) return false;
    if (cj.type === 'field') return true;
    if (cj.type === 'road') return cj.stone + cj.stoneInc >= 1;
    const b = this.buildings.get(cj.bid);
    if (!b || b.state !== 'site') return false;
    if (b.site.level < 1) return true;
    return (b.site.delivered.wood + b.site.delivered.stone) > b.site.used;
  }

  runConstruction(p) {
    const labs = [];
    for (const u of this.units.values())
      if (u.owner === p.id && u.type === 'laborer' && !u.job && !u.inside && u.cond > 0.12) labs.push(u);
    if (!labs.length) return;
    const W = this.map.W;
    const jobs = [];
    for (const cj of this.cjobs.values()) if (cj.owner === p.id && this.siteNeedsLaborer(cj)) jobs.push(cj);
    // Sites and roads before fields; otherwise first come first served.
    jobs.sort((a, b) => (a.type === 'field') - (b.type === 'field') || a.id - b.id);
    for (const cj of jobs) {
      if (!labs.length) break;
      const x = cj.idx % W, y = (cj.idx / W) | 0;
      let bi = 0, bd = 1e9;
      labs.forEach((u, k) => { const d = Math.abs(u.x - x) + Math.abs(u.y - y); if (d < bd) { bd = d; bi = k; } });
      const u = labs.splice(bi, 1)[0];
      cj.laborer = u.id;
      u.job = { kind: 'build', cj: cj.id, phase: 0, t: 0 };
      u.path = null; u.goal = -1;
    }
  }

  // ------------------------------------ workers, recruits and tower guards
  runStaffing(p) {
    const idle = {};
    for (const u of this.units.values()) {
      if (u.owner !== p.id || u.kind !== 'citizen' || u.home || u.inside) continue;
      if (u.job && u.job.kind !== 'wander') continue;
      if (u.type === 'serf' || u.type === 'laborer') continue;
      (idle[u.type] = idle[u.type] || []).push(u);
    }
    let barracks = null;
    for (const b of this.buildings.values()) {
      if (b.owner !== p.id || b.state !== 'done') continue;
      if (b.def.kind === 'barracks' && !barracks) barracks = b;
      let want = null;
      if (b.def.worker && !b.worker) want = b.def.worker;
      else if (b.def.kind === 'tower' && !b.guard) want = 'recruit';
      if (!want || !idle[want] || !idle[want].length) continue;
      const list = idle[want];
      let bi = 0, bd = 1e9;
      list.forEach((u, k) => { const d = Math.abs(u.x - b.dx) + Math.abs(u.y - b.dy); if (d < bd) { bd = d; bi = k; } });
      const u = list.splice(bi, 1)[0];
      u.home = b.id;
      if (want === 'recruit') b.guard = u.id; else b.worker = u.id;
      u.job = { kind: 'gohome' }; u.path = null; u.goal = -1;
    }
    if (barracks && idle.recruit) for (const u of idle.recruit) {
      u.job = { kind: 'enlist', b: barracks.id }; u.path = null; u.goal = -1;
    }
  }

  // ------------------------------------------------------- end of match
  checkEnd() {
    for (const p of this.players) {
      if (p.defeated) continue;
      let soldiers = 0, key = 0;
      for (const u of this.units.values()) if (u.owner === p.id && u.kind === 'soldier') { soldiers++; break; }
      for (const b of this.buildings.values()) {
        if (b.owner === p.id && b.state === 'done' && (b.def.kind === 'store' || b.def.kind === 'school' || b.def.kind === 'barracks')) { key++; break; }
      }
      if (!soldiers && !key) p.defeated = true;
    }
    const alive = this.players.filter(p => !p.defeated);
    if (alive.length <= 1) {
      const winner = alive.length ? alive[0].id : -1;
      this.over = { winner, time: this.time };
      this.emit(winner === 0 ? 'victory' : 'defeat', {});
    }
  }

  // Aggregate stock in all of a player's storehouses.
  stockTotals(owner) {
    const tot = {};
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || b.state !== 'done' || b.def.kind !== 'store') continue;
      for (const g in b.stock) tot[g] = (tot[g] || 0) + b.stock[g];
    }
    return tot;
  }
  countUnits(owner) {
    const c = {};
    for (const u of this.units.values()) if (u.owner === owner) c[u.type] = (c[u.type] || 0) + 1;
    return c;
  }
}

// L-shaped 4-connected tile line (horizontal leg first unless mostly vertical).
function lineTiles(x0, y0, x1, y1) {
  const out = [];
  const hFirst = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  let x = x0, y = y0;
  out.push([x, y]);
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  if (hFirst) { while (x !== x1) { x += sx; out.push([x, y]); } while (y !== y1) { y += sy; out.push([x, y]); } }
  else { while (y !== y1) { y += sy; out.push([x, y]); } while (x !== x1) { x += sx; out.push([x, y]); } }
  return out;
}
