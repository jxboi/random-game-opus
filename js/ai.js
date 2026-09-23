'use strict';
// ---------------------------------------------------------------------------
// Computer opponent. Runs the same economy as the player (its town is
// prebuilt), trains troops, defends, rebuilds and sends attack waves.
// A small supply trickle stands in for mines and smithies it doesn't build.
// ---------------------------------------------------------------------------

function soldierCountOf(w, owner) {
  let n = 0;
  for (const u of w.units.values()) if (u.owner === owner && u.kind === 'soldier') n++;
  return n;
}

class AIController {
  constructor(w, p) {
    this.w = w;
    this.p = p;
    this.diff = w.diff;
    this.nextAttack = this.diff.firstAttack;
    this.nextTrickle = 45;
    this.nextRebuild = 30;
    this.waves = 0;
    this.threatT = -99;
    this.threat = null;
    const s = w.map.starts[p.id];
    this.home = { x: s.x, y: s.y };
    this.layout = [];
    for (const b of w.buildings.values()) if (b.owner === p.id) this.layout.push({ type: b.type, x: b.x, y: b.y });
  }

  onAttacked(x, y) {
    this.threatT = this.w.time;
    this.threat = { x, y };
  }

  think() {
    const w = this.w, p = this.p;
    if (p.defeated) return;
    const bs = [...w.buildings.values()].filter(b => b.owner === p.id);
    const school = bs.find(b => b.def.kind === 'school' && b.state === 'done');
    const barracks = bs.find(b => b.def.kind === 'barracks' && b.state === 'done');
    const store = bs.find(b => b.def.kind === 'store' && b.state === 'done');
    const counts = w.countUnits(p.id);

    // --- school
    if (school && school.queue.length < 2) {
      const queued = t => school.queue.filter(q => q === t).length + (school.train && school.train.type === t ? 1 : 0);
      const idleOf = t => [...w.units.values()].some(u => u.owner === p.id && u.type === t && !u.home);
      let pick = null;
      if ((counts.serf || 0) + queued('serf') < 10) pick = 'serf';
      else if ((counts.laborer || 0) + queued('laborer') < 3) pick = 'laborer';
      else {
        for (const b of bs) if (b.state === 'done' && b.def.worker && !b.worker && !idleOf(b.def.worker) && !queued(b.def.worker)) { pick = b.def.worker; break; }
      }
      if (!pick && barracks && soldierCountOf(w, p.id) < this.diff.cap && (counts.recruit || 0) + barracks.recruits + queued('recruit') < 4 && (store && (store.stock.gold || 0) + (school.stock.gold || 0) > 1)) pick = 'recruit';
      if (pick) w.cmdSchoolQueue(school.id, pick);
    }

    // --- barracks: equip the best soldier we can
    const soldierCount = [...w.units.values()].filter(u => u.owner === p.id && u.kind === 'soldier').length;
    if (barracks && barracks.recruits > 0 && barracks.queue.length === 0 && soldierCount < this.diff.cap) {
      const order = ['knight', 'swordsman', 'crossbowman', 'pikeman', 'scout', 'axeman', 'bowman', 'lancer', 'militia'];
      for (const st of order) if (w.canEquip(barracks, st)) { w.cmdBarracksTrain(barracks.id, st); break; }
    }

    // --- groups
    const groups = [...w.groups.values()].filter(g => g.owner === p.id);
    // Defend: enemies near our town or anything we own that was hit recently.
    let threat = null;
    for (const b of bs) {
      const e = w.nearestEnemy(p.id, b.x + b.w / 2, b.y + b.h / 2, 13, true);
      if (e) { threat = e; break; }
    }
    if (!threat && this.threat && w.time - this.threatT < 10) threat = w.nearestEnemy(p.id, this.threat.x, this.threat.y, 10, true);
    if (threat) {
      for (const g of groups) {
        if (g.offensive) continue;
        if (g.order.kind === 'idle' || g.order.kind === 'move') {
          const c = w.groupCenter(g);
          if (dist(c.x, c.y, threat.x, threat.y) < 30) w.cmdAttack(g.id, threat.id);
        }
      }
    } else {
      // Defenders drift back home once the danger has passed.
      for (const g of groups) {
        if (g.offensive || g.order.kind !== 'idle' || g.rally) continue;
        const c = w.groupCenter(g);
        if (dist(c.x, c.y, this.home.x, this.home.y) > 16) w.cmdMove(g.id, this.home.x - 5 + w.rng.int(-3, 3), this.home.y + 5 + w.rng.int(-3, 3));
      }
    }

    // Offensive groups that finished their target look for the next one.
    for (const g of groups) {
      if (!g.offensive || g.order.kind !== 'idle') continue;
      const c = w.groupCenter(g);
      const tgt = this.pickTarget(c.x, c.y);
      if (tgt) w.cmdAttackBuilding(g.id, tgt.id);
      else { g.offensive = false; w.cmdMove(g.id, this.home.x - 5, this.home.y + 5); }
    }

    // Attack waves.
    if (w.time >= this.nextAttack) {
      const home = groups.filter(g => !g.offensive);
      const soldiers = home.reduce((n, g) => n + g.members.length, 0);
      const need = this.diff.wave + this.waves * this.diff.waveGrow;
      if (soldiers >= need) {
        home.sort((a, b) => b.members.length - a.members.length);
        let sent = 0;
        const target = this.pickTarget(this.home.x, this.home.y);
        if (target) {
          for (const g of home) {
            if (sent >= Math.min(soldiers * 0.7, need + 4)) break;
            g.offensive = true;
            w.cmdAttackBuilding(g.id, target.id);
            sent += g.members.length;
          }
          this.waves++;
          w.emit('wave', { owner: p.id, n: sent });
        }
        this.nextAttack = w.time + this.diff.interval;
      } else {
        this.nextAttack = w.time + 30;
      }
    }

    // Supply trickle.
    if (w.time >= this.nextTrickle && store) {
      this.nextTrickle = w.time + 45;
      const k = this.diff.trickle;
      const add = (g, n) => { if (n > 0) store.stock[g] = (store.stock[g] || 0) + n; };
      add('gold', this.diff.gold);
      add('bread', 2); add('sausage', 2); add('wine', 2);
      add('axe', k); add('leather_armor', k); add('wooden_shield', Math.ceil(k / 2)); add('bow', Math.floor(k / 2)); add('lance', Math.floor(k / 2));
      if (w.time > 900) { add('iron_armor', k - 1); add('sword', k - 1); add('iron_shield', Math.floor(k / 2)); add('pike', Math.floor(k / 3)); }
      if (w.time > 1500 && k >= 2) { add('horse', 1); add('crossbow', 1); }
      add('stone', 3); add('wood', 3);
    }

    // Rebuild what the player burned down.
    if (w.time >= this.nextRebuild) {
      this.nextRebuild = w.time + 25;
      for (const e of this.layout) {
        if (bs.some(b => b.type === e.type && b.x === e.x && b.y === e.y)) continue;
        if (w.canPlace(p.id, e.type, e.x, e.y)) continue;
        if (w.nearestEnemy(p.id, e.x, e.y, 10, true)) continue;
        const b = w.placeBuilding(p.id, e.type, e.x, e.y, false);
        if (b) {
          const path = roadPathToNetwork(w, p.id, b.door, new Set());
          if (path) for (const i of path) if (!w.map.road[i] && !w.map.plan[i]) w.planTile(p.id, i % w.map.W, (i / w.map.W) | 0, 1);
          break;
        }
      }
    }
  }

  pickTarget(x, y) {
    let best = null, bd = 1e9;
    for (const b of this.w.buildings.values()) {
      if (b.owner === this.p.id) continue;
      // Prefer military and economic cores a little.
      const bonus = b.def.kind === 'barracks' || b.def.kind === 'store' ? -6 : b.def.kind === 'tower' ? 4 : 0;
      const d = dist(x, y, b.x, b.y) + bonus;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}
