// ---------------------------------------------------------------------------
// Input handling and the side panel. Every change to the world goes through
// game.exec(command) (see src/core/commands.js); the UI itself only reads the
// world and keeps its own transient state in this.state.
// ---------------------------------------------------------------------------
import { QUEUE_MAX, SCHOOL_TIME } from '../core/buildings.js';
import { snapDir } from '../core/combat.js';
import { lineTiles } from '../core/world.js';
import { Minimap } from '../render/minimap.js';
import { BUILDINGS, BUILDING_LIST, BUILD_GROUPS, CITIZENS, CITIZEN_LIST, FOOD_LIST, GOODS, GOOD_LIST, PLAYER_COLORS, SOLDIERS, SOLDIER_LIST, WARFARE } from '../core/data.js';
import { HUNGRY } from '../core/units.js';
import { clamp, fmtTime } from '../core/util.js';
import { buildingIcon } from '../render/art2d.js';

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const gIcon = g => `<span class="gi" title="${esc(GOODS[g].name)}">${GOODS[g].icon}</span>`;

export class UI {
  constructor(game) {
    this.game = game;
    this.state = {
      tool: null, hover: null, drag: null, box: null,
      selGroups: new Set(), selBuilding: 0, selUnit: 0,
      tab: 'build', showEnemyPlans: false,
      ghost: null,        // placement preview, computed each frame by updateGhost()
      hoverBuilding: 0,   // building under the cursor when no tool is active
    };
    this.keys = new Set();
    this.messages = [];
    this.lastPanel = '';
    this.lastTop = '';
    this.panelT = 0;
    this.miniT = 0;
    this.hoverInfo = '';
    this.el = {
      stage: document.getElementById('stage'),
      panel: document.getElementById('panel-body'),
      top: document.getElementById('topbar-stats'),
      mini: document.getElementById('minimap'),
      msgs: document.getElementById('messages'),
      tip: document.getElementById('tip'),
      banner: document.getElementById('banner'),
      tabs: document.getElementById('tabs'),
    };
    this.icons = {};
    this.minimap = new Minimap(this.el.mini);
    this.bindInput();
  }

  get world() { return this.game.world; }
  get r() { return this.game.renderer; }

  iconFor(type) {
    if (!this.icons[type]) this.icons[type] = buildingIcon(type, PLAYER_COLORS[0].main, 48);
    return this.icons[type];
  }

  // --------------------------------------------------------------- input
  bindInput() {
    const c = this.el.stage;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointerleave', () => { if (!this.state.drag) this.state.hover = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); const t = this.tileAt(e); this.r.zoomAt(t.sx, t.sy, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    this.el.panel.addEventListener('click', e => this.onPanelClick(e));
    // Don't swap the panel's HTML out from under a press in progress.
    this.el.panel.addEventListener('pointerdown', () => { this.panelPress = true; });
    window.addEventListener('pointerup', () => { this.panelPress = false; });
    this.el.panel.addEventListener('mouseover', e => this.onPanelHover(e));
    this.el.panel.addEventListener('mouseout', () => { this.hoverInfo = ''; });
    this.el.tabs.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      this.game.sfx.click();
      this.state.tab = t.dataset.tab;
      this.clearSelection();
      this.refreshPanel(true);
    });
    this.el.msgs.addEventListener('click', e => {
      const m = e.target.closest('[data-x]');
      if (m) this.centerOn(+m.dataset.x, +m.dataset.y);
    });
    // Minimap: click / drag to move the camera.
    const mini = this.el.mini;
    const miniMove = e => {
      const rc = mini.getBoundingClientRect();
      const m = this.world.map;
      this.r.cam.x = (e.clientX - rc.left) / rc.width * m.W;
      this.r.cam.y = (e.clientY - rc.top) / rc.height * m.H;
    };
    mini.addEventListener('pointerdown', e => {
      if (e.button === 2 && this.state.selGroups.size) {
        const rc = mini.getBoundingClientRect(), m = this.world.map;
        this.orderAt(Math.floor((e.clientX - rc.left) / rc.width * m.W), Math.floor((e.clientY - rc.top) / rc.height * m.H));
        return;
      }
      this.miniDrag = true; miniMove(e); mini.setPointerCapture(e.pointerId);
    });
    mini.addEventListener('pointermove', e => { if (this.miniDrag) miniMove(e); });
    mini.addEventListener('pointerup', () => { this.miniDrag = false; });
    mini.addEventListener('contextmenu', e => e.preventDefault());
    // Touch pinch zoom
    this.touches = new Map();
  }

  blocked() { return !!this.world.over || this.game.overlayOpen; }

  tileAt(e) {
    const rc = this.el.stage.getBoundingClientRect();
    const [wx, wy] = this.r.toWorld(e.clientX - rc.left, e.clientY - rc.top);
    return { x: Math.floor(wx), y: Math.floor(wy), wx, wy, sx: e.clientX - rc.left, sy: e.clientY - rc.top };
  }

  onDown(e) {
    this.game.sfx.unlock();
    if (this.blocked()) return;
    const t = this.tileAt(e);
    this.state.hover = t;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { this.pinch = { d: this.touchDist(), zoom: this.r.cam.zoom }; this.state.drag = null; return; }
    }
    const tool = this.state.tool;
    if (e.button === 1 || (e.button === 2 && !tool)) {
      this.state.drag = { pan: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button, t };
      return;
    }
    if (e.button === 2 && tool) { this.setTool(null); return; }
    if (e.button !== 0) return;
    if (tool && (tool.kind === 'road' || tool.kind === 'field' || tool.kind === 'wine')) {
      this.state.drag = { tool: true, x0: t.x, y0: t.y };
      return;
    }
    if (tool && tool.kind === 'build') { this.placeAt(t); return; }
    if (tool && tool.kind === 'demolish') { this.demolishAt(t); return; }
    if (tool && tool.kind === 'join') { this.joinAt(t); return; }
    // selection or (touch) pan
    this.state.drag = { sel: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, touch: e.pointerType === 'touch', t, shift: e.shiftKey };
  }

  touchDist() {
    const p = [...this.touches.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  onMove(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size === 2) { this.r.cam.zoom = this.pinch.zoom * this.touchDist() / this.pinch.d; return; }
    }
    if (!this.el.stage.contains(e.target) && !this.state.drag) return;
    const t = this.tileAt(e);
    this.state.hover = t;
    const d = this.state.drag;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.pan || (d.sel && d.touch)) {
      if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; d.lx = d.sx; d.ly = d.sy; }
      if (d.moved) {
        this.r.panBy(e.clientX - d.lx, e.clientY - d.ly);
        d.lx = e.clientX; d.ly = e.clientY;
      }
    } else if (d.sel) {
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      if (d.moved) {
        const rc = this.el.stage.getBoundingClientRect();
        this.state.box = { x0: d.sx - rc.left, y0: d.sy - rc.top, x1: e.clientX - rc.left, y1: e.clientY - rc.top };
      }
    }
  }

  onUp(e) {
    if (e.pointerType === 'touch') { this.touches.delete(e.pointerId); if (this.touches.size < 2) this.pinch = null; }
    const d = this.state.drag;
    this.state.drag = null;
    if (!d || this.blocked()) { this.state.box = null; return; }
    const t = this.tileAt(e);
    if (d.tool) {
      const kind = this.state.tool.kind === 'road' ? 1 : this.state.tool.kind === 'field' ? 2 : 3;
      const n = this.game.exec({ type: 'plan', owner: 0, kind, x0: d.x0, y0: d.y0, x1: t.x, y1: t.y });
      if (!n) this.game.sfx.error(); // success is voiced by the 'planned' event
      return;
    }
    if (d.pan) {
      if (!d.moved && d.button === 2) this.orderAt(d.t.x, d.t.y, d.t);
      return;
    }
    if (d.sel) {
      if (this.state.box) { this.boxSelect(this.state.box); this.state.box = null; return; }
      if (d.moved) return; // touch pan
      // A tap with an army selected on touch devices issues an order on empty ground / enemies.
      if (d.touch && this.state.selGroups.size && !this.ownThingAt(t)) { this.orderAt(t.x, t.y, t); return; }
      this.clickSelect(t, d.shift);
    }
  }

  onKey(e, down) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    if (this.game.overlayOpen) { if (k === 'escape') this.game.escape(); return; }
    if (this.world.over) return;
    switch (k) {
      case 'escape': if (this.state.tool) this.setTool(null); else this.clearSelection(); break;
      case ' ': e.preventDefault(); this.game.togglePause(); break;
      case 'r': this.setTool({ kind: 'road' }); break;
      case 'f': this.setTool({ kind: 'field' }); break;
      case 'v': this.setTool({ kind: 'wine' }); break;
      case 'x': case 'delete': this.setTool({ kind: 'demolish' }); break;
      case 'h': this.centerOn(this.world.map.starts[0].x, this.world.map.starts[0].y); break;
      case '1': this.game.setSpeed(1); break;
      case '2': this.game.setSpeed(2); break;
      case '3': this.game.setSpeed(4); break;
      case 'b': this.state.tab = 'build'; this.clearSelection(); break;
      case 'tab': e.preventDefault(); this.cycleGroup(e.shiftKey ? -1 : 1); break;
      case 'g': if (this.state.selGroups.size) this.cmdGroups('halt'); break;
      case '+': case '=': this.r.zoomAt(this.r.cw / 2, this.r.ch / 2, 1.15); break;
      case '-': this.r.zoomAt(this.r.cw / 2, this.r.ch / 2, 1 / 1.15); break;
    }
    this.refreshPanel(true);
  }

  // Called every frame: held keys and the placement preview.
  update(dt) {
    this.updateGhost();
    if (this.game.overlayOpen) return;
    const sp = 700 * dt / Math.max(4, this.r.pxPerTile()); // ~700 px/s whatever the zoom
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) this.r.cam.y -= sp;
    if (k.has('s') || k.has('arrowdown')) this.r.cam.y += sp;
    if (k.has('a') || k.has('arrowleft')) this.r.cam.x -= sp;
    if (k.has('d') || k.has('arrowright')) this.r.cam.x += sp;
  }

  // Work out what the current tool would do at the hovered tile. Renderers only
  // draw state.ghost; they never evaluate placement rules themselves.
  updateGhost() {
    const st = this.state, h = st.hover, tool = st.tool, w = this.world, m = w.map;
    st.ghost = null;
    st.hoverBuilding = 0;
    if (!h) return;
    if (!tool) { const b = this.buildingAt(h); st.hoverBuilding = b ? b.id : 0; return; }
    if (tool.kind === 'build') {
      const def = BUILDINGS[tool.type];
      const x = h.x - (def.w >> 1), y = h.y - (def.h >> 1) + 1;
      const reason = w.canPlace(0, tool.type, x, y);
      st.ghost = { kind: 'build', type: tool.type, x, y, ok: !reason, reason, door: w.doorOf(def, x, y) };
    } else if (tool.kind === 'road' || tool.kind === 'field' || tool.kind === 'wine') {
      const plan = tool.kind === 'road' ? 1 : tool.kind === 'field' ? 2 : 3;
      const line = st.drag && st.drag.tool ? lineTiles(st.drag.x0, st.drag.y0, h.x, h.y) : [[h.x, h.y]];
      const tiles = [];
      for (const [x, y] of line) {
        if (!m.inb(x, y)) continue;
        const i = m.idx(x, y);
        tiles.push([x, y, plan === 1 ? m.canRoad(i) : m.canField(i)]);
      }
      st.ghost = { kind: 'tiles', plan, tiles };
    } else if (tool.kind === 'demolish') {
      const b = this.buildingAt(h);
      st.ghost = { kind: 'demolish', x: h.x, y: h.y, bid: b && b.owner === 0 ? b.id : 0 };
    }
  }

  centerOn(x, y) { this.r.cam.x = x; this.r.cam.y = y; }

  setTool(tool) {
    this.state.tool = tool;
    if (tool) { this.state.selGroups.clear(); this.state.selBuilding = 0; this.state.selUnit = 0; this.game.sfx.click(); }
    this.el.stage.style.cursor = tool ? (tool.kind === 'demolish' ? 'not-allowed' : 'crosshair') : 'default';
    this.refreshPanel(true);
  }

  clearSelection() {
    this.state.selGroups.clear(); this.state.selBuilding = 0; this.state.selUnit = 0;
  }

  // ---------------------------------------------------------- map actions
  placeAt(t) {
    const type = this.state.tool.type, def = BUILDINGS[type];
    const bx = t.x - (def.w >> 1), by = t.y - (def.h >> 1) + 1;
    const reason = this.world.canPlace(0, type, bx, by);
    if (reason) { this.game.sfx.error(); this.toast(reason); return; }
    this.game.exec({ type: 'place', owner: 0, btype: type, x: bx, y: by });
    if (!this.game.shiftHeld()) this.setTool(null);
  }

  demolishAt(t) {
    const what = this.game.exec({ type: 'demolish', owner: 0, x: t.x, y: t.y });
    if (what) { this.game.sfx.place(); this.toast('Removed ' + what); }
    else this.game.sfx.error();
  }

  joinAt(t) {
    const u = this.unitAt(t, 0, true);
    const tool = this.state.tool;
    if (u && u.group && u.group !== tool.gid) {
      this.game.exec({ type: 'groupJoin', owner: 0, gid: tool.gid, into: u.group });
      this.state.selGroups = new Set([u.group]);
      this.game.sfx.click();
    } else this.game.sfx.error();
    this.state.tool = null;
    this.el.stage.style.cursor = 'default';
    this.refreshPanel(true);
  }

  // Unit under the cursor, picked in screen space so it works for any camera.
  // Soldiers win ties against citizens.
  unitAt(t, owner, soldiersOnly) {
    const r = Math.max(10, this.r.pxPerTile() * 0.45);
    let best = null, bd = r * r;
    for (const u of this.world.units.values()) {
      if (u.inside || (owner != null && u.owner !== owner) || (soldiersOnly && u.kind !== 'soldier')) continue;
      const [sx, sy] = this.r.toScreen(u.x, u.y, 0.3);
      const d = (sx - t.sx) ** 2 + (sy - t.sy) ** 2;
      if (d < bd || (best && best.kind !== 'soldier' && u.kind === 'soldier' && d < bd * 1.5)) { bd = d; best = u; }
    }
    return best;
  }

  // Building under the cursor: the renderer's own picking first (3D roofs
  // stick up above their tiles), then the tile under the cursor.
  buildingAt(t) {
    const m = this.world.map;
    const id = this.r.pickBuilding(t.sx, t.sy) || (m.inb(t.x, t.y) ? m.bld[m.idx(t.x, t.y)] : 0);
    return this.world.buildings.get(id) || null;
  }

  ownThingAt(t) {
    const m = this.world.map;
    if (this.unitAt(t, 0)) return true;
    const b = this.buildingAt(t);
    return !!(b && b.owner === 0);
  }

  clickSelect(t, add) {
    const m = this.world.map;
    const u = this.unitAt(t, null);
    if (u) {
      if (u.kind === 'soldier') {
        if (u.owner === 0) {
          if (!add) this.state.selGroups.clear();
          if (add && this.state.selGroups.has(u.group)) this.state.selGroups.delete(u.group);
          else this.state.selGroups.add(u.group);
          this.state.selBuilding = 0; this.state.selUnit = 0;
        } else { this.state.selGroups.clear(); this.state.selBuilding = 0; this.state.selUnit = u.id; }
      } else { this.state.selGroups.clear(); this.state.selBuilding = 0; this.state.selUnit = u.id; }
      this.game.sfx.click();
      this.refreshPanel(true);
      return;
    }
    const b = this.buildingAt(t);
    this.clearSelection();
    if (b) { this.state.selBuilding = b.id; this.game.sfx.click(); }
    this.refreshPanel(true);
  }

  boxSelect(box) {
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const sel = new Set();
    for (const u of this.world.units.values()) {
      if (u.owner !== 0 || u.kind !== 'soldier' || u.inside) continue;
      const [sx, sy] = this.r.toScreen(u.x, u.y, 0.3);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) sel.add(u.group);
    }
    this.clearSelection();
    this.state.selGroups = sel;
    if (sel.size) this.game.sfx.click();
    this.refreshPanel(true);
  }

  // Right-click with soldiers selected: attack whatever enemy is there, otherwise move.
  orderAt(x, y, t) {
    const w = this.world, m = w.map;
    const groups = [...this.state.selGroups].filter(id => w.groups.has(id));
    if (!groups.length) { this.clearSelection(); this.refreshPanel(true); return; }
    const enemy = t ? this.unitAt(t, 1) : null;
    const bld = t ? this.buildingAt(t) : (m.inb(x, y) ? w.buildings.get(m.bld[m.idx(x, y)]) : null);
    if (enemy) {
      for (const g of groups) this.game.exec({ type: 'groupAttack', owner: 0, gid: g, uid: enemy.id });
      this.r.flash(enemy.x, enemy.y, 'rgba(255,80,60,A)');
      this.game.sfx.tone(300, 0.08, 'square', 0.12);
    } else if (bld && bld.owner !== 0) {
      for (const g of groups) this.game.exec({ type: 'groupAttackBuilding', owner: 0, gid: g, bid: bld.id });
      this.r.flash(bld.x + bld.w / 2, bld.y + bld.h / 2, 'rgba(255,80,60,A)');
      this.game.sfx.tone(300, 0.08, 'square', 0.12);
    } else {
      if (!m.inb(x, y)) return;
      // Several groups: spread them side by side around the click.
      const n = groups.length;
      groups.forEach((g, k) => {
        const gg = w.groups.get(g);
        const c = w.groupCenter(gg);
        const [fx, fy] = snapDir(x + 0.5 - c.x, y + 0.5 - c.y);
        const off = (k - (n - 1) / 2) * 4;
        this.game.exec({ type: 'groupMove', owner: 0, gid: g, x: clamp(Math.round(x - fy * off), 0, m.W - 1), y: clamp(Math.round(y + fx * off), 0, m.H - 1) });
      });
      this.r.flash(x + 0.5, y + 0.5, 'rgba(255,255,140,A)');
      this.game.sfx.tone(520, 0.06, 'triangle', 0.12);
    }
  }

  cycleGroup(dir) {
    const gs = [...this.world.groups.values()].filter(g => g.owner === 0);
    if (!gs.length) return;
    const cur = [...this.state.selGroups][0];
    let k = gs.findIndex(g => g.id === cur);
    k = (k + dir + gs.length) % gs.length;
    this.clearSelection();
    this.state.selGroups.add(gs[k].id);
    const c = this.world.groupCenter(gs[k]);
    this.centerOn(c.x, c.y);
  }

  cmdGroups(cmd, arg) {
    const w = this.world;
    for (const gid of [...this.state.selGroups]) {
      switch (cmd) {
        case 'halt': this.game.exec({ type: 'groupHalt', owner: 0, gid }); break;
        case 'split': { const ng = this.game.exec({ type: 'groupSplit', owner: 0, gid }); if (ng) this.state.selGroups.add(ng); break; }
        case 'form': this.game.exec({ type: 'groupFormation', owner: 0, gid, delta: arg }); break;
        case 'turn': this.game.exec({ type: 'groupTurn', owner: 0, gid, delta: arg }); break;
        case 'feed': this.game.exec({ type: 'groupFeed', owner: 0, gid }); break;
      }
    }
    if (cmd === 'join') {
      const gid = [...this.state.selGroups][0];
      if (gid) { this.state.tool = { kind: 'join', gid }; this.el.stage.style.cursor = 'copy'; this.toast('Click a group to join'); }
    }
    this.game.sfx.click();
  }

  // --------------------------------------------------------- panel clicks
  onPanelClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    this.game.sfx.unlock();
    const w = this.world, a = el.dataset.act, v = el.dataset.v, bid = this.state.selBuilding;
    if (this.world.over) return;
    switch (a) {
      case 'tool': this.setTool({ kind: v }); break;
      case 'build': this.setTool({ kind: 'build', type: v }); break;
      case 'school': if (this.game.exec({ type: 'schoolQueue', owner: 0, bid, utype: v })) this.game.sfx.click(); else this.game.sfx.error(); break;
      case 'school-cancel': this.game.exec({ type: 'schoolCancel', owner: 0, bid, k: +v }); this.game.sfx.click(); break;
      case 'train': {
        const n = e.shiftKey ? 5 : 1;
        if (this.game.exec({ type: 'barracksTrain', owner: 0, bid, stype: v, n })) this.game.sfx.click();
        break;
      }
      case 'train-cancel': this.game.exec({ type: 'barracksCancel', owner: 0, bid, k: +v }); break;
      case 'order': this.game.exec({ type: 'toggleOrder', owner: 0, bid, k: +v }); this.game.sfx.click(); break;
      case 'block': this.game.exec({ type: 'toggleBlock', owner: 0, bid, g: v }); this.game.sfx.click(); break;
      case 'demolish-b': {
        const b = w.buildings.get(bid);
        if (b && b.owner === 0) { this.game.exec({ type: 'demolishBuilding', owner: 0, bid: b.id }); this.clearSelection(); this.game.sfx.place(); }
        break;
      }
      case 'goto-b': { const b = w.buildings.get(+v); if (b) this.centerOn(b.x + b.w / 2, b.y + b.h / 2); break; }
      case 'group': {
        const g = w.groups.get(+v);
        if (g) { this.clearSelection(); this.state.selGroups.add(g.id); const c = w.groupCenter(g); this.centerOn(c.x, c.y); this.game.sfx.click(); }
        break;
      }
      case 'gcmd': this.cmdGroups(v, el.dataset.arg != null ? +el.dataset.arg : undefined); break;
      case 'deselect': this.clearSelection(); break;
    }
    this.refreshPanel(true);
  }

  onPanelHover(e) {
    const el = e.target.closest('[data-tip]');
    this.hoverInfo = el ? el.dataset.tip : '';
  }

  toast(msg) {
    const t = this.el.tip;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }

  message(text, x, y, kind = '') {
    this.messages.unshift({ text, x, y, kind, t: this.world.time });
    if (this.messages.length > 6) this.messages.length = 6;
    this.renderMessages();
  }

  renderMessages() {
    this.el.msgs.innerHTML = this.messages.map(m =>
      `<div class="msg ${m.kind}" ${m.x != null ? `data-x="${m.x}" data-y="${m.y}"` : ''}><span class="mt">${fmtTime(m.t)}</span> ${esc(m.text)}</div>`).join('');
  }

  bannerShow(text, kind) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = 'show ' + (kind || '');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => { b.className = ''; }, 2600);
  }

  // --------------------------------------------------------------- panel
  tick(dt) {
    this.panelT -= dt;
    this.miniT -= dt;
    if (this.panelT <= 0) { this.panelT = 0.25; this.refreshPanel(false); }
    if (this.miniT <= 0) { this.miniT = 0.4; this.minimap.draw(this.world, this.r); }
  }

  refreshPanel(force) {
    const w = this.world;
    // Drop selections that no longer exist.
    for (const g of [...this.state.selGroups]) if (!w.groups.has(g)) this.state.selGroups.delete(g);
    if (this.state.selBuilding && !w.buildings.has(this.state.selBuilding)) this.state.selBuilding = 0;
    if (this.state.selUnit && !w.units.has(this.state.selUnit)) this.state.selUnit = 0;

    this.renderTop();
    let html;
    if (this.state.selGroups.size) html = this.groupView();
    else if (this.state.selBuilding) html = this.buildingView(w.buildings.get(this.state.selBuilding));
    else if (this.state.selUnit) html = this.unitView(w.units.get(this.state.selUnit));
    else html = this.tabView();
    const gh = this.state.ghost;
    const tipText = gh && gh.kind === 'build' && gh.reason ? '⚠ ' + gh.reason : this.hoverInfo;
    html += `<div class="hint">${esc(tipText || this.defaultHint())}</div>`;
    if (html !== this.lastPanel && (force || !this.panelPress)) { this.el.panel.innerHTML = html; this.lastPanel = html; }
    for (const t of this.el.tabs.querySelectorAll('[data-tab]')) t.classList.toggle('on', t.dataset.tab === this.state.tab && !this.hasSelection());
  }

  hasSelection() { return this.state.selGroups.size || this.state.selBuilding || this.state.selUnit; }

  defaultHint() {
    const t = this.state.tool;
    if (!t) return this.state.selGroups.size ? 'Right-click to move or attack. Drag to box-select.' : 'Left-click to select. Right-drag or WASD to scroll. Wheel to zoom.';
    if (t.kind === 'road') return 'Drag to lay a road. Right-click or Esc to stop.';
    if (t.kind === 'field') return 'Drag to lay corn fields near a farm.';
    if (t.kind === 'wine') return 'Drag to lay wine fields near a vineyard.';
    if (t.kind === 'demolish') return 'Click your building, road, plan or field to remove it.';
    if (t.kind === 'build') return 'Click to place. Shift-click to place several. The yellow marker is the entrance.';
    return '';
  }

  renderTop() {
    const w = this.world;
    const st = w.stockTotals(0);
    const food = FOOD_LIST.reduce((n, g) => n + (st[g] || 0), 0);
    let serfs = 0, soldiers = 0, pop = 0;
    for (const u of w.units.values()) if (u.owner === 0) { pop++; if (u.type === 'serf') serfs++; if (u.kind === 'soldier') soldiers++; }
    const g = this.game;
    const html =
      `<span class="chip" title="Timber">${GOODS.wood.icon} ${st.wood || 0}</span>` +
      `<span class="chip" title="Stone">${GOODS.stone.icon} ${st.stone || 0}</span>` +
      `<span class="chip" title="Gold chests">${GOODS.gold.icon} ${st.gold || 0}</span>` +
      `<span class="chip" title="Food in storehouses">🍖 ${food}</span>` +
      `<span class="chip" title="Population / serfs">👥 ${pop} <small>(${serfs} serfs)</small></span>` +
      `<span class="chip" title="Soldiers">⚔️ ${soldiers}</span>` +
      `<span class="chip time" title="Game time">⏱ ${fmtTime(w.time)}${g.paused ? ' ⏸' : g.speed > 1 ? ' ×' + g.speed : ''}</span>`;
    if (html !== this.lastTop) { this.el.top.innerHTML = html; this.lastTop = html; }
  }

  tabView() {
    switch (this.state.tab) {
      case 'build': return this.buildTab();
      case 'stock': return this.stockTab();
      case 'army': return this.armyTab();
      case 'guide': return this.guideTab();
    }
    return '';
  }

  buildTab() {
    const tool = this.state.tool;
    const tb = (kind, label, key, tip) =>
      `<button class="tool ${tool && tool.kind === kind ? 'on' : ''}" data-act="tool" data-v="${kind}" data-tip="${esc(tip)}">${label}<kbd>${key}</kbd></button>`;
    let h = `<div class="tools">${tb('road', '🛤️ Road', 'R', 'Road: serfs only carry goods along roads. Each tile needs 1 stone.')}${tb('field', '🌾 Field', 'F', 'Corn field for a farm (radius 6).')}${tb('wine', '🍇 Vines', 'V', 'Wine field for a vineyard (radius 6).')}${tb('demolish', '✖ Remove', 'X', 'Demolish your buildings, roads, plans and fields.')}</div>`;
    for (const grp of BUILD_GROUPS) {
      h += `<div class="bgroup"><div class="gh">${grp}</div><div class="bgrid">`;
      for (const type of BUILDING_LIST) {
        const d = BUILDINGS[type];
        if (d.group !== grp) continue;
        const on = tool && tool.kind === 'build' && tool.type === type;
        const tip = `${d.name} — ${d.desc} Cost: ${d.cost.wood || 0} timber, ${d.cost.stone || 0} stone.` +
          (d.worker ? ` Worker: ${CITIZENS[d.worker].name}.` : '') +
          (d.inputs.length && d.kind !== 'barracks' ? ` Needs: ${d.inputs.map(g => GOODS[g].name).join(', ')}.` : '') +
          (d.outputs.length ? ` Makes: ${d.outputs.map(g => GOODS[g].name).join(', ')}.` : '');
        h += `<button class="bbtn ${on ? 'on' : ''}" data-act="build" data-v="${type}" data-tip="${esc(tip)}"><img src="${this.iconFor(type)}" alt=""><span>${esc(d.name)}</span><small>${GOODS.wood.icon}${d.cost.wood || 0} ${GOODS.stone.icon}${d.cost.stone || 0}</small></button>`;
      }
      h += '</div></div>';
    }
    return h;
  }

  stockTab() {
    const w = this.world;
    const st = w.stockTotals(0);
    let h = '<div class="sect">Storehouse stock</div><div class="stock">';
    for (const g of GOOD_LIST) h += `<div class="sg ${st[g] ? '' : 'zero'}" data-tip="${esc(GOODS[g].name)}">${GOODS[g].icon}<b>${st[g] || 0}</b></div>`;
    h += '</div><div class="sect">Citizens</div><div class="stock">';
    const c = w.countUnits(0);
    for (const t of CITIZEN_LIST) h += `<div class="sg ${c[t] ? '' : 'zero'}" data-tip="${esc(CITIZENS[t].name + ': ' + CITIZENS[t].desc)}">${CITIZENS[t].icon}<b>${c[t] || 0}</b></div>`;
    h += '</div>';
    // Buildings missing workers
    const missing = [...w.buildings.values()].filter(b => b.owner === 0 && b.state === 'done' && b.def.worker && !b.worker);
    if (missing.length) {
      h += '<div class="sect warn">Waiting for workers</div>';
      for (const b of missing) h += `<div class="row link" data-act="goto-b" data-v="${b.id}">${esc(b.def.name)} needs a ${esc(CITIZENS[b.def.worker].name)} — train one at the School</div>`;
    }
    const p = w.players[0];
    h += `<div class="sect">Record</div><div class="row">Built ${p.stats.built} · Trained ${p.stats.trained} · Soldiers ${p.stats.soldiers} · Kills ${p.stats.kills} · Lost ${p.stats.lost}</div>`;
    return h;
  }

  armyTab() {
    const w = this.world;
    const gs = [...w.groups.values()].filter(g => g.owner === 0);
    let h = '<div class="sect">Your troops</div>';
    if (!gs.length) h += '<div class="row">No soldiers. Build a Barracks, make weapons and train recruits at the School.</div>';
    for (const g of gs) {
      let hp = 0, mx = 0, cond = 0;
      for (const id of g.members) { const u = w.units.get(id); if (u) { hp += u.hp; mx += u.maxHp; cond += u.cond; } }
      const n = g.members.length;
      const status = g.order.kind === 'idle' ? 'holding' : g.order.kind === 'move' ? 'marching' : 'attacking';
      h += `<div class="row link grp" data-act="group" data-v="${g.id}">${SOLDIERS[g.type].icon} <b>${n}× ${esc(SOLDIERS[g.type].name)}</b> <small>${status}</small>${this.miniBar(hp / mx)}${cond / n < 0.3 ? ' 🍖' : ''}</div>`;
    }
    h += '<div class="sect">Hotkeys</div><div class="row small">Tab: next group · G: halt · Shift-click: add to selection · Right-click: move / attack</div>';
    return h;
  }

  guideTab() {
    return `<div class="guide">
<p><b>Goal:</b> build an economy, raise an army and destroy the red enemy's storehouse, school and barracks along with all their soldiers.</p>
<p><b>Roads are everything.</b> Serfs only carry goods along roads. Every building's entrance (yellow marker) must connect to your road network.</p>
<p><b>Construction:</b> laborers level the site, serfs bring timber and stone, then the house goes up.</p>
<p><b>Workers</b> come from the <b>School</b> (1 gold chest each). A new workshop sits idle (red 👤) until the right worker exists.</p>
<p><b>Food:</b> everyone gets hungry. Keep the <b>Inn</b> stocked with bread, sausages, wine or fish.</p>
<p><b>Chains:</b><br>
Trees → Woodcutter → Sawmill → Timber<br>
Stone → Quarry<br>
Fields → Farm → Mill → Bakery → Bread<br>
Farm corn → Swine farm → Butcher → Sausages (+ skins → Tannery → Leather)<br>
Coal + Iron ore (mines on mountain seams) → Iron smelter → Smithies<br>
Gold ore + Coal → Metallurgist → Gold chests</p>
<p><b>Army:</b> recruits (School) go to the <b>Barracks</b>, which equips them with weapons & armor into soldiers. Pikes and lances beat horsemen.</p>
<p><b>Keys:</b> WASD scroll · wheel zoom · R road · F field · V vines · X remove · Space pause · 1/2/3 speed · H home · Esc cancel</p>
</div>`;
  }

  miniBar(f) {
    const col = f > 0.6 ? '#5fcf4a' : f > 0.3 ? '#e8c440' : '#e0483c';
    return `<span class="mbar"><i style="width:${Math.round(clamp(f, 0, 1) * 100)}%;background:${col}"></i></span>`;
  }

  buildingView(b) {
    const w = this.world, def = b.def;
    const mine = b.owner === 0;
    let h = `<div class="selhead"><img src="${this.iconFor(b.type)}" alt=""><div><b>${esc(def.name)}</b><br><small>${mine ? 'Yours' : 'Enemy'}${b.state === 'site' ? ' · under construction' : ''}</small></div><button class="x" data-act="deselect" title="Close">✕</button></div>`;
    h += `<div class="row">Condition ${this.miniBar(b.hp / b.maxHp)} ${Math.ceil(b.hp)}/${b.maxHp}</div>`;
    if (!mine) { h += `<div class="row small">${esc(def.desc)}</div>`; return h; }
    if (b.state === 'site') {
      const s = b.site;
      const conn = w.tileComps(w.players[0], b.door).length > 0;
      const cj = w.cjobs.get(s.cj);
      h += `<div class="row">Leveling ${this.miniBar(s.level)}</div>`;
      h += `<div class="row">Building ${this.miniBar(s.used / s.total)} ${s.used}/${s.total}</div>`;
      h += `<div class="row">${GOODS.wood.icon} ${s.delivered.wood}/${def.cost.wood || 0} &nbsp; ${GOODS.stone.icon} ${s.delivered.stone}/${def.cost.stone || 0}</div>`;
      if (!conn) h += `<div class="row warn">⚠ Entrance is not connected to a road yet.</div>`;
      else if (cj && !cj.laborer && s.level < 1) h += `<div class="row small">Waiting for a laborer…</div>`;
      h += `<button class="wide danger" data-act="demolish-b">Cancel construction</button>`;
      return h;
    }
    if (def.worker) {
      const wk = w.units.get(b.worker);
      h += `<div class="row">${CITIZENS[def.worker].icon} ${esc(CITIZENS[def.worker].name)}: ${wk ? (wk.inside === b.id ? 'at work' : 'on the way / outside') : '<span class="warn">none — train one at the School</span>'}</div>`;
    }
    const stockRow = (goods) => goods.map(g => `<span class="sg inl ${(b.stock[g] || 0) ? '' : 'zero'}" data-tip="${esc(GOODS[g].name)}">${GOODS[g].icon}<b>${b.stock[g] || 0}</b></span>`).join('');
    switch (def.kind) {
      case 'store': {
        h += '<div class="sect">Stock <small>(click to stop accepting)</small></div><div class="stock">';
        for (const g of GOOD_LIST) h += `<div class="sg ${b.stock[g] ? '' : 'zero'} ${b.blocked[g] ? 'blocked' : ''}" data-act="block" data-v="${g}" data-tip="${esc(GOODS[g].name + (b.blocked[g] ? ' (not accepted)' : ''))}">${GOODS[g].icon}<b>${b.stock[g] || 0}</b></div>`;
        h += '</div>';
        break;
      }
      case 'school': {
        h += `<div class="row">${GOODS.gold.icon} Gold here: <b>${b.stock.gold || 0}</b> <small>(storehouse: ${w.stockTotals(0).gold || 0})</small></div>`;
        if (b.train) h += `<div class="row">Training ${CITIZENS[b.train.type].icon} ${esc(CITIZENS[b.train.type].name)} ${this.miniBar(b.train.t / SCHOOL_TIME)} <button class="mini" data-act="school-cancel" data-v="-1">✕</button></div>`;
        h += `<div class="queue">${b.queue.map((t, k) => `<button class="qi" data-act="school-cancel" data-v="${k}" title="Cancel">${CITIZENS[t].icon}</button>`).join('')}${'<span class="qe"></span>'.repeat(QUEUE_MAX - b.queue.length)}</div>`;
        h += '<div class="sect">Train (1 gold each)</div><div class="ugrid">';
        const c = w.countUnits(0);
        for (const t of CITIZEN_LIST) h += `<button class="ubtn" data-act="school" data-v="${t}" data-tip="${esc(CITIZENS[t].name + ': ' + CITIZENS[t].desc)}">${CITIZENS[t].icon}<small>${esc(CITIZENS[t].name)}</small><i>${c[t] || 0}</i></button>`;
        h += '</div>';
        break;
      }
      case 'barracks': {
        h += `<div class="row">🪖 Recruits waiting: <b>${b.recruits}</b></div>`;
        h += `<div class="stock">${stockRow(WARFARE)}</div>`;
        if (b.train) h += `<div class="row">Equipping ${esc(SOLDIERS[b.train.type].name)}…</div>`;
        h += `<div class="queue">${b.queue.map((t, k) => `<button class="qi" data-act="train-cancel" data-v="${k}" title="Cancel">${SOLDIERS[t].icon}</button>`).join('')}${'<span class="qe"></span>'.repeat(Math.max(0, QUEUE_MAX - b.queue.length))}</div>`;
        h += '<div class="sect">Equip soldiers <small>(shift: ×5)</small></div><div class="ugrid">';
        for (const t of SOLDIER_LIST) {
          const sd = SOLDIERS[t];
          const ok = w.canEquip(b, t);
          const tip = `${sd.name}: HP ${sd.hp}, attack ${sd.atk}, armor ${Math.round(sd.arm * 100)}%${sd.ranged ? ', ranged' : ''}${sd.mounted ? ', mounted' : ''}${sd.bonusMounted ? ', strong vs horsemen' : ''}. Needs: recruit + ${sd.needs.map(g => GOODS[g].name).join(', ')}.`;
          h += `<button class="ubtn ${ok ? '' : 'dim'}" data-act="train" data-v="${t}" data-tip="${esc(tip)}">${sd.icon}<small>${esc(sd.name)}</small><i>${sd.needs.map(g => GOODS[g].icon).join('')}</i></button>`;
        }
        h += '</div>';
        if (!b.recruits) h += '<div class="row small">Train Recruits at the School — they walk here automatically.</div>';
        break;
      }
      case 'inn': h += `<div class="sect">Food</div><div class="stock">${stockRow(FOOD_LIST)}</div>`; break;
      case 'tower': {
        const gu = w.units.get(b.guard);
        h += `<div class="row">Guard: ${gu && gu.inside === b.id ? '🪖 on watch' : '<span class="warn">none — needs a Recruit</span>'}</div><div class="stock">${stockRow(['stone'])}</div>`;
        break;
      }
      default: {
        if (def.inputs.length) h += `<div class="sect">Input</div><div class="stock">${stockRow(def.inputs)}</div>`;
        h += `<div class="sect">Output</div><div class="stock">${stockRow(def.outputs)}</div>`;
        if (def.recipes && def.recipes.length > 1) {
          h += '<div class="sect">Production <small>(click to toggle)</small></div><div class="ugrid">';
          def.recipes.forEach((r, k) => {
            const og = Object.keys(r.out)[0];
            h += `<button class="ubtn ${b.orders[k] ? 'on' : 'dim'}" data-act="order" data-v="${k}" data-tip="${esc(GOODS[og].name + ' from ' + Object.keys(r.in).map(g => GOODS[g].name).join(' + '))}">${GOODS[og].icon}<small>${esc(GOODS[og].name)}</small><i>${b.orders[k] ? 'on' : 'off'}</i></button>`;
          });
          h += '</div>';
        }
        if (def.kind === 'farm') {
          let n = 0;
          w.map.forRadius(b.x + b.w / 2, b.y + b.h / 2, def.radius, i => { if (w.map.field[i] === def.field && w.map.fieldOwner[i] === 0) n++; });
          h += `<div class="row ${n ? '' : 'warn'}">${n} ${def.field === 1 ? 'corn' : 'wine'} fields in reach${n ? '' : ' — lay some with the ' + (def.field === 1 ? 'Field (F)' : 'Vines (V)') + ' tool'}</div>`;
        }
      }
    }
    h += `<button class="wide danger" data-act="demolish-b">Demolish</button>`;
    return h;
  }

  unitView(u) {
    const w = this.world;
    const isS = u.kind === 'soldier';
    const name = isS ? SOLDIERS[u.type].name : CITIZENS[u.type].name;
    let h = `<div class="selhead"><span class="big">${isS ? SOLDIERS[u.type].icon : CITIZENS[u.type].icon}</span><div><b>${esc(name)}</b><br><small>${u.owner === 0 ? 'Yours' : 'Enemy'}</small></div><button class="x" data-act="deselect">✕</button></div>`;
    h += `<div class="row">Health ${this.miniBar(u.hp / u.maxHp)}</div><div class="row">Condition ${this.miniBar(u.cond)} ${u.cond < HUNGRY ? '🍖 hungry' : ''}</div>`;
    if (u.owner === 0 && !isS) {
      const j = u.job;
      let what = 'Idle';
      if (u.inside) what = 'Inside a building';
      else if (j) what = { deliver: `Carrying ${u.carry ? GOODS[u.carry].name : 'goods'}`, build: 'Building', eat: 'Going to eat', gohome: 'Going to work', work: 'Working', enlist: 'Joining the barracks', return: 'Returning goods', wander: 'Idle' }[j.kind] || j.kind;
      h += `<div class="row">${esc(what)}</div><div class="row small">${esc(CITIZENS[u.type].desc)}</div>`;
    }
    return h;
  }

  groupView() {
    const w = this.world;
    const gs = [...this.state.selGroups].map(id => w.groups.get(id)).filter(Boolean);
    let n = 0, hp = 0, mx = 0, cond = 0;
    for (const g of gs) for (const id of g.members) { const u = w.units.get(id); if (u) { n++; hp += u.hp; mx += u.maxHp; cond += u.cond; } }
    const g0 = gs[0];
    const sd = SOLDIERS[g0.type];
    const title = gs.length === 1 ? `${n}× ${sd.name}` : `${gs.length} groups · ${n} soldiers`;
    let h = `<div class="selhead"><span class="big">${sd.icon}</span><div><b>${esc(title)}</b><br><small>${gs.length === 1 ? `HP ${sd.hp} · Atk ${sd.atk} · Armor ${Math.round(sd.arm * 100)}%${sd.ranged ? ' · Ranged' : ''}` : 'Mixed army'}</small></div><button class="x" data-act="deselect">✕</button></div>`;
    h += `<div class="row">Health ${this.miniBar(hp / mx)}</div><div class="row">Condition ${this.miniBar(cond / n)} ${cond / n < 0.3 ? '<span class="warn">hungry</span>' : ''}</div>`;
    h += `<div class="cmds">
      <button data-act="gcmd" data-v="halt" data-tip="Stop and regroup (G)">✋ Halt</button>
      <button data-act="gcmd" data-v="split" data-tip="Split the group in two">✂ Split</button>
      <button data-act="gcmd" data-v="join" data-tip="Then click another group of yours to merge">🔗 Join</button>
      <button data-act="gcmd" data-v="feed" data-tip="Send soldiers to the inn to eat">🍖 Feed</button>
      <button data-act="gcmd" data-v="form" data-arg="-1" data-tip="Fewer columns (deeper formation)">⇤ Narrow</button>
      <button data-act="gcmd" data-v="form" data-arg="1" data-tip="More columns (wider formation)">⇥ Widen</button>
      <button data-act="gcmd" data-v="turn" data-arg="-1" data-tip="Turn left">↺ Turn</button>
      <button data-act="gcmd" data-v="turn" data-arg="1" data-tip="Turn right">↻ Turn</button></div>`;
    h += '<div class="row small">Right-click ground to march, an enemy to attack, or an enemy building to storm it.</div>';
    return h;
  }
}
