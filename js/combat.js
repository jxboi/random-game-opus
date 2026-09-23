'use strict';
// ---------------------------------------------------------------------------
// Soldiers, groups, formations, projectiles and damage.
// ---------------------------------------------------------------------------

const DIR8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function snapDir(dx, dy) {
  if (!dx && !dy) return [0, 1];
  const a = Math.atan2(dy, dx);
  const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return DIR8[k];
}

Object.assign(World.prototype, {
  newGroup(owner, type, x, y) {
    const g = {
      id: this.newId(), owner, type, members: [], cols: 0, fx: 0, fy: 1,
      ax: x, ay: y, order: { kind: 'idle' }, rally: 0, offensive: false, home: null,
    };
    this.groups.set(g.id, g);
    return g;
  },

  addToGroup(g, u) {
    u.group = g.id;
    g.members.push(u.id);
  },

  joinRally(u, barracks) {
    const cap = this.players[u.owner].isAI ? 12 : 9;
    let g = null;
    for (const gg of this.groups.values()) {
      if (gg.rally === barracks.id && gg.type === u.type && gg.members.length < cap && gg.order.kind === 'idle') { g = gg; break; }
    }
    if (!g) {
      g = this.newGroup(u.owner, u.type, barracks.dx + 0.5, barracks.dy + 3.5);
      g.rally = barracks.id;
      // Spread rally points for different troop types.
      const k = SOLDIER_LIST.indexOf(u.type);
      g.ax += ((k % 3) - 1) * 4;
      g.ay += Math.floor(k / 3) * 2;
      if (!this.map.walkable(this.map.idx(Math.floor(g.ax), Math.floor(g.ay)))) { g.ax = barracks.dx + 0.5; g.ay = barracks.dy + 2.5; }
    }
    this.addToGroup(g, u);
    this.assignSlots(g);
  },

  groupCenter(g) {
    let sx = 0, sy = 0, n = 0;
    for (const id of g.members) { const u = this.units.get(id); if (u) { sx += u.x; sy += u.y; n++; } }
    return n ? { x: sx / n, y: sy / n } : { x: g.ax, y: g.ay };
  },

  groupLeader(g) {
    for (const id of g.members) { const u = this.units.get(id); if (u) return u; }
    return null;
  },

  // Compute formation slot tiles around the anchor, facing (fx,fy).
  assignSlots(g) {
    const m = this.map;
    const n = g.members.length;
    if (!n) return;
    const cols = g.cols > 0 ? Math.min(g.cols, n) : Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 2))));
    g.colsUsed = cols;
    const fx = g.fx, fy = g.fy;
    const len = Math.hypot(fx, fy) || 1;
    const Fx = fx / len, Fy = fy / len, Lx = -Fy, Ly = Fx;
    const spacing = fx && fy ? 1.2 : 1;
    const used = new Set();
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / cols), col = k % cols;
      const inRow = Math.min(cols, n - row * cols);
      const lat = (col - (inRow - 1) / 2) * spacing;
      const px = g.ax + Lx * lat - Fx * row * spacing;
      const py = g.ay + Ly * lat - Fy * row * spacing;
      let tx = clamp(Math.floor(px), 0, m.W - 1), ty = clamp(Math.floor(py), 0, m.H - 1);
      let slot = -1;
      for (let r = 0; r <= 4 && slot < 0; r++) {
        for (let dy = -r; dy <= r && slot < 0; dy++) for (let dx = -r; dx <= r && slot < 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (!m.inb(x, y)) continue;
          const i = m.idx(x, y);
          if (m.walkable(i) && !used.has(i)) slot = i;
        }
      }
      if (slot < 0) slot = m.idx(tx, ty);
      used.add(slot);
      const u = this.units.get(g.members[k]);
      if (u) { u.slot = slot; u.path = null; u.goal = -1; }
    }
  },

  updateGroup(g) {
    g.members = g.members.filter(id => this.units.has(id));
    if (!g.members.length) { this.groups.delete(g.id); return; }
    const o = g.order;
    if (o.kind === 'attack') {
      const t = this.units.get(o.unit);
      if (!t || t.dead) this.groupSettle(g);
    } else if (o.kind === 'attackB') {
      if (!this.buildings.has(o.b)) this.groupSettle(g);
    } else if (o.kind === 'move') {
      let done = true;
      for (const id of g.members) {
        const u = this.units.get(id);
        if (u.target || this.unitTile(u) !== u.slot) { done = false; break; }
      }
      if (done) g.order = { kind: 'idle' };
    }
  },

  // After a fight, regroup where the group now stands.
  groupSettle(g) {
    const c = this.groupCenter(g);
    g.order = { kind: 'idle' };
    g.ax = c.x; g.ay = c.y;
    this.assignSlots(g);
  },

  updateSoldier(u) {
    const def = SOLDIERS[u.type];
    this.hunger(u, SOLDIER_HUNGER);
    if (u.dead) return;
    u.cd -= TICK;
    const g = this.groups.get(u.group);
    if (!g) { const ng = this.newGroup(u.owner, u.type, u.x, u.y); this.addToGroup(ng, u); this.assignSlots(ng); return; }
    if (u.job && u.job.kind === 'eat') { this.doEat(u); return; }

    let t = u.target ? this.units.get(u.target) : null;
    if (t && (t.dead || t.inside)) t = null;
    let tb = u.targetB ? this.buildings.get(u.targetB) : null;

    // Leash: don't chase far from the formation when merely defending.
    if (t && g.order.kind === 'idle' && u.slot >= 0) {
      const sx = u.slot % this.map.W, sy = (u.slot / this.map.W) | 0;
      if (dist(t.x, t.y, sx, sy) > 14) t = null;
    }

    if (!t) {
      const o = g.order;
      const aggro = def.ranged ? def.range + 1 : 6;
      if (o.kind === 'attack') {
        const gt = this.units.get(o.unit);
        if (gt) t = this.nearestEnemy(u.owner, gt.x, gt.y, 5) || gt;
      } else if (o.kind === 'attackB') {
        t = this.nearestEnemy(u.owner, u.x, u.y, aggro);
        if (!t) tb = this.buildings.get(o.b) || null;
      } else if (o.kind === 'idle') {
        t = this.nearestEnemy(u.owner, u.x, u.y, aggro);
      }
      // Always hit back when struck.
      if (!t && u.lastAttacker && this.time - u.lastHitT < 3) {
        const a = this.units.get(u.lastAttacker);
        if (a && !a.dead && !a.inside && dist(a.x, a.y, u.x, u.y) < 9) t = a;
      }
      // Group mates join a fight a neighbour is already in.
      if (!t && o.kind === 'idle') {
        for (const id of g.members) {
          const m2 = this.units.get(id);
          if (m2 && m2.target && m2 !== u) { const mt = this.units.get(m2.target); if (mt && dist(mt.x, mt.y, u.x, u.y) < 10) { t = mt; break; } }
        }
      }
    }
    u.target = t ? t.id : 0;
    if (t) { u.targetB = 0; this.fight(u, t, def); return; }
    u.targetB = tb ? tb.id : 0;
    if (tb) { this.siege(u, tb, def); return; }

    if (g.order.kind === 'idle' && u.cond < 0.25 && this.tryEat(u)) return;
    if (u.slot >= 0 && this.unitTile(u) !== u.slot) {
      const r = this.walkTo(u, u.slot);
      if (r === -1) u.slot = this.unitTile(u);
    } else if (u.slot >= 0) {
      this.stepToward(u, u.slot);
      if (!u.moving) u.dir = Math.atan2(g.fy, g.fx);
    }
  },

  fight(u, t, def) {
    const d = dist(u.x, u.y, t.x, t.y);
    if (d <= def.range) {
      u.dir = Math.atan2(t.y - u.y, t.x - u.x);
      u.path = null; u.goal = -1;
      u.act = def.ranged ? 'shoot' : 'fight';
      if (u.cd <= 0) {
        u.cd = def.cd * (0.9 + this.rng.next() * 0.2);
        if (def.ranged) this.shoot({ owner: u.owner, x: u.x, y: u.y - 0.4, kind: def.ranged, dmg: def.atk, target: t, attacker: u });
        else this.damageUnit(u, t, def.atk);
        u.swing = 0.25;
      }
      return;
    }
    // Close in. Re-plan toward the target's tile at most ~twice a second.
    u.chaseT -= TICK;
    const tt = this.unitTile(t);
    if (u.chaseT <= 0 || u.chaseGoal < 0) { u.chaseGoal = tt; u.chaseT = 0.6; }
    const r = this.walkTo(u, u.chaseGoal);
    if (r === 1) u.chaseGoal = tt;
    if (r === -1) { u.target = 0; u.chaseGoal = -1; }
  },

  siege(u, b, def) {
    // Distance from unit to the building rectangle.
    const nx = clamp(u.x, b.x, b.x + b.w), ny = clamp(u.y, b.y, b.y + b.h);
    const d = dist(u.x, u.y, nx, ny);
    if (d <= (def.ranged ? def.range - 0.5 : 1.0)) {
      u.dir = Math.atan2(ny - u.y, nx - u.x);
      u.path = null; u.goal = -1;
      u.act = def.ranged ? 'shoot' : 'fight';
      if (u.cd <= 0) {
        u.cd = def.cd * 1.1;
        if (def.ranged) this.shoot({ owner: u.owner, x: u.x, y: u.y - 0.4, kind: def.ranged, dmg: def.atk * 0.5, targetB: b, attacker: u });
        else this.damageBuilding(u, b, def.atk * 0.7);
        u.swing = 0.25;
      }
      return;
    }
    if (u.siegeB !== b.id || u.siegeTile == null) {
      const m = this.map, W = m.W;
      const adj = i => {
        const x = i % W, y = (i / W) | 0;
        return x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h && !m.bld[i];
      };
      const path = this.pf.find(this.unitTile(u), -1, { goalFn: adj, hx: b.x + b.w / 2, hy: b.y + b.h / 2, owner: u.owner });
      u.siegeB = b.id;
      u.siegeTile = path && path.length ? path[path.length - 1] : this.unitTile(u);
      u.path = path; u.pi = 0; u.goal = u.siegeTile;
      if (!path) { u.targetB = 0; return; }
    }
    const r = this.walkTo(u, u.siegeTile);
    if (r !== 0) u.siegeTile = null;
  },

  damageUnit(att, t, base) {
    let dmg = base * (0.8 + this.rng.next() * 0.4);
    const ad = att && SOLDIERS[att.type];
    if (ad && ad.bonusMounted && SOLDIERS[t.type] && SOLDIERS[t.type].mounted) dmg *= ad.bonusMounted;
    if (SOLDIERS[t.type]) dmg *= 1 - SOLDIERS[t.type].arm;
    t.hp -= dmg;
    if (att) { t.lastAttacker = att.id; }
    t.lastHitT = this.time;
    this.effects.push({ kind: 'spark', x: t.x + (this.rng.next() - 0.5) * 0.3, y: t.y - 0.3, t: 0, dur: 0.35 });
    this.emit('hit', { owner: t.owner, x: t.x, y: t.y, melee: !!(ad && !ad.ranged) });
    this.alertAttack(t.owner, t.x, t.y);
    if (t.hp <= 0) this.killUnit(t, att);
  },

  damageBuilding(att, b, dmg) {
    b.hp -= dmg;
    b.lastHit = this.time;
    this.effects.push({ kind: 'dust', x: b.x + this.rng.next() * b.w, y: b.y + b.h * this.rng.next(), t: 0, dur: 0.8 });
    this.emit('hitb', { owner: b.owner, x: b.x + b.w / 2, y: b.y + b.h / 2 });
    this.alertAttack(b.owner, b.x + b.w / 2, b.y + b.h / 2);
    if (b.hp <= 0) this.destroyBuilding(b, 'battle');
  },

  alertAttack(owner, x, y) {
    const p = this.players[owner];
    if (this.time - p.lastAttackAlert > 25) {
      p.lastAttackAlert = this.time;
      this.emit('attacked', { owner, x, y });
    }
    if (p.isAI && this.ai) this.ai.onAttacked(x, y);
  },

  shoot(o) {
    const t = o.target, b = o.targetB;
    const tx = t ? t.x : clamp(o.x, b.x, b.x + b.w), ty = t ? t.y - 0.3 : clamp(o.y, b.y, b.y + b.h);
    const d = dist(o.x, o.y, tx, ty);
    const speed = o.kind === 'stone' ? 9 : 14;
    this.projectiles.push({
      kind: o.kind, owner: o.owner, x0: o.x, y0: o.y, x1: tx, y1: ty, t: 0, dur: Math.max(0.15, d / speed),
      target: t ? t.id : 0, targetB: b ? b.id : 0, dmg: o.dmg, attacker: o.attacker ? o.attacker.id : 0,
    });
    this.emit('shoot', { owner: o.owner, kind: o.kind, x: o.x, y: o.y });
  },

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      p.t += TICK;
      const t = p.target ? this.units.get(p.target) : null;
      if (t) { p.x1 = t.x; p.y1 = t.y - 0.3; } // light homing keeps arrows honest
      if (p.t < p.dur) { keep.push(p); continue; }
      const att = this.units.get(p.attacker) || null;
      if (t && !t.dead && !t.inside) {
        if (this.rng.chance(t.moving ? 0.7 : 0.9)) this.damageUnit(att || { owner: p.owner, type: 'tower', id: 0 }, t, p.dmg);
      } else if (p.targetB) {
        const b = this.buildings.get(p.targetB);
        if (b) this.damageBuilding(att, b, p.dmg);
      }
    }
    this.projectiles = keep;
  },

  updateEffects() {
    if (!this.effects.length) return;
    const keep = [];
    for (const e of this.effects) { e.t += TICK; if (e.t < e.dur) keep.push(e); }
    this.effects = keep;
  },

  // ------------------------------------------------------------ commands
  cmdMove(gid, tx, ty) {
    const g = this.groups.get(gid);
    if (!g || !g.members.length) return;
    const c = this.groupCenter(g);
    const [fx, fy] = snapDir(tx + 0.5 - c.x, ty + 0.5 - c.y);
    if (dist(c.x, c.y, tx + 0.5, ty + 0.5) > 1.5) { g.fx = fx; g.fy = fy; }
    g.ax = tx + 0.5; g.ay = ty + 0.5;
    g.order = { kind: 'move' };
    g.rally = 0;
    for (const id of g.members) { const u = this.units.get(id); if (u) { u.target = 0; u.targetB = 0; u.lastAttacker = 0; } }
    this.assignSlots(g);
  },
  cmdAttack(gid, uid) {
    const g = this.groups.get(gid), t = this.units.get(uid);
    if (!g || !t || t.owner === g.owner) return;
    g.order = { kind: 'attack', unit: uid };
    g.rally = 0;
    for (const id of g.members) { const u = this.units.get(id); if (u) u.target = 0; }
  },
  cmdAttackBuilding(gid, bid) {
    const g = this.groups.get(gid), b = this.buildings.get(bid);
    if (!g || !b || b.owner === g.owner) return;
    g.order = { kind: 'attackB', b: bid };
    g.rally = 0;
    for (const id of g.members) { const u = this.units.get(id); if (u) { u.target = 0; u.siegeTile = null; } }
  },
  cmdHalt(gid) {
    const g = this.groups.get(gid);
    if (!g) return;
    for (const id of g.members) { const u = this.units.get(id); if (u) { u.target = 0; u.targetB = 0; } }
    this.groupSettle(g);
  },
  cmdTurn(gid, dirDelta) {
    const g = this.groups.get(gid);
    if (!g) return;
    let k = DIR8.findIndex(d => d[0] === g.fx && d[1] === g.fy);
    if (k < 0) k = 2;
    k = (k + dirDelta + 8) % 8;
    g.fx = DIR8[k][0]; g.fy = DIR8[k][1];
    this.assignSlots(g);
  },
  cmdFormation(gid, delta) {
    const g = this.groups.get(gid);
    if (!g) return;
    const cur = g.colsUsed || g.cols || 3;
    g.cols = clamp(cur + delta, 1, Math.max(1, g.members.length));
    this.assignSlots(g);
  },
  cmdSplit(gid) {
    const g = this.groups.get(gid);
    if (!g || g.members.length < 2) return null;
    const half = g.members.splice(Math.ceil(g.members.length / 2));
    const [Lx, Ly] = [-g.fy, g.fx];
    const ng = this.newGroup(g.owner, g.type, g.ax + Lx * 3, g.ay + Ly * 3);
    ng.fx = g.fx; ng.fy = g.fy; ng.cols = g.cols;
    for (const id of half) { const u = this.units.get(id); if (u) this.addToGroup(ng, u); }
    g.rally = 0;
    this.assignSlots(g); this.assignSlots(ng);
    return ng;
  },
  cmdJoin(gid, intoId) {
    const g = this.groups.get(gid), into = this.groups.get(intoId);
    if (!g || !into || g === into || g.owner !== into.owner) return;
    for (const id of g.members) { const u = this.units.get(id); if (u) this.addToGroup(into, u); }
    g.members = [];
    this.groups.delete(g.id);
    into.rally = 0;
    this.assignSlots(into);
  },
  cmdFeed(gid) {
    const g = this.groups.get(gid);
    if (!g) return;
    for (const id of g.members) { const u = this.units.get(id); if (u && u.cond < 0.9 && !u.job) { u.eatRetry = 0; this.tryEat(u, true); } }
  },
});
