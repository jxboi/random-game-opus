'use strict';
// ---------------------------------------------------------------------------
// Per-building updates: school, barracks, watchtower. Production buildings
// are driven by their worker (units.js).
// ---------------------------------------------------------------------------

const SCHOOL_TIME = 10;
const BARRACKS_TIME = 2;
const QUEUE_MAX = 6;

Object.assign(World.prototype, {
  updateBuilding(b) {
    if (b.active > 0) b.active = Math.max(0, b.active - TICK * 0.5);
    if (b.state !== 'done') return;
    switch (b.def.kind) {
      case 'school': this.updateSchool(b); break;
      case 'barracks': this.updateBarracks(b); break;
      case 'tower': this.updateTower(b); break;
    }
  },

  updateSchool(b) {
    if (!b.train) {
      if (!b.queue.length || (b.stock.gold || 0) < 1) return;
      b.stock.gold--;
      b.train = { type: b.queue.shift(), t: 0 };
    }
    b.train.t += TICK;
    b.active = 1;
    if (b.train.t >= SCHOOL_TIME) {
      const u = this.makeUnit(b.owner, b.train.type, b.dx, b.dy);
      u.cond = 0.9;
      u.idleT = 0;
      this.players[b.owner].stats.trained++;
      this.emit('trained', { owner: b.owner, utype: b.train.type, x: b.dx, y: b.dy });
      b.train = null;
    }
  },

  canEquip(b, stype) {
    if (b.recruits < 1) return false;
    for (const g of SOLDIERS[stype].needs) if ((b.stock[g] || 0) < 1) return false;
    return true;
  },

  updateBarracks(b) {
    if (!b.train) {
      if (!b.queue.length) return;
      const st = b.queue[0];
      if (!this.canEquip(b, st)) return;
      b.queue.shift();
      b.recruits--;
      for (const g of SOLDIERS[st].needs) b.stock[g]--;
      b.train = { type: st, t: 0 };
    }
    b.train.t += TICK;
    if (b.train.t >= BARRACKS_TIME) {
      const u = this.makeUnit(b.owner, b.train.type, b.dx, b.dy);
      u.cond = 0.9;
      this.players[b.owner].stats.soldiers++;
      this.joinRally(u, b);
      this.emit('soldier', { owner: b.owner, utype: b.train.type, x: b.dx, y: b.dy });
      b.train = null;
    }
  },

  updateTower(b) {
    b.cd -= TICK;
    if (!b.guard || b.cd > 0 || (b.stock.stone || 0) < 1) return;
    const g = this.units.get(b.guard);
    if (!g || g.inside !== b.id) return;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const e = this.nearestEnemy(b.owner, cx, cy, b.def.range, true);
    if (!e) { b.cd = 0.5; return; }
    b.cd = 2.6;
    b.stock.stone--;
    this.shoot({ owner: b.owner, x: cx, y: b.y + 0.3, kind: 'stone', dmg: 18, target: e, attacker: null });
  },

  // --------------------------------------------------------- commands
  cmdSchoolQueue(bid, utype) {
    const b = this.buildings.get(bid);
    if (!b || b.def.kind !== 'school' || !CITIZENS[utype] || b.queue.length >= QUEUE_MAX) return false;
    b.queue.push(utype);
    return true;
  },
  cmdSchoolCancel(bid, k) {
    const b = this.buildings.get(bid);
    if (!b) return;
    if (k < 0) { if (b.train) { b.stock.gold = (b.stock.gold || 0) + 1; b.train = null; } }
    else b.queue.splice(k, 1);
  },
  cmdBarracksTrain(bid, stype, n = 1) {
    const b = this.buildings.get(bid);
    if (!b || b.def.kind !== 'barracks' || !SOLDIERS[stype]) return false;
    for (let k = 0; k < n && b.queue.length < QUEUE_MAX; k++) b.queue.push(stype);
    return true;
  },
  cmdBarracksCancel(bid, k) {
    const b = this.buildings.get(bid);
    if (b) b.queue.splice(k, 1);
  },
  cmdToggleOrder(bid, k) {
    const b = this.buildings.get(bid);
    if (b && b.orders.length > k) b.orders[k] = !b.orders[k];
  },
  cmdToggleBlock(bid, g) {
    const b = this.buildings.get(bid);
    if (b && b.def.kind === 'store') b.blocked[g] = !b.blocked[g];
  },
});
