'use strict';
// ---------------------------------------------------------------------------
// Save / load. Entities are plain objects that reference each other by id,
// so a save is the entity lists plus the map's typed arrays (base64).
// ---------------------------------------------------------------------------

const SAVE_VERSION = 1;
const MAP_ARRAYS = ['terrain', 'ore', 'tree', 'treeT', 'stone', 'fish', 'road', 'roadOwner', 'field', 'fieldStage',
  'fieldT', 'fieldOwner', 'plan', 'planOwner', 'planJob', 'bld', 'reserve', 'height'];

function b64enc(ta) {
  const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64dec(str, Type) {
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Type(u8.buffer);
}

World.prototype.serialize = function () {
  const m = this.map;
  const map = { W: m.W, H: m.H, starts: m.starts, growing: [...m.growing] };
  for (const k of MAP_ARRAYS) map[k] = b64enc(m[k]);
  const ai = this.ai ? {
    nextAttack: this.ai.nextAttack, nextTrickle: this.ai.nextTrickle, nextRebuild: this.ai.nextRebuild,
    waves: this.ai.waves, threatT: this.ai.threatT, threat: this.ai.threat, home: this.ai.home, layout: this.ai.layout,
  } : null;
  // Infinity doesn't survive JSON; store it as null.
  if (ai && !Number.isFinite(ai.nextAttack)) ai.nextAttack = null;
  return {
    v: SAVE_VERSION, seed: this.seed, difficulty: this.difficulty, time: this.time, tickN: this.tickN,
    nextId: this.nextId, rng: this.rng.s, over: this.over, map,
    players: this.players.map(p => ({ id: p.id, isAI: p.isAI, defeated: p.defeated, stats: p.stats,
      lastAttackAlert: p.lastAttackAlert, lastHungryAlert: p.lastHungryAlert, lastIdleAlert: p.lastIdleAlert })),
    units: [...this.units.values()],
    buildings: [...this.buildings.values()].map(b => { const o = Object.assign({}, b); delete o.def; return o; }),
    groups: [...this.groups.values()],
    cjobs: [...this.cjobs.values()],
    projectiles: this.projectiles, effects: this.effects,
    fieldTiles: [...this.fieldTiles],
    ai,
  };
};

World.fromSave = function (d) {
  if (!d || d.v !== SAVE_VERSION) throw new Error('Unsupported save version');
  const w = Object.create(World.prototype);
  w.seed = d.seed;
  w.difficulty = d.difficulty;
  w.diff = DIFFICULTY[d.difficulty];
  const m = new GameMap(d.map.W, d.map.H);
  const types = {};
  for (const k of MAP_ARRAYS) types[k] = m[k].constructor;
  for (const k of MAP_ARRAYS) m[k] = b64dec(d.map[k], types[k]);
  m.growing = new Set(d.map.growing);
  m.starts = d.map.starts;
  w.map = m;
  w.pf = new PathFinder(m);
  w.players = d.players.map(pd => {
    const p = new Player(pd.id, pd.isAI);
    Object.assign(p, pd);
    p.comp = new Int32Array(m.N);
    p.compDirty = true;
    return p;
  });
  w.units = new Map(d.units.map(u => [u.id, u]));
  w.buildings = new Map(d.buildings.map(b => { b.def = BUILDINGS[b.type]; return [b.id, b]; }));
  w.groups = new Map(d.groups.map(g => [g.id, g]));
  w.cjobs = new Map(d.cjobs.map(c => [c.id, c]));
  w.projectiles = d.projectiles || [];
  w.effects = d.effects || [];
  w.events = [];
  w.nextId = d.nextId;
  w.time = d.time;
  w.tickN = d.tickN;
  w.rng = new RNG(1);
  w.rng.s = d.rng;
  w.grid = new Map();
  w.over = d.over || null;
  w.fieldTiles = new Set(d.fieldTiles);
  if (d.ai) {
    const ai = Object.create(AIController.prototype);
    Object.assign(ai, d.ai, { w, p: w.players[1], diff: w.diff });
    if (ai.nextAttack == null) ai.nextAttack = Infinity;
    w.ai = ai;
  } else w.ai = null;
  for (const p of w.players) w.computeRoadComps(p);
  return w;
};
