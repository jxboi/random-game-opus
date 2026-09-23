// ---------------------------------------------------------------------------
// three.js renderer ("3D"). Implements the contract in src/render/renderer.js.
//
// World mapping: tile (x, y) -> THREE (x, height, y). One unit = one tile.
// +x east, +z south, +y up. The camera looks north from the south at a fixed
// pitch, like the original's 3/4 view.
//
// Per frame:  terrain.update() (repaint changed tiles) -> sync trees/rocks ->
// sync buildings -> refill instanced actors -> render -> 2D HUD overlay
// (health bars, badges, floaters, selection box).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { BUILDINGS, SOLDIERS } from '../../core/data.js';
import { TREE_MATURE } from '../../core/map.js';
import { clamp, hash2 } from '../../core/util.js';
import { Actors, Batch } from './actors.js';
import { buildBuilding, buildSails, instanceBuilding, mat, rockGeometry, treeGeometries } from './models.js';
import { Terrain } from './terrain.js';

const PITCH = 50 * Math.PI / 180;
const BASE_DIST = 34;
const TREE_SCALE = [0, 0.32, 0.5, 0.68, 0.84, 1];
const GREENS = ['#2d5a24', '#3b7030', '#4f8a3a', '#44722a', '#5a8a34', '#355e22'].map(c => new THREE.Color(c));
const PINES = ['#1f4a26', '#27592d', '#2f6934'].map(c => new THREE.Color(c));

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();

export class Renderer3D {
  constructor(stage, world) {
    this.kind = '3d';
    this.stage = stage;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view';
    this.hud = document.createElement('canvas');
    this.hud.className = 'view hud';
    stage.prepend(this.hud);
    stage.prepend(this.canvas);
    this.hctx = this.hud.getContext('2d');
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1f2a17');
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    this.raycaster = new THREE.Raycaster();
    this.cam = { x: 20, y: 70, zoom: 1 };
    this.targetY = 0.5;
    this.time = 0;
    this.flashes = [];
    this.floaters = [];
    this.puffs = [];
    this.view = { tx0: 0, ty0: 0, tx1: 0, ty1: 0 };
    // Lights
    this.scene.add(new THREE.HemisphereLight(0xe4efff, 0x4a5a30, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    // Skirt under the map so edges don't float in the void
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#27351d' }));
    skirt.position.y = -0.4;
    this.scene.add(skirt);
    this.setWorld(world);
    this.resize();
  }

  // ------------------------------------------------------------ lifecycle
  setWorld(world) {
    this.disposeWorld();
    this.world = world;
    this.terrain = new Terrain(world, this.scene);
    this.actors = new Actors(this.scene);
    const tg = treeGeometries();
    const trunkMat = mat('#5e3d20');
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    this.trees = {
      trunk: new Batch(this.scene, tg.trunk, trunkMat, 4096),
      crown: new Batch(this.scene, tg.crown, leafMat, 4096),
      pineTrunk: new Batch(this.scene, tg.pineTrunk, trunkMat, 2048),
      pine: new Batch(this.scene, tg.pine, leafMat, 2048),
      rock: new Batch(this.scene, rockGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), 2048),
    };
    for (const k in this.trees) this.trees[k].mesh.receiveShadow = true;
    this.treeSnap = new Uint8Array(world.map.N).fill(255);
    this.stoneSnap = new Uint8Array(world.map.N).fill(255);
    this.bmap = new Map();
    this.ghost = { group: null, type: null, ok: null };
    this.fx = {
      tile: new Batch(this.scene, new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), 256, { shadow: false }),
      flash: new Batch(this.scene, new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }), 32, { shadow: false }),
    };
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffc8 }));
    this.outline.visible = false;
    this.scene.add(this.outline);
    this.radius = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
    this.radius.visible = false;
    this.scene.add(this.radius);
    this.firstFrames = 3;
  }

  disposeWorld() {
    if (!this.world) return;
    this.terrain.dispose();
    this.actors.dispose();
    for (const k in this.trees) this.trees[k].dispose();
    for (const k in this.fx) this.fx[k].dispose();
    for (const e of this.bmap.values()) e.group.removeFromParent();
    if (this.ghost.group) this.ghost.group.removeFromParent();
    this.outline.removeFromParent(); this.radius.removeFromParent();
  }

  dispose() {
    this.disposeWorld();
    this.gl.dispose();
    this.canvas.remove();
    this.hud.remove();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(this.cw, this.ch, false);
    this.hud.width = Math.round(this.cw * dpr); this.hud.height = Math.round(this.ch * dpr);
    this.camera.aspect = this.cw / this.ch;
    this.camera.updateProjectionMatrix();
  }

  // --------------------------------------------------------------- camera
  clampCam() {
    const m = this.world.map;
    this.cam.zoom = clamp(this.cam.zoom, 0.45, 2.2);
    this.cam.x = clamp(this.cam.x, 2, m.W - 2);
    this.cam.y = clamp(this.cam.y, 4, m.H - 1);
  }

  updateCamera() {
    this.clampCam();
    const gy = this.terrain.heightAt(this.cam.x, this.cam.y);
    this.targetY += (gy - this.targetY) * 0.15;
    const d = BASE_DIST / this.cam.zoom;
    const tx = this.cam.x, ty = this.targetY, tz = this.cam.y;
    this.camera.position.set(tx, ty + d * Math.sin(PITCH), tz + d * Math.cos(PITCH));
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateMatrixWorld();
    // Sun follows the view so the shadow map covers what we see.
    const r = Math.min(60, 26 / this.cam.zoom + 8);
    const s = this.sun.shadow.camera;
    if (s.right !== r) { s.left = -r; s.right = r; s.top = r; s.bottom = -r; s.updateProjectionMatrix(); }
    // Low sun from the south-west: lights the fronts and one roof slope, shadows fall north-east.
    this.sun.position.set(tx - 20, ty + 24, tz + 14);
    this.sun.target.position.set(tx, ty, tz);
    this.sun.target.updateMatrixWorld();
  }

  toScreen(x, y, h = 0) {
    _v.set(x, this.terrain.heightAt(x, y) + h, y).project(this.camera);
    return [(_v.x + 1) / 2 * this.cw, (1 - _v.y) / 2 * this.ch];
  }

  ray(sx, sy) {
    this.raycaster.setFromCamera(new THREE.Vector2(sx / this.cw * 2 - 1, -(sy / this.ch) * 2 + 1), this.camera);
    return this.raycaster;
  }

  toWorld(sx, sy) {
    const rc = this.ray(sx, sy);
    const hit = rc.intersectObjects(this.terrain.meshes(), false)[0];
    if (hit) return [hit.point.x, hit.point.z];
    return this.groundPlane(sx, sy);
  }

  groundPlane(sx, sy, y = this.targetY) {
    const rc = this.ray(sx, sy);
    const p = new THREE.Vector3();
    const ok = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p);
    return ok ? [p.x, p.z] : [this.cam.x, this.cam.y];
  }

  pxPerTile() {
    const [ax, ay] = this.toScreen(this.cam.x, this.cam.y);
    const [bx, by] = this.toScreen(this.cam.x + 1, this.cam.y);
    return Math.hypot(bx - ax, by - ay);
  }

  panBy(dx, dy) {
    const [ax, ay] = this.groundPlane(this.cw / 2, this.ch / 2);
    const [bx, by] = this.groundPlane(this.cw / 2 - dx, this.ch / 2 - dy);
    this.cam.x += bx - ax; this.cam.y += by - ay;
    this.updateCamera();
  }

  zoomAt(sx, sy, f) {
    const [ax, ay] = this.groundPlane(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * f, 0.45, 2.2);
    this.updateCamera();
    const [bx, by] = this.groundPlane(sx, sy);
    this.cam.x += ax - bx; this.cam.y += ay - by;
    this.updateCamera();
  }

  pickBuilding(sx, sy) {
    const groups = [];
    for (const e of this.bmap.values()) groups.push(e.group);
    const hit = this.ray(sx, sy).intersectObjects(groups, true)[0];
    let o = hit && hit.object;
    while (o && o.userData.bid == null) o = o.parent;
    return o ? o.userData.bid : 0;
  }

  viewPolygon() {
    return [this.groundPlane(0, 0), this.groundPlane(this.cw, 0), this.groundPlane(this.cw, this.ch), this.groundPlane(0, this.ch)];
  }

  flash(x, y, col) { this.flashes.push({ x, y, t: 0, col: new THREE.Color(col.replace(/,\s*A\)/, ')').replace('rgba', 'rgb')) }); }

  floater(x, y, icon) {
    const v = this.view;
    if (x < v.tx0 || x > v.tx1 || y < v.ty0 || y > v.ty1) return;
    if (this.floaters.length > 40) this.floaters.shift();
    this.floaters.push({ x, y, icon, t: 0 });
  }

  // ------------------------------------------------------------------ frame
  draw(alpha, ui, dt) {
    const w = this.world;
    this.time += dt;
    this.updateCamera();
    const poly = this.viewPolygon();
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    this.view = { tx0: Math.floor(Math.min(...xs)) - 2, ty0: Math.floor(Math.min(...ys)) - 3, tx1: Math.ceil(Math.max(...xs)) + 2, ty1: Math.ceil(Math.max(...ys)) + 2 };
    const v = this.view;
    const visible = ch => ch.x0 + 16 >= v.tx0 && ch.x0 <= v.tx1 && ch.y0 + 16 >= v.ty0 && ch.y0 <= v.ty1;
    this.terrain.update(visible, this.firstFrames > 0 ? 40 : 1);
    if (this.firstFrames > 0) this.firstFrames--;
    this.syncNature();
    this.syncBuildings(ui, dt);
    this.drawActors(alpha, ui, dt);
    this.drawGhost(ui);
    this.gl.render(this.scene, this.camera);
    this.drawHud(ui, dt);
  }

  syncNature() {
    const m = this.world.map, tr = this.trees;
    let changed = false;
    for (let i = 0; i < m.N; i++) {
      const st = m.stone[i] ? 1 + (m.stone[i] >= 4) + (m.stone[i] >= 8) : 0;
      if (m.tree[i] !== this.treeSnap[i] || st !== this.stoneSnap[i]) { changed = true; this.treeSnap[i] = m.tree[i]; this.stoneSnap[i] = st; }
    }
    if (!changed) return;
    for (const k in tr) tr[k].begin();
    const W = m.W;
    for (let i = 0; i < m.N; i++) {
      const x = i % W, y = (i / W) | 0;
      if (m.tree[i]) {
        const pine = Math.floor(hash2(x, y, 8) * 3) === 2;
        const s = TREE_SCALE[Math.min(TREE_MATURE, m.tree[i])] * (0.9 + hash2(x, y, 12) * 0.3);
        const px = x + 0.5 + (hash2(x, y, 9) - 0.5) * 0.3, pz = y + 0.5 + (hash2(x, y, 10) - 0.5) * 0.3;
        _v.set(px, this.terrain.heightAt(px, pz), pz);
        _q.setFromEuler(_e.set(0, hash2(x, y, 13) * 6.28, 0));
        _s.set(s, s, s);
        _m.compose(_v, _q, _s);
        if (pine) { tr.pineTrunk.push(_m); tr.pine.push(_m, PINES[Math.floor(hash2(x, y, 14) * 3)]); }
        else { tr.trunk.push(_m); tr.crown.push(_m, GREENS[Math.floor(hash2(x, y, 14) * GREENS.length)]); }
      }
      const st = this.stoneSnap[i];
      if (st) {
        for (let k = 0; k < st + 1; k++) {
          const px = x + 0.3 + hash2(x, y, 20 + k) * 0.4, pz = y + 0.3 + hash2(x, y, 30 + k) * 0.4;
          const s = (0.8 + hash2(x, y, 40 + k) * 0.6) * (0.8 + st * 0.2);
          _v.set(px, this.terrain.heightAt(px, pz) + 0.05, pz);
          _q.setFromEuler(_e.set(hash2(x, y, 50 + k), hash2(x, y, 60 + k) * 6, 0));
          _s.set(s, s * 0.75, s);
          _m.compose(_v, _q, _s);
          const g = 0.55 + hash2(x, y, 70 + k) * 0.12;
          tr.rock.push(_m, _c.setRGB(g, g * 0.97, g * 0.93));
        }
      }
    }
    for (const k in tr) tr[k].end();
  }

  syncBuildings(ui, dt) {
    const w = this.world;
    for (const [id, e] of this.bmap) if (!w.buildings.has(id)) { e.group.removeFromParent(); this.bmap.delete(id); }
    for (const b of w.buildings.values()) {
      let e = this.bmap.get(b.id);
      if (!e) {
        const y = this.terrain.flatten(b);
        const group = new THREE.Group();
        group.position.set(b.x, y, b.y);
        group.userData.bid = b.id;
        this.scene.add(group);
        e = { group, state: null, model: null, sails: null, site: null };
        this.bmap.set(b.id, e);
      }
      if (e.state !== b.state) this.rebuildBuilding(e, b);
      if (b.state === 'site') {
        const prog = b.site.used / b.site.total;
        e.model.visible = prog > 0;
        e.model.scale.y = 0.08 + 0.92 * prog;
        e.site.material = mat(b.site.level < 1 ? '#6b5a3a' : '#7a5c3a');
        e.site.scale.y = 0.4 + b.site.level * 0.6;
      }
      if (e.sails) e.sails.rotation.z -= dt * (b.active > 0 ? 1.6 : 0.2);
      const meta = e.model && e.model.userData.meta;
      if (b.state === 'done' && meta && meta.chimney && b.active > 0 && Math.random() < dt * 6) {
        this.puffs.push({ x: b.x + meta.chimney.x, y: e.group.position.y + meta.chimney.y, z: b.y + meta.chimney.z, t: 0, dur: 2.4, vx: 0.18 });
      }
      if (b.state === 'done' && b.hp < b.maxHp * 0.5 && this.world.time - b.lastHit < 3 && Math.random() < dt * 8) {
        this.puffs.push({ x: b.x + Math.random() * b.w, y: e.group.position.y + 0.5, z: b.y + Math.random() * b.h, t: 0, dur: 1.6, vx: 0.1, dark: true });
      }
    }
    // Selection / hover outline
    const id = ui.selBuilding || ui.hoverBuilding;
    const b = id && w.buildings.get(id);
    if (b) {
      const e = this.bmap.get(b.id);
      this.outline.visible = true;
      this.outline.position.set(b.x + b.w / 2, e.group.position.y + 0.02, b.y + b.h / 2);
      this.outline.scale.set(b.w, 0.04, b.h);
      this.outline.material.color.set(b.owner === 0 ? (ui.selBuilding ? '#ffff8c' : '#fff8d0') : '#ff7864');
    } else this.outline.visible = false;
  }

  rebuildBuilding(e, b) {
    e.group.clear();
    e.state = b.state;
    e.model = instanceBuilding(b.type, b.owner);
    e.group.add(e.model);
    e.sails = null;
    const meta = e.model.userData.meta;
    if (meta.hub) {
      e.sails = buildSails();
      e.sails.position.copy(meta.hub);
      e.group.add(e.sails);
    }
    if (b.state === 'site') {
      e.site = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.1, 0.06, b.h - 0.1).translate(b.w / 2, 0.03, b.h / 2), mat('#7a5c3a'));
      e.site.receiveShadow = true;
      e.group.add(e.site);
      for (const [px, pz] of [[0.05, 0.05], [b.w - 0.05, 0.05], [0.05, b.h - 0.05], [b.w - 0.05, b.h - 0.05]]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05).translate(px, 0.55, pz), mat('#7a5530'));
        pole.castShadow = true;
        e.group.add(pole);
      }
    } else e.site = null;
    e.group.traverse(o => { o.userData.bid = b.id; });
  }

  drawActors(alpha, ui, dt) {
    const w = this.world, a = this.actors, v = this.view, t = this.time;
    const hAt = (x, y) => this.terrain.heightAt(x, y);
    a.begin();
    for (const u of w.units.values()) {
      if (u.inside) continue;
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      if (x < v.tx0 || x > v.tx1 || y < v.ty0 || y > v.ty1) continue;
      a.drawUnit(u, x, y, hAt(x, y), t, ui.selGroups.has(u.group) || ui.selUnit === u.id);
    }
    for (const p of w.projectiles) a.drawProjectile(p, alpha, hAt);
    for (const e of w.effects) if (e.x >= v.tx0 - 3 && e.x <= v.tx1 && e.y >= v.ty0 - 3 && e.y <= v.ty1) a.drawEffect(e, hAt);
    const keep = [];
    for (const p of this.puffs) {
      p.t += dt;
      if (p.t > p.dur) continue;
      keep.push(p);
      const k = p.t / p.dur;
      a.drawPuff(p.x + p.vx * p.t, p.y + p.t * 0.45, p.z, (0.6 + k * 1.8) * (1 - k * 0.5), p.dark);
    }
    this.puffs = keep.length > 400 ? keep.slice(-400) : keep;
    // Formation targets for marching selected groups
    const W = w.map.W;
    for (const gid of ui.selGroups) {
      const g = w.groups.get(gid);
      if (!g || g.order.kind !== 'move') continue;
      for (const id of g.members) {
        const u = w.units.get(id);
        if (!u || u.slot < 0) continue;
        const sx = u.slot % W + 0.5, sz = ((u.slot / W) | 0) + 0.5;
        a.drawSlot(sx, hAt(sx, sz), sz);
      }
    }
    a.end();
    // Order flashes
    const f = this.fx.flash;
    f.begin();
    this.flashes = this.flashes.filter(fl => (fl.t += dt) < 0.6);
    for (const fl of this.flashes) {
      const k = fl.t / 0.6, s = 0.25 + k * 0.6;
      _v.set(fl.x, hAt(fl.x, fl.y) + 0.05, fl.y); _q.identity(); _s.set(s, 1, s);
      _m.compose(_v, _q, _s);
      f.push(_m, _c.copy(fl.col).multiplyScalar(1 - k * 0.7));
    }
    f.end();
  }

  drawGhost(ui) {
    const gh = ui.ghost, tiles = this.fx.tile;
    tiles.begin();
    this.radius.visible = false;
    const hAt = (x, y) => this.terrain.heightAt(x, y);
    const push = (x, y, color, sx = 1, sz = 1) => {
      _v.set(x + 0.5 * sx, hAt(x + 0.5 * sx, y + 0.5 * sz) + 0.06, y + 0.5 * sz); _q.identity(); _s.set(sx, 1, sz);
      _m.compose(_v, _q, _s);
      tiles.push(_m, _c.set(color));
    };
    let showModel = false;
    if (gh && gh.kind === 'build') {
      const def = BUILDINGS[gh.type];
      if (!this.ghost.group || this.ghost.type !== gh.type || this.ghost.ok !== gh.ok) {
        if (this.ghost.group) this.ghost.group.removeFromParent();
        const g = buildBuilding(gh.type, 0);
        const m = new THREE.MeshBasicMaterial({ color: gh.ok ? '#9dff9d' : '#ff8a80', transparent: true, opacity: 0.45, depthWrite: false });
        g.traverse(o => { if (o.isMesh) { o.material = m; o.castShadow = false; } });
        this.scene.add(g);
        this.ghost = { group: g, type: gh.type, ok: gh.ok };
      }
      const cy = hAt(gh.x + def.w / 2, gh.y + def.h / 2);
      this.ghost.group.position.set(gh.x, cy, gh.y);
      showModel = true;
      for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) push(gh.x + x, gh.y + y, gh.ok ? '#50dc50' : '#e63c32');
      push(gh.door.x, gh.door.y, gh.ok ? '#ffe678' : '#ff5a50');
      if (def.radius) {
        this.radius.visible = true;
        this.radius.position.set(gh.x + def.w / 2, cy + 0.08, gh.y + def.h / 2);
        this.radius.scale.set(def.radius, 1, def.radius);
      }
    } else if (gh && gh.kind === 'tiles') {
      const okc = gh.plan === 1 ? '#ffe6a0' : gh.plan === 2 ? '#f0dc5a' : '#c878dc';
      for (const [x, y, ok] of gh.tiles) push(x, y, ok ? okc : '#e63c32');
    } else if (gh && gh.kind === 'demolish') {
      const b = this.world.buildings.get(gh.bid);
      if (b) push(b.x, b.y, '#ff3c28', b.w, b.h);
      else push(gh.x, gh.y, '#ff3c28');
    }
    if (this.ghost.group) this.ghost.group.visible = showModel;
    tiles.end();
  }

  // ---------------------------------------------------------------- HUD
  drawHud(ui, dt) {
    const g = this.hctx, w = this.world;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.cw, this.ch);
    const s = this.pxPerTile();
    const v = this.view;
    for (const u of w.units.values()) {
      if (u.inside || u.kind !== 'soldier') continue;
      if (u.x < v.tx0 || u.x > v.tx1 || u.y < v.ty0 || u.y > v.ty1) continue;
      const sel = ui.selGroups.has(u.group) || ui.selUnit === u.id;
      if (!sel && u.hp >= u.maxHp) continue;
      const [sx, sy] = this.toScreen(u.x, u.y, SOLDIERS[u.type].mounted ? 0.95 : 0.75);
      this.bar(sx, sy, Math.max(14, s * 0.55), u.hp / u.maxHp);
      if (sel && u.cond < 0.3) this.badge(sx + s * 0.35, sy - 10, '🍖', '#b86a1a', s);
    }
    for (const b of w.buildings.values()) {
      if (b.x + b.w < v.tx0 || b.x > v.tx1 || b.y + b.h < v.ty0 || b.y > v.ty1) continue;
      if (b.state === 'done' && b.owner === 0 && ((b.def.worker && !b.worker) || (b.def.kind === 'tower' && !b.guard))) {
        const [sx, sy] = this.toScreen(b.x + b.w / 2, b.y + b.h / 2, 1.9);
        this.badge(sx, sy, '👤', '#d9534f', s);
      }
      if (b.hp < b.maxHp * 0.999 && (b.state === 'done' || w.time - b.lastHit < 5)) {
        const [sx, sy] = this.toScreen(b.x + b.w / 2, b.y + b.h, 0);
        this.bar(sx, sy + 4, b.w * s * 0.6, b.hp / b.maxHp);
      }
    }
    // Floaters
    g.textAlign = 'center'; g.textBaseline = 'middle';
    this.floaters = this.floaters.filter(f => (f.t += dt) < 1.4);
    for (const f of this.floaters) {
      const k = f.t / 1.4;
      const [sx, sy] = this.toScreen(f.x, f.y, 1.2 + k * 0.9);
      g.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.5) / 0.5);
      g.font = `${Math.round(Math.max(12, s * 0.45))}px sans-serif`;
      g.fillText(f.icon, sx, sy);
    }
    g.globalAlpha = 1;
    if (ui.box) {
      const b = ui.box;
      g.strokeStyle = 'rgba(255,255,160,0.9)'; g.fillStyle = 'rgba(255,255,160,0.1)'; g.lineWidth = 1;
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), bw = Math.abs(b.x1 - b.x0), bh = Math.abs(b.y1 - b.y0);
      g.fillRect(x, y, bw, bh); g.strokeRect(x, y, bw, bh);
    }
  }

  bar(cx, y, w, frac) {
    const g = this.hctx, h = 4;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
    g.fillStyle = frac > 0.6 ? '#5fcf4a' : frac > 0.3 ? '#e8c440' : '#e0483c';
    g.fillRect(cx - w / 2, y, w * clamp(frac, 0, 1), h);
  }

  badge(x, y, txt, col, s) {
    const g = this.hctx;
    const r = Math.max(8, s * 0.22);
    const bob = Math.sin(this.time * 3) * r * 0.15;
    g.fillStyle = col; g.beginPath(); g.arc(x, y + bob, r, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    g.font = `${Math.round(r * 1.1)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.fillText(txt, x, y + bob + 1);
  }
}
