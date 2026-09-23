// ---------------------------------------------------------------------------
// Classic top-down canvas renderer ("2D"). Implements the renderer contract in
// src/render/renderer.js. Reads the world and UI state, never writes to them.
// ---------------------------------------------------------------------------
import { BUILDINGS, CITIZENS, GOODS, PLAYER_COLORS, SOLDIERS, TICK } from '../core/data.js';
import { T_MOUNTAIN, T_WATER } from '../core/map.js';
import { clamp, dist, hash2, lerp } from '../core/util.js';
import { SPR, TOP, makeBuildingSprite, makeStoneSprite, makeTreeSprite, paintTileOverlay, renderTerrainChunk } from './art2d.js';
import { TILE } from './common.js';

export class Renderer2D {
  constructor(stage, world) {
    this.kind = '2d';
    this.stage = stage;
    const canvas = document.createElement('canvas');
    canvas.className = 'view';
    stage.prepend(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: 20, y: 70, zoom: 1 };
    this.chunks = new Map();     // key -> { canvas, ver }
    this.trees = [];
    this.stones = [];
    this.bsprites = new Map();
    this.smoke = [];
    this.flashes = [];           // ground flashes for order feedback
    this.floaters = [];          // rising production icons
    this.time = 0;
    for (let s = 1; s <= 5; s++) { this.trees[s] = []; for (let v = 0; v < 3; v++) this.trees[s][v] = makeTreeSprite(s, v); }
    for (let s = 0; s < 3; s++) { this.stones[s] = []; for (let v = 0; v < 3; v++) this.stones[s][v] = makeStoneSprite(s, v); }
    this.resize();
  }

  setWorld(w) { this.world = w; this.chunks.clear(); }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cw * dpr);
    this.canvas.height = Math.round(this.ch * dpr);
    this.dpr = dpr;
  }

  get scale() { return TILE * this.cam.zoom; }
  // h lifts the point by h tiles (drawn as screen-up in this view)
  toScreen(tx, ty, h = 0) { const s = this.scale; return [(tx - this.cam.x) * s + this.cw / 2, (ty - h - this.cam.y) * s + this.ch / 2]; }
  toWorld(sx, sy) { const s = this.scale; return [(sx - this.cw / 2) / s + this.cam.x, (sy - this.ch / 2) / s + this.cam.y]; }
  // --- renderer contract -------------------------------------------------
  pxPerTile() { return this.scale; }
  panBy(dx, dy) { this.cam.x -= dx / this.scale; this.cam.y -= dy / this.scale; }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * f, 0.45, 2.2);
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny;
  }
  pickBuilding() { return 0; } // the UI falls back to the tile under the cursor
  viewPolygon() { return [this.toWorld(0, 0), this.toWorld(this.cw, 0), this.toWorld(this.cw, this.ch), this.toWorld(0, this.ch)]; }
  dispose() { this.canvas.remove(); }

  clampCam() {
    const m = this.world.map;
    this.cam.zoom = clamp(this.cam.zoom, 0.45, 2.2);
    const hw = this.cw / 2 / this.scale, hh = this.ch / 2 / this.scale;
    this.cam.x = clamp(this.cam.x, Math.min(hw, m.W / 2), Math.max(m.W - hw, m.W / 2));
    this.cam.y = clamp(this.cam.y, Math.min(hh, m.H / 2), Math.max(m.H - hh, m.H / 2));
  }

  buildingSprite(type, owner) {
    const k = type + owner;
    let s = this.bsprites.get(k);
    if (!s) { s = makeBuildingSprite(type, PLAYER_COLORS[owner].main); this.bsprites.set(k, s); }
    return s;
  }

  chunk(cx, cy) {
    const m = this.world.map;
    const k = cy * 64 + cx;
    const ver = m.version[cy * Math.ceil(m.W / 16) + cx];
    let c = this.chunks.get(k);
    if (!c || c.ver !== ver) {
      if (this.budget <= 0 && c) return c.canvas;
      if (this.budget <= 0) return null;
      this.budget--;
      c = { canvas: renderTerrainChunk(m, cx, cy, this.world.seed), ver };
      this.chunks.set(k, c);
    }
    return c.canvas;
  }

  // ------------------------------------------------------------------ frame
  draw(alpha, ui, dt) {
    const w = this.world, m = w.map, ctx = this.ctx;
    this.time += dt;
    this.clampCam();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#1b2414';
    ctx.fillRect(0, 0, this.cw, this.ch);
    const s = this.scale;
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(this.cw, this.ch);
    const tx0 = Math.max(0, Math.floor(wx0) - 1), ty0 = Math.max(0, Math.floor(wy0) - 1);
    const tx1 = Math.min(m.W - 1, Math.ceil(wx1) + 1), ty1 = Math.min(m.H - 1, Math.ceil(wy1) + 3);
    this.view = { tx0, ty0, tx1, ty1 };

    // terrain
    this.budget = this.chunks.size === 0 ? 40 : 2;
    ctx.imageSmoothingEnabled = true;
    for (let cy = ty0 >> 4; cy <= ty1 >> 4; cy++) for (let cx = tx0 >> 4; cx <= tx1 >> 4; cx++) {
      const c = this.chunk(cx, cy);
      const [sx, sy] = this.toScreen(cx * 16, cy * 16);
      if (c) ctx.drawImage(c, sx, sy, 16 * s + 0.5, 16 * s + 0.5);
      else { ctx.fillStyle = '#4c6a33'; ctx.fillRect(sx, sy, 16 * s, 16 * s); }
    }

    if (this.budget > 0 && this.chunks.size < Math.ceil(m.W / 16) * Math.ceil(m.H / 16)) {
      for (let cy = 0; cy < Math.ceil(m.H / 16) && this.budget > 0; cy++) for (let cx = 0; cx < Math.ceil(m.W / 16); cx++) {
        if (!this.chunks.has(cy * 64 + cx)) { this.budget = 1; this.chunk(cx, cy); this.budget = 0; break; }
      }
    }
    this.drawGround(tx0, ty0, tx1, ty1, ui);
    this.drawObjects(tx0, ty0, tx1, ty1, alpha, ui);
    this.drawProjectiles(alpha);
    this.drawFloaters(dt);
    this.drawOverlay(ui, alpha);
  }

  drawGround(tx0, ty0, tx1, ty1, ui) {
    const w = this.world, m = w.map, ctx = this.ctx, s = this.scale, W = m.W;
    const t = this.time;
    const ox = this.cw / 2 - this.cam.x * s, oy = this.ch / 2 - this.cam.y * s;
    // Water shimmer: one batched path, skipped when zoomed far out.
    if (s >= 18) {
      ctx.strokeStyle = 'rgba(200,230,255,0.16)';
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const i = y * W + x;
        if (m.terrain[i] !== T_WATER) continue;
        const h = hash2(x, y, 4);
        if (Math.sin(t * 1.3 + h * 6.28) < 0.2) continue;
        const sx = x * s + ox + ((t * 0.15 + hash2(x, y, 5)) % 1) * s * 0.4, sy = y * s + oy;
        ctx.moveTo(sx + s * 0.15, sy + s * 0.4);
        ctx.quadraticCurveTo(sx + s * 0.3, sy + s * 0.32, sx + s * 0.45, sy + s * 0.4);
      }
      ctx.stroke();
    }
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = y * W + x;
      if (!m.field[i] && !m.road[i] && !m.plan[i]) continue;
      paintTileOverlay(ctx, m, i, x, y, x * s + ox, y * s + oy, s, ui.showEnemyPlans);
    }
    // building foundations for sites and rubble
    for (const e of w.effects) {
      if (e.kind !== 'rubble') continue;
      const [sx, sy] = this.toScreen(e.x, e.y);
      const a = 1 - e.t / e.dur;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#5a5246';
      ctx.fillRect(sx + s * 0.1, sy + s * 0.2, e.w * s - s * 0.2, e.h * s - s * 0.3);
      for (let k = 0; k < e.w * e.h * 3; k++) {
        ctx.fillStyle = k % 2 ? '#7d7466' : '#3e3830';
        const rx = hash2(e.x + k, e.y, 1) * e.w, ry = hash2(e.x, e.y + k, 2) * e.h;
        ctx.fillRect(sx + rx * s, sy + ry * s, s * 0.18, s * 0.12);
      }
      ctx.globalAlpha = 1;
    }
  }

  // --------------------------------------------------------- depth sorted
  drawObjects(tx0, ty0, tx1, ty1, alpha, ui) {
    const w = this.world, m = w.map, ctx = this.ctx, s = this.scale, W = m.W;
    const list = [];
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = y * W + x;
      if (m.tree[i]) list.push({ y: y + 0.8, k: 0, i, x, ty: y });
      else if (m.stone[i]) list.push({ y: y + 0.7, k: 1, i, x, ty: y });
    }
    for (const b of w.buildings.values()) {
      if (b.x + b.w < tx0 - 1 || b.x > tx1 + 1 || b.y + b.h < ty0 - 1 || b.y > ty1 + 3) continue;
      list.push({ y: b.y + b.h - 0.05, k: 2, b });
    }
    for (const u of w.units.values()) {
      if (u.inside) continue;
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      if (x < tx0 - 1 || x > tx1 + 1 || y < ty0 - 1 || y > ty1 + 2) continue;
      list.push({ y, k: 3, u, x });
    }
    for (const e of w.effects) {
      if (e.kind === 'corpse') list.push({ y: e.y - 0.3, k: 4, e });
      else if (e.kind === 'fall') list.push({ y: e.y + 0.2, k: 5, e });
    }
    list.sort((a, b) => a.y - b.y);
    for (const o of list) {
      switch (o.k) {
        case 0: {
          const st = m.tree[o.i], v = Math.floor(hash2(o.x, o.ty, 8) * 3);
          const spr = this.trees[st][v];
          const sc = s / SPR;
          const jx = (hash2(o.x, o.ty, 9) - 0.5) * 0.3, jy = (hash2(o.x, o.ty, 10) - 0.5) * 0.2;
          const sx = (o.x + 0.5 + jx - this.cam.x) * s + this.cw / 2, sy = (o.ty + 0.85 + jy - this.cam.y) * s + this.ch / 2;
          ctx.drawImage(spr, sx - spr.width * sc / 2, sy - spr.height * sc + SPR * 0.25 * sc, spr.width * sc, spr.height * sc);
          break;
        }
        case 1: {
          const a = m.stone[o.i], sz = a >= 8 ? 2 : a >= 4 ? 1 : 0;
          const spr = this.stones[sz][Math.floor(hash2(o.x, o.ty, 11) * 3)];
          const sc = s / SPR;
          const [sx, sy] = this.toScreen(o.x + 0.5, o.ty + 0.5);
          ctx.drawImage(spr, sx - spr.width * sc / 2, sy - spr.height * sc * 0.62, spr.width * sc, spr.height * sc);
          break;
        }
        case 2: this.drawBuilding(o.b, ui); break;
        case 3: this.drawUnit(o.u, o.x, o.y, ui); break;
        case 4: this.drawCorpse(o.e); break;
        case 5: this.drawFallingTree(o.e); break;
      }
    }
    // smoke particles float above everything else in the scene
    this.drawSmoke();
    for (const e of w.effects) {
      if (e.kind === 'dust') {
        const [sx, sy] = this.toScreen(e.x, e.y);
        const k = e.t / e.dur;
        ctx.fillStyle = `rgba(150,130,100,${0.45 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(sx, sy - k * s * 0.4, s * (0.12 + k * 0.25), 0, 7); ctx.fill();
      } else if (e.kind === 'spark') {
        const [sx, sy] = this.toScreen(e.x, e.y);
        const k = e.t / e.dur;
        ctx.strokeStyle = `rgba(255,${230 - k * 120},120,${1 - k})`;
        ctx.lineWidth = Math.max(1, s * 0.04);
        for (let a = 0; a < 4; a++) {
          const ang = a * 1.57 + e.x * 10;
          ctx.beginPath(); ctx.moveTo(sx + Math.cos(ang) * s * 0.05, sy + Math.sin(ang) * s * 0.05);
          ctx.lineTo(sx + Math.cos(ang) * s * (0.12 + k * 0.15), sy + Math.sin(ang) * s * (0.12 + k * 0.15)); ctx.stroke();
        }
      }
    }
  }

  drawBuilding(b, ui) {
    const ctx = this.ctx, s = this.scale;
    const spr = this.buildingSprite(b.type, b.owner);
    const sc = s / SPR;
    const [sx, sy] = this.toScreen(b.x, b.y - TOP);
    const [fx, fy] = this.toScreen(b.x, b.y);
    const selected = ui.selBuilding === b.id;
    if (b.state === 'site') {
      // leveled ground
      const lv = b.site.level;
      ctx.fillStyle = `rgba(120,92,58,${0.35 + lv * 0.5})`;
      ctx.fillRect(fx + s * 0.05, fy + s * 0.05, b.w * s - s * 0.1, b.h * s - s * 0.1);
      ctx.strokeStyle = 'rgba(250,240,200,0.7)'; ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.strokeRect(fx + s * 0.08, fy + s * 0.08, b.w * s - s * 0.16, b.h * s - s * 0.16);
      for (const [px, py] of [[0, 0], [b.w, 0], [0, b.h], [b.w, b.h]]) {
        ctx.fillStyle = '#5a3a1c'; ctx.fillRect(fx + px * s - s * 0.06 + (px ? -s * 0.02 : s * 0.02), fy + py * s - s * 0.2 + (py ? 0 : s * 0.1), s * 0.06, s * 0.2);
      }
      const prog = b.site.used / b.site.total;
      if (prog > 0) {
        const h = spr.height * sc;
        const vis = h * (0.15 + prog * 0.85);
        ctx.save();
        ctx.beginPath(); ctx.rect(sx - 2, sy + h - vis, spr.width * sc + 4, vis); ctx.clip();
        ctx.globalAlpha = 0.9;
        ctx.drawImage(spr, sx, sy, spr.width * sc, h);
        ctx.restore();
        // scaffolding
        ctx.strokeStyle = '#7a5530'; ctx.lineWidth = Math.max(1, s * 0.05);
        const top = sy + h - vis;
        for (let k = 0; k <= b.w; k++) { const x = fx + k * s * 0.98 + s * 0.01; ctx.beginPath(); ctx.moveTo(x, fy + b.h * s); ctx.lineTo(x, top - s * 0.1); ctx.stroke(); }
        for (let yy = fy + b.h * s - s * 0.4; yy > top; yy -= s * 0.45) { ctx.beginPath(); ctx.moveTo(fx, yy); ctx.lineTo(fx + b.w * s, yy); ctx.stroke(); }
      }
      // material piles by the door
      const wood = b.site.delivered.wood, stone = b.site.delivered.stone;
      const usedW = Math.min(wood, Math.round(b.site.used * (b.def.cost.wood || 0) / b.site.total));
      const [dx, dy] = this.toScreen(b.dx, b.dy);
      for (let k = 0; k < Math.min(5, wood - usedW); k++) { ctx.fillStyle = '#c9964f'; ctx.fillRect(dx - s * 0.4, dy - s * 0.1 - k * s * 0.07, s * 0.35, s * 0.06); }
      for (let k = 0; k < Math.min(5, stone - (b.site.used - usedW)); k++) { ctx.fillStyle = '#a8a49a'; ctx.fillRect(dx + s * 0.95 + (k % 2) * s * 0.12, dy - s * 0.12 - Math.floor(k / 2) * s * 0.1, s * 0.14, s * 0.1); }
    } else {
      if (selected) {
        ctx.fillStyle = 'rgba(255,240,150,0.18)';
        ctx.fillRect(fx, fy, b.w * s, b.h * s);
      }
      ctx.drawImage(spr, sx, sy, spr.width * sc, spr.height * sc);
      // windmill blades
      if (spr.meta.hub) {
        const hx = sx + spr.meta.hub.x * s, hy = sy + spr.meta.hub.y * s;
        const ang = this.time * (b.active > 0 ? 1.6 : 0.2) + b.id;
        ctx.strokeStyle = '#4a3420'; ctx.lineWidth = Math.max(1, s * 0.05);
        for (let k = 0; k < 4; k++) {
          const a = ang + k * Math.PI / 2;
          const ex = hx + Math.cos(a) * s * 0.9, ey = hy + Math.sin(a) * s * 0.9;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.fillStyle = 'rgba(235,225,200,0.85)';
          ctx.save(); ctx.translate(hx, hy); ctx.rotate(a);
          ctx.fillRect(s * 0.2, 0, s * 0.68, s * 0.16);
          ctx.restore();
        }
        ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(hx, hy, s * 0.07, 0, 7); ctx.fill();
      }
      if (b.active > 0 && spr.meta.chimney && hash2(b.id, Math.floor(this.time * 6), 1) < 0.35) {
        this.smoke.push({ x: b.x + spr.meta.chimney.x, y: b.y - TOP + spr.meta.chimney.y, t: 0, dur: 2.2, vx: 0.15 + Math.random() * 0.1 });
      }
      // status badges
      if (b.def.worker && !b.worker && b.owner === 0) this.badge(fx + b.w * s / 2, fy - s * 0.2, '👤', '#d9534f');
      else if (b.def.kind === 'tower' && !b.guard && b.owner === 0) this.badge(fx + b.w * s / 2, fy - s * 0.2, '👤', '#d9534f');
    }
    if (b.hp < b.maxHp * 0.999 && (b.state === 'done' || this.world.time - b.lastHit < 5)) {
      const frac = b.state === 'site' ? b.hp / b.maxHp : b.hp / b.maxHp;
      this.bar(fx + b.w * s / 2, fy + b.h * s + s * 0.1, b.w * s * 0.6, frac);
    }
    if (b.state === 'done' && this.world.time - b.lastHit < 2 && b.hp < b.maxHp * 0.5) {
      if (Math.random() < 0.3) this.smoke.push({ x: b.x + Math.random() * b.w, y: b.y + Math.random() * b.h * 0.5, t: 0, dur: 1.5, vx: 0.1, dark: true });
    }
  }

  badge(x, y, txt, col) {
    const ctx = this.ctx, s = this.scale;
    const r = Math.max(7, s * 0.22);
    const bob = Math.sin(this.time * 3) * r * 0.15;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y + bob, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = `${Math.round(r * 1.1)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y + bob + 1);
  }

  bar(cx, y, w, frac, col) {
    const ctx = this.ctx;
    const h = Math.max(3, this.scale * 0.08);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = col || (frac > 0.6 ? '#5fcf4a' : frac > 0.3 ? '#e8c440' : '#e0483c');
    ctx.fillRect(cx - w / 2, y, w * clamp(frac, 0, 1), h);
  }

  drawSmoke() {
    const ctx = this.ctx, s = this.scale, dt = 1 / 60;
    const keep = [];
    for (const p of this.smoke) {
      p.t += dt;
      if (p.t > p.dur) continue;
      keep.push(p);
      const k = p.t / p.dur;
      const [sx, sy] = this.toScreen(p.x + p.vx * p.t, p.y - p.t * 0.5);
      ctx.fillStyle = p.dark ? `rgba(40,35,30,${0.5 * (1 - k)})` : `rgba(220,220,220,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(sx, sy, s * (0.08 + k * 0.22), 0, 7); ctx.fill();
    }
    this.smoke = keep.length > 300 ? keep.slice(-300) : keep;
  }

  drawCorpse(e) {
    const ctx = this.ctx, s = this.scale;
    const [sx, sy] = this.toScreen(e.x, e.y);
    const a = Math.min(1, (e.dur - e.t) / 5);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = 'rgba(90,20,15,0.5)';
    ctx.beginPath(); ctx.ellipse(sx, sy, s * 0.22, s * 0.1, 0, 0, 7); ctx.fill();
    ctx.fillStyle = PLAYER_COLORS[e.owner].dark;
    ctx.fillRect(sx - s * 0.2, sy - s * 0.07, s * 0.3, s * 0.12);
    ctx.fillStyle = '#e0b890';
    ctx.beginPath(); ctx.arc(sx + s * 0.16, sy - s * 0.01, s * 0.07, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawFallingTree(e) {
    const ctx = this.ctx, s = this.scale;
    const [sx, sy] = this.toScreen(e.x, e.y + 0.3);
    const k = Math.min(1, e.t / 0.8);
    ctx.save();
    ctx.globalAlpha = 1 - Math.max(0, (e.t - 0.8) / 0.4);
    ctx.translate(sx, sy);
    ctx.rotate(k * k * 1.45);
    ctx.fillStyle = '#5e3d20'; ctx.fillRect(-s * 0.05, -s * 1.0, s * 0.1, s * 1.0);
    ctx.fillStyle = '#3b7030'; ctx.beginPath(); ctx.arc(0, -s * 1.0, s * 0.4, 0, 7); ctx.fill();
    ctx.restore();
  }

  // ----------------------------------------------------------------- units
  drawUnit(u, x, y, ui) {
    const ctx = this.ctx, s = this.scale;
    const [sx, sy0] = this.toScreen(x, y);
    const jitter = (hash2(u.id, 0, 3) - 0.5) * s * 0.18;
    const sx2 = sx + jitter;
    const sel = ui.selGroups.has(u.group) || ui.selUnit === u.id;
    const pc = PLAYER_COLORS[u.owner];
    const soldier = u.kind === 'soldier';
    const sd = soldier ? SOLDIERS[u.type] : null;
    const mounted = sd && sd.mounted;
    const sz = s * 0.5;
    const flip = Math.cos(u.dir) < -0.1 ? -1 : 1;
    const walk = u.moving ? Math.sin((this.time * 9 + u.walkPhase)) : 0;
    const sy = sy0 + s * 0.2;

    if (sel) {
      ctx.strokeStyle = u.owner === 0 ? 'rgba(255,255,140,0.95)' : 'rgba(255,120,100,0.95)';
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.beginPath(); ctx.ellipse(sx2, sy, sz * 0.6, sz * 0.28, 0, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(sx2, sy, sz * (mounted ? 0.7 : 0.4), sz * 0.16, 0, 0, 7); ctx.fill();

    ctx.save();
    ctx.translate(sx2, sy);
    ctx.scale(flip, 1);
    const L = sz; // unit length scale
    let base = 0;
    if (mounted) {
      // horse
      const hb = Math.abs(walk) * L * 0.05;
      ctx.strokeStyle = '#4a3020'; ctx.lineWidth = Math.max(1, L * 0.09);
      for (const [lx, ph] of [[-0.35, 0], [-0.2, 1.5], [0.22, 3], [0.36, 4.5]]) {
        const sw = u.moving ? Math.sin(this.time * 9 + u.walkPhase + ph) * L * 0.12 : 0;
        ctx.beginPath(); ctx.moveTo(L * lx, -L * 0.35); ctx.lineTo(L * lx + sw, 0); ctx.stroke();
      }
      ctx.fillStyle = u.type === 'knight' ? '#e8e2d4' : '#7b5230';
      ctx.beginPath(); ctx.ellipse(0, -L * 0.45 - hb, L * 0.45, L * 0.18, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(L * 0.3, -L * 0.5 - hb); ctx.lineTo(L * 0.52, -L * 0.8 - hb); ctx.lineTo(L * 0.62, -L * 0.72 - hb); ctx.lineTo(L * 0.42, -L * 0.42 - hb); ctx.fill();
      if (u.type === 'knight') { ctx.fillStyle = pc.main; ctx.fillRect(-L * 0.35, -L * 0.52 - hb, L * 0.55, L * 0.2); }
      base = -L * 0.5 - hb;
    } else {
      // legs
      ctx.strokeStyle = '#3a2c20'; ctx.lineWidth = Math.max(1, L * 0.11);
      ctx.beginPath(); ctx.moveTo(-L * 0.07, -L * 0.35); ctx.lineTo(-L * 0.07 + walk * L * 0.14, 0);
      ctx.moveTo(L * 0.07, -L * 0.35); ctx.lineTo(L * 0.07 - walk * L * 0.14, 0); ctx.stroke();
      base = -L * 0.3;
    }
    const bob = u.moving ? Math.abs(walk) * L * 0.04 : 0;
    const by = base - bob;
    // body
    const tunic = soldier ? pc.main : CITIZENS[u.type].tunic;
    const iron = soldier && (u.type === 'swordsman' || u.type === 'pikeman' || u.type === 'crossbowman' || u.type === 'knight');
    ctx.fillStyle = tunic;
    ctx.beginPath();
    ctx.moveTo(-L * 0.17, by); ctx.lineTo(L * 0.17, by); ctx.lineTo(L * 0.13, by - L * 0.5); ctx.lineTo(-L * 0.13, by - L * 0.5); ctx.closePath(); ctx.fill();
    if (iron) { ctx.fillStyle = 'rgba(200,205,215,0.85)'; ctx.fillRect(-L * 0.13, by - L * 0.48, L * 0.26, L * 0.26); }
    else if (soldier && u.type !== 'militia') { ctx.fillStyle = 'rgba(120,80,45,0.8)'; ctx.fillRect(-L * 0.13, by - L * 0.46, L * 0.26, L * 0.22); }
    if (!soldier) { ctx.fillStyle = pc.main; ctx.fillRect(-L * 0.16, by - L * 0.2, L * 0.32, L * 0.07); }
    // head
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath(); ctx.arc(0, by - L * 0.62, L * 0.13, 0, 7); ctx.fill();
    if (soldier) {
      ctx.fillStyle = iron ? '#c8ccd4' : u.type === 'militia' ? '#6b4a2a' : '#8a8a80';
      ctx.beginPath(); ctx.arc(0, by - L * 0.66, L * 0.14, Math.PI, 0); ctx.fill();
    } else {
      ctx.fillStyle = u.type === 'serf' ? '#8a6a40' : u.type === 'laborer' ? '#caa040' : pc.dark;
      ctx.beginPath(); ctx.arc(0, by - L * 0.68, L * 0.13, Math.PI, 0); ctx.fill();
    }
    // arms / tools / weapons
    const swing = u.act ? Math.sin(this.time * (u.act === 'fight' ? 12 : 8) + u.id) : 0;
    ctx.lineCap = 'round';
    if (soldier) this.drawWeapon(u, L, by, swing);
    else this.drawTool(u, L, by, swing);
    ctx.restore();

    // carried goods
    if (u.carry && u.carry !== 'grapes') {
      const gc = GOODS[u.carry] ? GOODS[u.carry].color : '#6a2a6a';
      ctx.fillStyle = gc;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      const cy = sy + base - bob - L * 1.02;
      ctx.fillRect(sx2 - L * 0.15, cy, L * 0.3, L * 0.22);
      ctx.strokeRect(sx2 - L * 0.15, cy, L * 0.3, L * 0.22);
    } else if (u.carry === 'grapes') {
      ctx.fillStyle = '#5a1f5a';
      ctx.beginPath(); ctx.arc(sx2, sy + base - L * 0.95, L * 0.12, 0, 7); ctx.fill();
    }
    if (soldier && (sel || u.hp < u.maxHp)) this.bar(sx2, sy + base - L * 1.05, L * 0.8, u.hp / u.maxHp);
    if (sel && u.cond < 0.3) this.badge(sx2 + L * 0.5, sy + base - L * 1.2, '🍖', '#b86a1a');
  }

  drawTool(u, L, by, swing) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#e8c39a'; ctx.lineWidth = Math.max(1, L * 0.08);
    const act = u.act;
    const hx = L * 0.14, hy = by - L * 0.38;
    if (act === 'hammer' || act === 'chop' || act === 'mine' || act === 'dig') {
      const a = -1.2 + swing * 0.9;
      const ex = hx + Math.cos(a) * L * 0.4, ey = hy + Math.sin(a) * L * 0.4;
      ctx.beginPath(); ctx.moveTo(hx - L * 0.05, hy); ctx.lineTo(hx + L * 0.05, hy + L * 0.02); ctx.stroke();
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = Math.max(1, L * 0.06);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = act === 'dig' ? '#8a8a80' : '#9aa0a8';
      ctx.beginPath(); ctx.arc(ex, ey, L * (act === 'dig' ? 0.1 : 0.08), 0, 7); ctx.fill();
    } else if (act === 'fish') {
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = Math.max(1, L * 0.05);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + L * 0.7, hy - L * 0.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx + L * 0.7, hy - L * 0.5); ctx.lineTo(hx + L * 0.8, hy + L * 0.4 + swing * L * 0.05); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-L * 0.14, by - L * 0.42); ctx.lineTo(-L * 0.18, by - L * 0.15); ctx.moveTo(L * 0.14, by - L * 0.42); ctx.lineTo(L * 0.18, by - L * 0.15); ctx.stroke();
    }
  }

  drawWeapon(u, L, by, swing) {
    const ctx = this.ctx, t = u.type;
    const hx = L * 0.15, hy = by - L * 0.36;
    const fighting = u.act === 'fight';
    const a = fighting ? -0.9 + swing * 1.1 : -0.5;
    ctx.lineWidth = Math.max(1, L * 0.06);
    if (t === 'lancer' || t === 'pikeman') {
      const len = t === 'pikeman' ? 1.3 : 1.05;
      const aa = fighting ? -0.2 + swing * 0.25 : -1.25;
      ctx.strokeStyle = '#6b4a2a';
      ctx.beginPath(); ctx.moveTo(hx - Math.cos(aa) * L * 0.3, hy - Math.sin(aa) * L * 0.3); ctx.lineTo(hx + Math.cos(aa) * L * len, hy + Math.sin(aa) * L * len); ctx.stroke();
      ctx.fillStyle = '#c8ccd4';
      ctx.beginPath(); ctx.arc(hx + Math.cos(aa) * L * len, hy + Math.sin(aa) * L * len, L * 0.05, 0, 7); ctx.fill();
    } else if (t === 'bowman' || t === 'crossbowman') {
      ctx.strokeStyle = t === 'bowman' ? '#7a4a22' : '#555';
      if (t === 'bowman') { ctx.beginPath(); ctx.arc(hx + L * 0.05, hy, L * 0.28, -1.2, 1.2); ctx.stroke(); ctx.strokeStyle = 'rgba(240,240,220,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + L * 0.05 + Math.cos(-1.2) * L * 0.28, hy + Math.sin(-1.2) * L * 0.28); ctx.lineTo(hx + L * 0.05 + Math.cos(1.2) * L * 0.28, hy + Math.sin(1.2) * L * 0.28); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(hx - L * 0.1, hy); ctx.lineTo(hx + L * 0.4, hy); ctx.moveTo(hx + L * 0.3, hy - L * 0.18); ctx.lineTo(hx + L * 0.3, hy + L * 0.18); ctx.stroke(); }
    } else {
      // axe or sword
      const len = t === 'swordsman' || t === 'knight' ? 0.55 : 0.45;
      const ex = hx + Math.cos(a) * L * len, ey = hy + Math.sin(a) * L * len;
      ctx.strokeStyle = t === 'swordsman' || t === 'knight' ? '#d8dce4' : '#6b4a2a';
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
      if (!(t === 'swordsman' || t === 'knight')) {
        ctx.fillStyle = '#a8aeb8';
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(a + 1.57) * L * 0.14, ey + Math.sin(a + 1.57) * L * 0.14); ctx.lineTo(ex - Math.cos(a) * L * 0.12, ey - Math.sin(a) * L * 0.12); ctx.fill();
      }
    }
    if (t === 'axeman' || t === 'swordsman' || t === 'knight') {
      ctx.fillStyle = t === 'axeman' ? '#8a5a2e' : '#b8bec8';
      ctx.beginPath(); ctx.ellipse(-L * 0.12, by - L * 0.3, L * 0.13, L * 0.18, 0, 0, 7); ctx.fill();
      ctx.fillStyle = PLAYER_COLORS[u.owner].main;
      ctx.beginPath(); ctx.arc(-L * 0.12, by - L * 0.3, L * 0.05, 0, 7); ctx.fill();
    }
  }

  drawProjectiles(alpha) {
    const ctx = this.ctx, s = this.scale;
    for (const p of this.world.projectiles) {
      const k = clamp((p.t + alpha * TICK) / p.dur, 0, 1);
      const x = lerp(p.x0, p.x1, k), y = lerp(p.y0, p.y1, k);
      const arc = Math.sin(k * Math.PI) * Math.min(2, dist(p.x0, p.y0, p.x1, p.y1) * 0.15);
      const [sx, sy] = this.toScreen(x, y - arc);
      if (p.kind === 'stone') {
        ctx.fillStyle = '#9a968c'; ctx.beginPath(); ctx.arc(sx, sy, s * 0.1, 0, 7); ctx.fill();
      } else {
        const k2 = clamp(k + 0.05, 0, 1);
        const arc2 = Math.sin(k2 * Math.PI) * Math.min(2, dist(p.x0, p.y0, p.x1, p.y1) * 0.15);
        const [tx, ty] = this.toScreen(lerp(p.x0, p.x1, k2), lerp(p.y0, p.y1, k2) - arc2);
        const a = Math.atan2(ty - sy, tx - sx);
        ctx.strokeStyle = p.kind === 'bolt' ? '#333' : '#5a3a1c'; ctx.lineWidth = Math.max(1, s * 0.035);
        ctx.beginPath(); ctx.moveTo(sx - Math.cos(a) * s * 0.25, sy - Math.sin(a) * s * 0.25); ctx.lineTo(sx, sy); ctx.stroke();
      }
    }
  }

  // --------------------------------------------------- UI world overlays
  drawOverlay(ui, alpha) {
    const w = this.world, ctx = this.ctx, s = this.scale, m = w.map;
    // order flashes
    const keep = [];
    for (const f of this.flashes) {
      f.t += 1 / 60;
      if (f.t > 0.6) continue;
      keep.push(f);
      const [sx, sy] = this.toScreen(f.x, f.y);
      const k = f.t / 0.6;
      ctx.strokeStyle = f.col.replace('A', String(1 - k));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, s * (0.2 + k * 0.5), s * (0.1 + k * 0.25), 0, 0, 7); ctx.stroke();
    }
    this.flashes = keep;

    // group formation targets for selected groups
    for (const gid of ui.selGroups) {
      const g = w.groups.get(gid);
      if (!g || g.order.kind !== 'move') continue;
      ctx.fillStyle = 'rgba(255,255,140,0.35)';
      for (const id of g.members) {
        const u = w.units.get(id);
        if (!u || u.slot < 0) continue;
        const [sx, sy] = this.toScreen(u.slot % m.W + 0.5, ((u.slot / m.W) | 0) + 0.5);
        ctx.beginPath(); ctx.arc(sx, sy, s * 0.08, 0, 7); ctx.fill();
      }
    }

    // placement ghost (computed by the UI in ui.ghost)
    const gh = ui.ghost;
    if (gh && gh.kind === 'build') {
      const def = BUILDINGS[gh.type], bx = gh.x, by = gh.y, ok = gh.ok;
      if (def.radius) {
        const [cx, cy] = this.toScreen(bx + def.w / 2, by + def.h / 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, def.radius * s, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      const spr = this.buildingSprite(gh.type, 0);
      const [sx, sy] = this.toScreen(bx, by - TOP);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(spr, sx, sy, spr.width * s / SPR, spr.height * s / SPR);
      ctx.globalAlpha = 1;
      const [fx, fy] = this.toScreen(bx, by);
      ctx.fillStyle = ok ? 'rgba(80,220,80,0.25)' : 'rgba(230,60,50,0.3)';
      ctx.fillRect(fx, fy, def.w * s, def.h * s);
      ctx.strokeStyle = ok ? 'rgba(120,255,120,0.9)' : 'rgba(255,90,80,0.9)'; ctx.lineWidth = 2;
      ctx.strokeRect(fx, fy, def.w * s, def.h * s);
      const [dx, dy] = this.toScreen(gh.door.x, gh.door.y);
      ctx.fillStyle = ok ? 'rgba(255,230,120,0.6)' : 'rgba(255,90,80,0.4)';
      ctx.beginPath(); ctx.moveTo(dx + s * 0.5, dy + s * 0.1); ctx.lineTo(dx + s * 0.8, dy + s * 0.6); ctx.lineTo(dx + s * 0.2, dy + s * 0.6); ctx.fill();
    } else if (gh && gh.kind === 'tiles') {
      for (const [x, y, ok] of gh.tiles) {
        const [sx, sy] = this.toScreen(x, y);
        ctx.fillStyle = ok ? (gh.plan === 1 ? 'rgba(255,230,160,0.45)' : gh.plan === 2 ? 'rgba(240,220,90,0.4)' : 'rgba(200,120,220,0.4)') : 'rgba(230,60,50,0.35)';
        ctx.fillRect(sx + 1, sy + 1, s - 2, s - 2);
      }
    } else if (gh && gh.kind === 'demolish') {
      const b = w.buildings.get(gh.bid);
      ctx.strokeStyle = 'rgba(255,80,60,0.95)'; ctx.lineWidth = 2;
      if (b) {
        const [fx, fy] = this.toScreen(b.x, b.y);
        ctx.fillStyle = 'rgba(255,60,40,0.25)'; ctx.fillRect(fx, fy, b.w * s, b.h * s);
        ctx.strokeRect(fx, fy, b.w * s, b.h * s);
      } else {
        const [sx, sy] = this.toScreen(gh.x, gh.y);
        ctx.beginPath(); ctx.moveTo(sx + s * 0.2, sy + s * 0.2); ctx.lineTo(sx + s * 0.8, sy + s * 0.8); ctx.moveTo(sx + s * 0.8, sy + s * 0.2); ctx.lineTo(sx + s * 0.2, sy + s * 0.8); ctx.stroke();
      }
    }
    if (ui.hoverBuilding && !gh) {
      const b = w.buildings.get(ui.hoverBuilding);
      if (b) {
        const [fx, fy] = this.toScreen(b.x, b.y);
        ctx.strokeStyle = b.owner === 0 ? 'rgba(255,255,200,0.6)' : 'rgba(255,120,100,0.7)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(fx, fy, b.w * s, b.h * s);
      }
    }
    // box selection
    if (ui.box) {
      ctx.strokeStyle = 'rgba(255,255,160,0.9)'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,160,0.1)';
      const x = Math.min(ui.box.x0, ui.box.x1), y = Math.min(ui.box.y0, ui.box.y1);
      ctx.fillRect(x, y, Math.abs(ui.box.x1 - ui.box.x0), Math.abs(ui.box.y1 - ui.box.y0));
      ctx.strokeRect(x, y, Math.abs(ui.box.x1 - ui.box.x0), Math.abs(ui.box.y1 - ui.box.y0));
    }
  }

  flash(x, y, col) { this.flashes.push({ x, y, t: 0, col }); }

  // Small rising icon over a building when it produces something (only if on screen).
  floater(x, y, icon) {
    const v = this.view;
    if (!v || x < v.tx0 || x > v.tx1 || y < v.ty0 || y > v.ty1) return;
    if (this.floaters.length > 40) this.floaters.shift();
    this.floaters.push({ x, y, icon, t: 0 });
  }

  drawFloaters(dt) {
    const ctx = this.ctx, s = this.scale;
    const keep = [];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      f.t += dt;
      if (f.t > 1.4) continue;
      keep.push(f);
      const [sx, sy] = this.toScreen(f.x, f.y);
      const k = f.t / 1.4;
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.5) / 0.5);
      ctx.font = `${Math.round(Math.max(12, s * 0.45))}px sans-serif`;
      ctx.fillText(f.icon, sx, sy - s * (0.3 + k * 0.9));
    }
    ctx.globalAlpha = 1;
    this.floaters = keep;
  }
}
