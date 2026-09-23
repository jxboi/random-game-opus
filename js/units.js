'use strict';
// ---------------------------------------------------------------------------
// Unit movement and citizen behaviour.
// ---------------------------------------------------------------------------

const HUNGRY = 0.35;
const CITIZEN_HUNGER = 1 / 700;   // condition lost per second
const SOLDIER_HUNGER = 1 / 1000;

Object.assign(World.prototype, {

  // Move one step toward the centre of tile idx. Returns true when there.
  stepToward(u, idx) {
    const W = this.map.W;
    const tx = (idx % W) + 0.5, ty = ((idx / W) | 0) + 0.5;
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    const sp = u.speed * this.map.speedFactor(this.unitTile(u)) * TICK;
    if (d <= sp) { u.x = tx; u.y = ty; return true; }
    u.x += (dx / d) * sp; u.y += (dy / d) * sp;
    u.dir = Math.atan2(dy, dx);
    u.moving = true;
    return false;
  },

  // Walk toward tile `goal`. Returns 1 when arrived, 0 while walking, -1 if unreachable.
  walkTo(u, goal, opts) {
    const m = this.map;
    const here = this.unitTile(u);
    if (u.goal !== goal || !u.path) {
      if (here === goal) return this.stepToward(u, goal) ? 1 : 0;
      const path = this.pf.find(here, goal, opts ? Object.assign({ owner: u.owner }, opts) : { owner: u.owner });
      if (!path) { u.path = null; u.goal = -1; return -1; }
      u.path = path; u.pi = 0; u.goal = goal; u.roadOnly = !!(opts && opts.roadOnly);
    }
    if (u.pi >= u.path.length) {
      if (this.stepToward(u, goal)) { u.path = null; return 1; }
      return 0;
    }
    const next = u.path[u.pi];
    if (next !== goal) {
      const ok = u.roadOnly ? (m.road[next] && m.roadOwner[next] === u.owner) : m.walkable(next);
      if (!ok) { u.path = null; u.goal = -1; return 0; } // re-plan next tick
    }
    if (this.stepToward(u, next)) u.pi++;
    return 0;
  },

  updateUnit(u) {
    u.px = u.x; u.py = u.y;
    u.moving = false;
    u.act = null;
    if (u.inside) { u.px = u.x; u.py = u.y; }
    if (u.kind === 'soldier') { this.updateSoldier(u); return; }
    this.hunger(u, CITIZEN_HUNGER);
    if (u.dead) return;
    const j = u.job;
    if (j && j.kind === 'eat') { this.doEat(u); return; }
    switch (u.type) {
      case 'serf': this.updateSerf(u); break;
      case 'laborer': this.updateLaborer(u); break;
      case 'recruit': this.updateRecruit(u); break;
      default: this.updateWorker(u); break;
    }
  },

  hunger(u, rate) {
    u.cond -= rate * TICK;
    if (u.cond <= 0) {
      u.cond = 0;
      u.hp -= 0.4 * TICK;
      if (u.hp <= 0) this.killUnit(u, null, 'starved');
    }
    if (u.cond < 0.15 && u.owner === 0) {
      const p = this.players[0];
      if (this.time - p.lastHungryAlert > 90) { p.lastHungryAlert = this.time; this.emit('hungry', { owner: 0, x: u.x, y: u.y }); }
    }
  },

  // Try to start an eating trip. Returns true if the unit is now heading to an inn.
  tryEat(u, force = false) {
    if ((!force && u.cond >= HUNGRY) || this.time < u.eatRetry) return false;
    let best = null, bd = 1e9;
    for (const b of this.buildings.values()) {
      if (b.owner !== u.owner || b.state !== 'done' || b.def.kind !== 'inn') continue;
      let food = 0;
      for (const g of FOOD_LIST) food += b.stock[g] || 0;
      if (!food) continue;
      const d = Math.abs(b.dx - u.x) + Math.abs(b.dy - u.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) { u.eatRetry = this.time + 20; return false; }
    u.job = { kind: 'eat', inn: best.id, phase: 0, t: 0, resume: u.job };
    u.path = null; u.goal = -1;
    return true;
  },

  doEat(u) {
    const j = u.job;
    const inn = this.buildings.get(j.inn);
    if (!inn) { u.inside = 0; u.job = null; return; }
    if (j.phase === 0) {
      const r = this.walkTo(u, inn.door);
      if (r === -1) { u.eatRetry = this.time + 20; u.job = null; return; }
      if (r === 1) { u.inside = inn.id; j.phase = 1; j.t = 0; }
      return;
    }
    j.t += TICK;
    if (j.t < 3.5) return;
    for (const g of FOOD_LIST) {
      while (u.cond < 0.9 && (inn.stock[g] || 0) > 0) { inn.stock[g]--; u.cond = Math.min(1, u.cond + FOODS[g]); }
    }
    if (u.cond < HUNGRY) u.eatRetry = this.time + 30;
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
    u.inside = 0;
    u.x = inn.dx + 0.5; u.y = inn.dy + 0.5;
    u.job = null; u.path = null; u.goal = -1;
    if (u.home) u.job = { kind: 'gohome' };
  },

  // Idle citizens drift to a spot near the nearest storehouse and loiter.
  wander(u) {
    u.idleT -= TICK;
    if (u.job && u.job.kind === 'wander') {
      const r = this.walkTo(u, u.job.to);
      if (r !== 0) u.job = null;
      return;
    }
    if (u.idleT > 0) return;
    u.idleT = 6 + this.rng.next() * 10;
    let best = null, bd = 1e9;
    for (const b of this.buildings.values()) {
      if (b.owner !== u.owner || b.state !== 'done' || b.def.kind !== 'store') continue;
      const d = Math.abs(b.dx - u.x) + Math.abs(b.dy - u.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return;
    const m = this.map;
    const near = bd < 7;
    if (near && this.rng.chance(0.6)) return;
    for (let k = 0; k < 8; k++) {
      const x = best.dx + this.rng.int(-4, 4), y = best.dy + this.rng.int(1, 5);
      if (!m.inb(x, y)) continue;
      const i = m.idx(x, y);
      if (m.walkable(i) && !m.road[i]) { u.job = { kind: 'wander', to: i }; u.path = null; u.goal = -1; return; }
    }
  },

  // ------------------------------------------------------------------ serf
  updateSerf(u) {
    const j = u.job;
    if (!j || j.kind === 'wander') {
      if (u.carry) { this.carryToStore(u); return; }
      if (this.tryEat(u)) return;
      this.wander(u);
      return;
    }
    if (j.kind === 'deliver') this.doDeliver(u);
    else if (j.kind === 'return') this.carryToStore(u);
    else u.job = null;
  },

  cancelDelivery(u) {
    const j = u.job;
    if (!j || j.kind !== 'deliver') return;
    if (j.phase === 0) {
      const from = this.buildings.get(j.from);
      if (from && from.outRes[j.g]) from.outRes[j.g]--;
    }
    const tb = this.buildings.get(j.toB);
    if (tb && tb.incoming[j.g]) tb.incoming[j.g]--;
    const cj = this.cjobs.get(j.toCj);
    if (cj && cj.stoneInc) cj.stoneInc--;
    u.job = null;
  },

  doDeliver(u) {
    const j = u.job;
    const tb = j.toB ? this.buildings.get(j.toB) : null;
    const cj = j.toCj ? this.cjobs.get(j.toCj) : null;
    const targetOk = j.toB ? !!tb : !!cj;
    if (j.phase === 0) {
      const from = this.buildings.get(j.from);
      if (!from || !targetOk) { this.cancelDelivery(u); return; }
      const r = this.walkTo(u, from.door);
      if (r === -1) { this.cancelDelivery(u); u.idleT = 3; return; }
      if (r === 1) {
        if ((from.stock[j.g] || 0) <= 0) { this.cancelDelivery(u); return; }
        from.stock[j.g]--;
        if (from.outRes[j.g]) from.outRes[j.g]--;
        u.carry = j.g;
        j.phase = 1; j.t = 0.4;
        u.path = null; u.goal = -1;
      }
      return;
    }
    if (j.t > 0) { j.t -= TICK; return; } // brief pause while lifting
    if (!targetOk) { u.job = null; this.carryToStore(u); return; }
    const goal = tb ? tb.door : cj.idx;
    const r = this.walkTo(u, goal, { roadOnly: true });
    if (r === -1) {
      this.cancelDelivery(u);
      this.carryToStore(u);
      return;
    }
    if (r === 1) {
      const g = j.g;
      if (tb) {
        if (tb.incoming[g]) tb.incoming[g]--;
        if (tb.state === 'site') tb.site.delivered[g] = (tb.site.delivered[g] || 0) + 1;
        else tb.stock[g] = (tb.stock[g] || 0) + 1;
      } else {
        cj.stoneInc--; cj.stone++;
      }
      u.carry = null;
      u.job = null;
      u.idleT = 1 + this.rng.next() * 2;
    }
  },

  // A serf holding goods with nowhere to go takes them to the nearest storehouse.
  carryToStore(u) {
    let best = null, bd = 1e9;
    for (const b of this.buildings.values()) {
      if (b.owner !== u.owner || b.state !== 'done' || b.def.kind !== 'store') continue;
      const d = Math.abs(b.dx - u.x) + Math.abs(b.dy - u.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) { u.carry = null; u.job = null; return; }
    if (!u.job || u.job.kind !== 'return' || u.job.to !== best.id) { u.job = { kind: 'return', to: best.id }; u.path = null; u.goal = -1; }
    const r = this.walkTo(u, best.door);
    if (r === -1) { u.carry = null; u.job = null; return; }
    if (r === 1) { best.stock[u.carry] = (best.stock[u.carry] || 0) + 1; u.carry = null; u.job = null; }
  },

  // --------------------------------------------------------------- laborer
  updateLaborer(u) {
    const j = u.job;
    if (!j || j.kind === 'wander') {
      if (this.tryEat(u)) return;
      this.wander(u);
      return;
    }
    const cj = this.cjobs.get(j.cj);
    if (!cj || cj.laborer !== u.id) { u.job = null; return; }
    const release = (retry) => { cj.laborer = 0; if (retry) cj.retryAt = this.time + retry; u.job = null; };
    if (cj.type === 'site') {
      const b = this.buildings.get(cj.bid);
      if (!b || b.state !== 'site') { u.job = null; return; }
      if (j.phase === 0) {
        const r = this.walkTo(u, b.door);
        if (r === -1) { release(15); return; }
        if (r === 1) j.phase = 1;
        return;
      }
      u.dir = -Math.PI / 2;
      if (b.site.level < 1) {
        b.site.level = Math.min(1, b.site.level + TICK / 8);
        u.act = 'dig';
        if (this.tickN % 8 === 0) this.effects.push({ kind: 'dust', x: b.x + this.rng.next() * b.w, y: b.y + b.h - this.rng.next() * b.h, t: 0, dur: 0.8 });
        return;
      }
      const avail = b.site.delivered.wood + b.site.delivered.stone - b.site.used;
      if (avail <= 0) { release(0); return; }
      u.act = 'hammer';
      j.t += TICK;
      if (j.t >= 2.2) {
        j.t = 0;
        b.site.used++;
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.7 / b.site.total);
        if (b.site.used >= b.site.total) { this.completeBuilding(b); u.job = null; }
      }
      return;
    }
    // road or field tile
    if (j.phase === 0) {
      const r = this.walkTo(u, cj.idx);
      if (r === -1) { release(15); return; }
      if (r === 1) { j.phase = 1; j.t = 0; }
      return;
    }
    const m = this.map;
    if (j.phase === 1) {
      u.act = 'dig';
      j.t += TICK;
      if (j.t >= (cj.type === 'road' ? 2.5 : 5)) { j.phase = 2; j.t = 0; }
      return;
    }
    if (cj.type === 'field') {
      this.cjobs.delete(cj.id);
      m.plan[cj.idx] = 0; m.planOwner[cj.idx] = -1; m.planJob[cj.idx] = 0;
      this.buildFieldNow(cj.owner, cj.idx, cj.fieldKind);
      u.job = null;
      return;
    }
    if (cj.stone < 1) {
      j.wait = (j.wait || 0) + TICK;
      if (j.wait > 25) release(5);
      return;
    }
    u.act = 'hammer';
    j.t += TICK;
    if (j.t >= 1.5) {
      this.cjobs.delete(cj.id);
      m.plan[cj.idx] = 0; m.planOwner[cj.idx] = -1; m.planJob[cj.idx] = 0;
      this.buildRoadNow(cj.owner, cj.idx);
      u.job = null;
    }
  },

  // --------------------------------------------------------------- recruit
  updateRecruit(u) {
    const j = u.job;
    if (!j || j.kind === 'wander') {
      if (this.tryEat(u)) return;
      this.wander(u);
      return;
    }
    if (j.kind === 'enlist') {
      const b = this.buildings.get(j.b);
      if (!b) { u.job = null; return; }
      const r = this.walkTo(u, b.door);
      if (r === -1) { u.job = null; u.idleT = 10; return; }
      if (r === 1) { b.recruits++; this.removeUnit(u); }
      return;
    }
    if (j.kind === 'gohome') {
      const b = this.buildings.get(u.home);
      if (!b) { u.home = 0; u.job = null; return; }
      const r = this.walkTo(u, b.door);
      if (r === -1) { b.guard = 0; u.home = 0; u.job = null; u.idleT = 10; return; }
      if (r === 1) { u.inside = b.id; u.job = { kind: 'guard' }; }
      return;
    }
    if (j.kind === 'guard') {
      const b = this.buildings.get(u.home);
      if (!b) { u.inside = 0; u.home = 0; u.job = null; return; }
      if (u.cond < 0.25 && this.tryEat(u)) { u.inside = 0; }
    }
  },

  // ---------------------------------------------------------------- workers
  updateWorker(u) {
    if (!u.home) {
      if (!u.job || u.job.kind === 'wander') { if (!this.tryEat(u)) this.wander(u); }
      return;
    }
    const b = this.buildings.get(u.home);
    if (!b) { u.home = 0; u.inside = 0; u.job = null; this.releaseReserve(u); return; }
    if (!u.job || u.job.kind === 'wander') u.job = { kind: 'gohome' };
    const j = u.job;
    if (j.kind === 'gohome') {
      const r = this.walkTo(u, b.door);
      if (r === -1) { j.retry = (j.retry || 0) + 1; u.path = null; if (j.retry > 3) { b.worker = 0; u.home = 0; u.job = null; u.idleT = 10; } return; }
      if (r === 1) {
        u.inside = b.id;
        if (u.carry) { this.depositOutput(b, u.carry); u.carry = null; }
        u.job = { kind: 'work', phase: 'inside', t: 1 + this.rng.next(), press: j.press ? 4 : 0 };
      }
      return;
    }
    if (j.kind === 'work') this.workerThink(u, b, j);
  },

  depositOutput(b, g) {
    if (g === 'grapes') return; // pressed into wine inside the vineyard
    b.stock[g] = (b.stock[g] || 0) + 1;
    const p = this.players[b.owner];
    p.stats.produced[g] = (p.stats.produced[g] || 0) + 1;
    if (b.owner === 0) this.emit('produced', { owner: 0, g, x: b.x + b.w / 2, y: b.y });
  },

  outputFull(b) {
    let n = 0;
    for (const g of b.def.outputs) n += b.stock[g] || 0;
    return n >= 6;
  },

  releaseReserve(u) {
    if (u.resTile != null && this.map.reserve[u.resTile] === u.id) this.map.reserve[u.resTile] = 0;
    u.resTile = null;
  },

  workerThink(u, b, j) {
    const def = b.def;
    // Leave to eat between work cycles.
    if (j.phase === 'inside' && !j.recipe && u.cond < HUNGRY && this.time >= u.eatRetry) {
      u.inside = 0; u.x = b.dx + 0.5; u.y = b.dy + 0.5;
      if (this.tryEat(u)) return;
      u.inside = b.id;
    }
    if (def.kind === 'convert' || def.kind === 'mine') { this.workConvert(u, b, j); return; }
    this.workOutdoor(u, b, j);
  },

  workConvert(u, b, j) {
    const def = b.def;
    if (j.recipe) {
      j.t += TICK;
      b.active = 1;
      if (j.t >= j.recipe.time) {
        for (const g in j.recipe.out) for (let k = 0; k < j.recipe.out[g]; k++) this.depositOutput(b, g);
        j.recipe = null;
        j.t = 0;
      }
      return;
    }
    j.t -= TICK;
    if (j.t > 0) return;
    j.t = 1;
    if (this.outputFull(b)) return;
    const n = def.recipes.length;
    for (let k = 0; k < n; k++) {
      const ri = (b.rr + k) % n;
      if (!b.orders[ri]) continue;
      const r = def.recipes[ri];
      let ok = true;
      for (const g in r.in) if ((b.stock[g] || 0) < r.in[g]) ok = false;
      if (!ok) continue;
      // Don't stockpile one item from a multi-recipe shop.
      if (n > 1) { const og = Object.keys(r.out)[0]; if ((b.stock[og] || 0) >= 3) continue; }
      for (const g in r.in) b.stock[g] -= r.in[g];
      b.rr = (ri + 1) % n;
      j.recipe = r; j.t = 0;
      return;
    }
  },

  // Gatherers and farmers: leave the building, work a tile, come back.
  workOutdoor(u, b, j) {
    const m = this.map, def = b.def, W = m.W;
    if (j.phase === 'inside') {
      if (j.press) { // vineyard pressing grapes into wine
        j.press -= TICK; b.active = 1;
        if (j.press <= 0) { j.press = 0; this.depositOutput(b, 'wine'); }
        return;
      }
      j.t -= TICK;
      if (j.t > 0) return;
      j.t = 2 + this.rng.next() * 2;
      if (this.outputFull(b)) return;
      const task = this.findOutdoorTask(u, b);
      if (!task) { j.t = 4; return; }
      m.reserve[task.tile] = u.id;
      u.resTile = task.tile;
      u.inside = 0; u.x = b.dx + 0.5; u.y = b.dy + 0.5; u.px = u.x; u.py = u.y;
      u.path = null; u.goal = -1;
      u.job = { kind: 'work', phase: 'out', task, t: 0 };
      return;
    }
    const task = j.task;
    if (j.phase === 'out') {
      const r = this.walkTo(u, task.stand);
      if (r === -1) { this.releaseReserve(u); u.job = { kind: 'gohome' }; return; }
      if (r === 1) { j.phase = 'labor'; j.t = 0; }
      return;
    }
    if (j.phase === 'labor') {
      const tx = task.tile % W + 0.5, ty = ((task.tile / W) | 0) + 0.5;
      if (task.tile !== task.stand) u.dir = Math.atan2(ty - u.y, tx - u.x);
      u.act = task.act;
      j.t += TICK;
      if (j.t < task.time) return;
      // Resolve the work.
      const i = task.tile;
      let carry = null;
      switch (task.kind) {
        case 'chop':
          if (m.tree[i] === TREE_MATURE) { m.tree[i] = 0; carry = 'trunk'; this.effects.push({ kind: 'fall', x: tx, y: ty, t: 0, dur: 1.2 }); }
          break;
        case 'plant':
          if (!m.tree[i] && m.clearForBuilding(i)) { m.tree[i] = 1; m.treeT[i] = 0; m.growing.add(i); }
          break;
        case 'mine':
          if (m.stone[i] > 0) { m.stone[i]--; carry = 'stone'; }
          break;
        case 'fish':
          if (m.fish[i] > 0 && this.rng.chance(0.85)) { m.fish[i]--; carry = 'fish'; }
          break;
        case 'sow':
          if (m.field[i] && m.fieldStage[i] === 0) { m.fieldStage[i] = 1; m.fieldT[i] = 0; this.fieldTiles.add(i); }
          break;
        case 'harvest':
          if (m.field[i] && m.fieldStage[i] === 2) {
            if (m.field[i] === 1) { m.fieldStage[i] = 0; carry = 'corn'; }
            else { m.fieldStage[i] = 1; m.fieldT[i] = 0; carry = 'grapes'; }
          }
          break;
      }
      this.releaseReserve(u);
      u.carry = carry;
      u.job = { kind: 'gohome', press: carry === 'grapes' };
      return;
    }
  },

  findOutdoorTask(u, b) {
    const m = this.map, def = b.def, W = m.W;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let best = null, bd = 1e9;
    const consider = (i, kind, stand, time, act, pri = 0) => {
      const x = i % W, y = (i / W) | 0;
      const d = Math.abs(x + 0.5 - b.dx - 0.5) + Math.abs(y + 0.5 - b.dy - 0.5) + pri;
      if (d < bd) { bd = d; best = { tile: i, kind, stand, time, act }; }
    };
    const adjStand = (i) => { // walkable neighbour closest to the door
      const x = i % W, y = (i / W) | 0;
      let s = -1, sd = 1e9;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!m.inb(nx, ny)) continue;
        const j = m.idx(nx, ny);
        if (!m.walkable(j)) continue;
        const d = Math.abs(nx - b.dx) + Math.abs(ny - b.dy);
        if (d < sd) { sd = d; s = j; }
      }
      return s;
    };
    const free = i => !m.reserve[i];
    switch (b.type) {
      case 'woodcutter': {
        let trees = 0;
        m.forRadius(cx, cy, def.radius, i => {
          if (m.tree[i]) trees++;
          if (m.tree[i] === TREE_MATURE && free(i)) consider(i, 'chop', i, 6, 'chop');
        });
        if (best) return best;
        if (trees > 28) return null;
        m.forRadius(cx, cy, def.radius - 1, (i, x, y) => {
          if (!free(i) || !m.canField(i)) return;
          // Leave the tile in front of doors and next to roads open.
          if (m.road[i + W] || (y > 0 && m.road[i - W]) || m.road[i + 1] || m.road[i - 1]) return;
          if (m.bld[i + W] || m.bld[i - W] || m.bld[i + 1] || m.bld[i - 1]) return;
          if (hash2(x, y, 3) < 0.4) return; // natural spacing
          consider(i, 'plant', i, 3, 'dig', 2);
        });
        return best;
      }
      case 'quarry':
        m.forRadius(cx, cy, def.radius, i => {
          if (m.stone[i] > 0 && free(i)) { const s = adjStand(i); if (s >= 0) consider(i, 'mine', s, 7, 'mine'); }
        });
        return best;
      case 'fisher':
        m.forRadius(cx, cy, def.radius, i => {
          if (m.terrain[i] === T_WATER && m.fish[i] > 0 && free(i)) { const s = adjStand(i); if (s >= 0) consider(i, 'fish', s, 8, 'fish'); }
        });
        return best;
      case 'farm':
      case 'vineyard': {
        const fk = def.field;
        m.forRadius(cx, cy, def.radius, i => {
          if (m.field[i] !== fk || m.fieldOwner[i] !== b.owner || !free(i)) return;
          if (m.fieldStage[i] === 2) consider(i, 'harvest', i, 5, 'dig', 0);
          else if (m.fieldStage[i] === 0) consider(i, 'sow', i, 4, 'dig', 1);
        });
        return best;
      }
    }
    return null;
  },

  // ------------------------------------------------------------- lifecycle
  removeUnit(u) {
    u.dead = true;
    this.releaseReserve(u);
    this.units.delete(u.id);
    const g = this.groups.get(u.group);
    if (g) g.members = g.members.filter(id => id !== u.id);
  },

  killUnit(u, killer, cause) {
    if (u.dead) return;
    if (u.job && u.job.kind === 'deliver') this.cancelDelivery(u);
    if (u.job && u.job.kind === 'build') { const cj = this.cjobs.get(u.job.cj); if (cj && cj.laborer === u.id) cj.laborer = 0; }
    const home = this.buildings.get(u.home);
    if (home) { if (home.worker === u.id) home.worker = 0; if (home.guard === u.id) home.guard = 0; }
    this.removeUnit(u);
    this.effects.push({ kind: 'corpse', x: u.x, y: u.y, owner: u.owner, soldier: u.kind === 'soldier', t: 0, dur: 25 });
    const p = this.players[u.owner];
    if (u.kind === 'soldier') p.stats.lost++;
    if (killer) this.players[killer.owner].stats.kills++;
    this.emit('death', { owner: u.owner, x: u.x, y: u.y, soldier: u.kind === 'soldier', cause: cause || 'battle' });
  },
});
