// ---------------------------------------------------------------------------
// Player commands: the only way the UI (or a replay, a network peer, a test
// script) changes the world.
//
// A command is a plain JSON object { type, owner, ...args }. applyCommand()
// validates ownership and dispatches to the World methods. Because the
// simulation is deterministic, the list of commands with the tick they were
// applied at (see CommandLog) is enough to replay a match exactly, which is the
// basis for replays, lockstep multiplayer and bug reproduction.
//
// Adding a command: add an entry to COMMANDS with a one-line doc, keep it
// JSON-serializable (ids and numbers only, never object references), and
// cover it in test/commands.test.js.
// ---------------------------------------------------------------------------

const ownsBuilding = (w, c) => { const b = w.buildings.get(c.bid); return b && b.owner === c.owner ? b : null; };
const ownsGroup = (w, c, key = 'gid') => { const g = w.groups.get(c[key]); return g && g.owner === c.owner ? g : null; };

export const COMMANDS = {
  // Construction ----------------------------------------------------------
  place:        { doc: 'Place a construction site. { btype, x, y } top-left tile', run: (w, c) => w.placeBuilding(c.owner, c.btype, c.x, c.y, false) },
  plan:         { doc: 'Lay road (kind 1), corn (2) or wine (3) plans along an L-shaped line. { kind, x0, y0, x1, y1 }', run: (w, c) => w.planLine(c.owner, c.x0, c.y0, c.x1, c.y1, c.kind) },
  demolish:     { doc: 'Remove your building / plan / road / field at a tile. { x, y }', run: (w, c) => w.demolish(c.owner, c.x, c.y) },
  demolishBuilding: { doc: 'Demolish one of your buildings by id. { bid }', run: (w, c) => { const b = ownsBuilding(w, c); if (b) w.destroyBuilding(b, 'demolish'); return !!b; } },
  // Buildings -------------------------------------------------------------
  schoolQueue:  { doc: 'Queue a citizen at a school. { bid, utype }', run: (w, c) => !!ownsBuilding(w, c) && w.cmdSchoolQueue(c.bid, c.utype) },
  schoolCancel: { doc: 'Cancel queue slot k (-1 = the one in training). { bid, k }', run: (w, c) => !!ownsBuilding(w, c) && (w.cmdSchoolCancel(c.bid, c.k), true) },
  barracksTrain:{ doc: 'Queue n soldiers of a type at a barracks. { bid, stype, n }', run: (w, c) => !!ownsBuilding(w, c) && w.cmdBarracksTrain(c.bid, c.stype, c.n || 1) },
  barracksCancel:{ doc: 'Cancel barracks queue slot k. { bid, k }', run: (w, c) => !!ownsBuilding(w, c) && (w.cmdBarracksCancel(c.bid, c.k), true) },
  toggleOrder:  { doc: 'Toggle recipe k of a workshop on/off. { bid, k }', run: (w, c) => !!ownsBuilding(w, c) && (w.cmdToggleOrder(c.bid, c.k), true) },
  toggleBlock:  { doc: 'Toggle whether a storehouse accepts good g. { bid, g }', run: (w, c) => !!ownsBuilding(w, c) && (w.cmdToggleBlock(c.bid, c.g), true) },
  // Army -------------------------------------------------------------------
  groupMove:    { doc: 'March a group to a tile. { gid, x, y }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdMove(c.gid, c.x, c.y), true) },
  groupAttack:  { doc: 'Attack an enemy unit. { gid, uid }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdAttack(c.gid, c.uid), true) },
  groupAttackBuilding: { doc: 'Storm an enemy building. { gid, bid }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdAttackBuilding(c.gid, c.bid), true) },
  groupHalt:    { doc: 'Stop and regroup. { gid }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdHalt(c.gid), true) },
  groupSplit:   { doc: 'Split a group in two; returns the new group id. { gid }', run: (w, c) => { if (!ownsGroup(w, c)) return 0; const g = w.cmdSplit(c.gid); return g ? g.id : 0; } },
  groupJoin:    { doc: 'Merge group gid into group into. { gid, into }', run: (w, c) => !!(ownsGroup(w, c) && ownsGroup(w, c, 'into')) && (w.cmdJoin(c.gid, c.into), true) },
  groupFormation:{ doc: 'Change formation width by delta columns. { gid, delta }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdFormation(c.gid, c.delta), true) },
  groupTurn:    { doc: 'Rotate facing by delta eighths of a turn. { gid, delta }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdTurn(c.gid, c.delta), true) },
  groupFeed:    { doc: 'Send a group to the inn to eat. { gid }', run: (w, c) => !!ownsGroup(w, c) && (w.cmdFeed(c.gid), true) },
};

// Apply one command. Returns the handler's result (truthy on success; the
// created object for `place`, the new group id for `groupSplit`).
export function applyCommand(world, cmd) {
  const h = COMMANDS[cmd.type];
  if (!h) throw new Error('Unknown command: ' + cmd.type);
  if (world.over) return false;
  return h.run(world, cmd);
}

// Records commands with the tick they were applied at, and replays them.
export class CommandLog {
  constructor() { this.entries = []; }
  record(world, cmd) { this.entries.push({ tick: world.tickN, cmd: JSON.parse(JSON.stringify(cmd)) }); }
  toJSON() { return this.entries; }
  // Advance `world` to `untilTick`, applying each logged command before the
  // step that follows the tick it was recorded at.
  static replay(world, entries, untilTick) {
    let k = 0;
    while (world.tickN < untilTick) {
      while (k < entries.length && entries[k].tick <= world.tickN) applyCommand(world, entries[k++].cmd);
      world.step();
    }
    while (k < entries.length && entries[k].tick <= world.tickN) applyCommand(world, entries[k++].cmd);
    return world;
  }
}
