// ---------------------------------------------------------------------------
// Instanced moving things for the 3D renderer: units, projectiles, effects.
//
// Every unit is assembled each frame from shared instanced parts (legs, body,
// head, hat, weapon, shield, horse...). A Batch is one InstancedMesh; begin()
// / push(matrix, color) / end() refills it every frame. Adding a new visual
// part = one more Batch plus a push() in drawUnit().
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CITIZENS, GOODS, PLAYER_COLORS, SOLDIERS } from '../../core/data.js';
import { clamp, dist, hash2, lerp } from '../../core/util.js';

export class Batch {
  constructor(scene, geo, material, cap = 2048, { shadow = true } = {}) {
    this.scene = scene; this.geo = geo; this.material = material; this.shadow = shadow;
    this.alloc(cap);
  }
  alloc(cap) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(this.geo, this.material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.castShadow = this.shadow;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  push(m, color) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    this.mesh.setMatrixAt(this.n, m);
    if (color) this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.dispose(); this.geo.dispose(); }
}

const std = (opts = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true, ...opts });
const col = hex => new THREE.Color(hex);
const IRON = new Set(['swordsman', 'pikeman', 'crossbowman', 'knight']);

// Reusable scratch objects (no per-frame allocation in the hot loop).
const M = new THREE.Matrix4(), L = new THREE.Matrix4(), T = new THREE.Matrix4();
const Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const E = new THREE.Euler();

function local(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  V.set(x, y, z); S.set(sx, sy, sz);
  return L.compose(V, Q, S);
}

export class Actors {
  constructor(scene) {
    this.scene = scene;
    const box = (w, h, d, oy = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, oy, 0); return g; };
    const m = std();
    this.b = {
      leg: new Batch(scene, box(0.05, 0.2, 0.055, -0.1), m),
      body: new Batch(scene, box(0.17, 0.2, 0.11), m),
      belt: new Batch(scene, box(0.176, 0.035, 0.116), m, 1024, { shadow: false }),
      armor: new Batch(scene, box(0.182, 0.12, 0.12), std({ metalness: 0.3, roughness: 0.5 }), 1024),
      head: new Batch(scene, new THREE.IcosahedronGeometry(0.062, 1), m),
      hat: new Batch(scene, (() => { const g = new THREE.SphereGeometry(0.068, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2); return g; })(), m),
      // unit-length stick from the hand forward (+z); scale z for length
      stick: new Batch(scene, (() => { const g = new THREE.BoxGeometry(0.025, 0.025, 1); g.translate(0, 0, 0.5); return g; })(), m),
      blade: new Batch(scene, box(0.03, 0.09, 0.12), std({ metalness: 0.5, roughness: 0.4 })),
      shield: new Batch(scene, (() => { const g = new THREE.CylinderGeometry(0.085, 0.085, 0.025, 10); g.rotateX(Math.PI / 2); return g; })(), m),
      carry: new Batch(scene, box(0.12, 0.1, 0.12), m),
      horse: new Batch(scene, box(0.16, 0.15, 0.42), m, 512),
      hhead: new Batch(scene, box(0.09, 0.2, 0.1), m, 512),
      hleg: new Batch(scene, box(0.045, 0.24, 0.045, -0.12), m, 1024),
      ring: new Batch(scene, (() => { const g = new THREE.RingGeometry(0.22, 0.28, 20); g.rotateX(-Math.PI / 2); return g; })(),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), 512, { shadow: false }),
      arrow: new Batch(scene, box(0.018, 0.018, 0.32), m, 512),
      stone: new Batch(scene, new THREE.IcosahedronGeometry(0.07, 0), m, 256),
      corpse: new Batch(scene, box(0.34, 0.07, 0.13), m, 512, { shadow: false }),
      puff: new Batch(scene, new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, roughness: 1 }), 1024, { shadow: false }),
      spark: new Batch(scene, box(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff }), 256, { shadow: false }),
      rubble: new Batch(scene, box(0.2, 0.12, 0.16), m, 1024),
      slot: new Batch(scene, (() => { const g = new THREE.CircleGeometry(0.08, 10); g.rotateX(-Math.PI / 2); return g; })(),
        new THREE.MeshBasicMaterial({ color: 0xffff8c, transparent: true, opacity: 0.45, depthWrite: false }), 512, { shadow: false }),
    };
    this.c = {
      skin: col('#e8c39a'), legs: col('#3a2c20'), wood: col('#6b4a2a'), steel: col('#c8ccd4'), leather: col('#7a5030'),
      militiaHat: col('#6b4a2a'), helmet: col('#8a8a80'), shieldWood: col('#8a5a2e'), horse: col('#7b5230'), white: col('#e8e2d4'),
      corpseBlood: col('#5a1a14'), dust: col('#a8967a'), smoke: col('#d8d8d8'), darkSmoke: col('#38322c'), spark: col('#ffd070'),
      rubble1: col('#7d7466'), rubble2: col('#4e473d'), selMine: col('#ffff8c'), selEnemy: col('#ff7864'),
    };
    this.tunic = {};
    for (const t in CITIZENS) this.tunic[t] = col(CITIZENS[t].tunic);
    this.player = PLAYER_COLORS.map(p => col(p.main));
    this.playerDark = PLAYER_COLORS.map(p => col(p.dark));
    this.goods = {};
    for (const g in GOODS) this.goods[g] = col(GOODS[g].color);
    this.goods.grapes = col('#5a1f5a');
  }

  begin() { for (const k in this.b) this.b[k].begin(); }
  end() { for (const k in this.b) this.b[k].end(); }

  // (x, z) ground position, gy ground height, facing angle a (sim dir), t = time
  drawUnit(u, x, z, gy, t, selected) {
    const b = this.b, c = this.c;
    const sd = SOLDIERS[u.type];
    const soldier = !!sd;
    const mounted = sd && sd.mounted;
    const walk = u.moving ? Math.sin(t * 9 + u.walkPhase) : 0;
    const ry = Math.PI / 2 - u.dir;
    const jx = (hash2(u.id, 0, 3) - 0.5) * 0.18, jz = (hash2(u.id, 1, 3) - 0.5) * 0.12;
    E.set(0, ry, 0); Q.setFromEuler(E); V.set(x + jx, gy, z + jz); S.set(1, 1, 1);
    M.compose(V, Q, S);
    const P = (batch, lm, color) => { T.multiplyMatrices(M, lm); batch.push(T, color); };
    if (selected) {
      V.set(x + jx, gy + 0.02, z + jz); S.set(mounted ? 1.4 : 1, 1, mounted ? 1.4 : 1); Q.identity();
      T.compose(V, Q, S); b.ring.push(T, u.owner === 0 ? c.selMine : c.selEnemy);
    }
    let base = 0.2;
    if (mounted) {
      const hc = u.type === 'knight' ? c.white : c.horse;
      const bob = Math.abs(walk) * 0.02;
      P(b.horse, local(0, 0.34 + bob, 0), hc);
      P(b.hhead, local(0, 0.46 + bob, 0.24, -0.5), hc);
      for (const [lx, lz, ph] of [[-0.06, 0.15, 0], [0.06, 0.15, 1.6], [-0.06, -0.15, 3.1], [0.06, -0.15, 4.7]]) {
        const sw = u.moving ? Math.sin(t * 9 + u.walkPhase + ph) * 0.5 : 0;
        P(b.hleg, local(lx, 0.26 + bob, lz, sw), hc);
      }
      if (u.type === 'knight') P(b.belt, local(0, 0.38 + bob, 0, 0, 0, 0, 1.05, 1.5, 3.2), this.player[u.owner]);
      base = 0.42 + bob;
    } else {
      P(b.leg, local(-0.04, 0.2, 0, walk * 0.6), c.legs);
      P(b.leg, local(0.04, 0.2, 0, -walk * 0.6), c.legs);
    }
    const bob = u.moving && !mounted ? Math.abs(walk) * 0.015 : 0;
    const by = base + bob;
    const tunic = soldier ? this.player[u.owner] : this.tunic[u.type];
    P(b.body, local(0, by + 0.1, 0), tunic);
    if (soldier) {
      if (IRON.has(u.type)) P(b.armor, local(0, by + 0.14, 0), c.steel);
      else if (u.type !== 'militia') P(b.armor, local(0, by + 0.13, 0, 0, 0, 0, 1, 0.8, 1), c.leather);
    } else P(b.belt, local(0, by + 0.05, 0), this.player[u.owner]);
    P(b.head, local(0, by + 0.27, 0), c.skin);
    const hat = soldier ? (IRON.has(u.type) ? c.steel : u.type === 'militia' ? c.militiaHat : c.helmet)
      : (u.type === 'serf' ? this.tunic.serf : u.type === 'laborer' ? this.tunic.farmer : this.playerDark[u.owner]);
    P(b.hat, local(0, by + 0.29, 0), hat);

    // Arm-held tool / weapon: a stick pivoting at the right shoulder.
    const act = u.act;
    const swing = act ? Math.sin(t * (act === 'fight' ? 12 : 8) + u.id) : 0;
    if (soldier) this.weapon(u, P, by, swing, act);
    else if (act === 'hammer' || act === 'chop' || act === 'mine' || act === 'dig') {
      const a = -0.6 + swing * 0.9;
      P(b.stick, local(0.11, by + 0.17, 0.02, a, 0, 0, 1, 1, 0.34), c.wood);
      P(b.blade, local(0.11, by + 0.17 - Math.sin(a) * 0.3, 0.02 + Math.cos(a) * 0.3 * 0.9, a), c.steel);
    } else if (act === 'fish') {
      P(b.stick, local(0.11, by + 0.25, 0.25, -0.7, 0, 0, 1, 1, 0.7), c.wood);
    }
    if (u.carry) {
      P(b.carry, local(0, by + 0.4, -0.02), this.goods[u.carry] || c.wood);
    }
  }

  weapon(u, P, by, swing, act) {
    const b = this.b, c = this.c, t = u.type;
    const fighting = act === 'fight';
    if (t === 'lancer' || t === 'pikeman') {
      const len = t === 'pikeman' ? 1.3 : 1.0;
      const a = fighting ? -0.12 + swing * 0.12 : -1.3; // couched when fighting, upright at rest
      P(b.stick, local(0.11, by + 0.14, -0.25, a, 0, 0, 1, 1, len), c.wood);
    } else if (t === 'bowman' || t === 'crossbowman') {
      if (t === 'bowman') P(b.stick, local(0.11, by - 0.02, 0.12, -Math.PI / 2, 0, 0, 1, 1, 0.36), c.wood);
      else P(b.stick, local(0.1, by + 0.16, -0.05, 0, 0, 0, 1.6, 1.6, 0.32), c.wood);
    } else {
      const sword = t === 'swordsman' || t === 'knight';
      const a = fighting ? -1.2 + swing * 1.1 : -0.25;
      P(b.stick, local(0.11, by + 0.17, 0.02, a, 0, 0, 1, 1, sword ? 0.34 : 0.3), sword ? c.steel : c.wood);
      if (!sword) P(b.blade, local(0.11, by + 0.17 - Math.sin(a) * 0.28, 0.02 + Math.cos(a) * 0.28 * 0.9, a), c.steel);
    }
    if (t === 'axeman' || t === 'swordsman' || t === 'knight') {
      P(b.shield, local(-0.1, by + 0.1, 0.06), t === 'axeman' ? c.shieldWood : c.steel);
    }
  }

  drawProjectile(p, alpha, heightAt) {
    const k = clamp((p.t + alpha * 0.1) / p.dur, 0, 1);
    const x = lerp(p.x0, p.x1, k), z = lerp(p.y0, p.y1, k);
    const span = dist(p.x0, p.y0, p.x1, p.y1);
    const arc = Math.sin(k * Math.PI) * Math.min(2, span * 0.15);
    const y = heightAt(x, z) + 0.45 + arc;
    if (p.kind === 'stone') { V.set(x, y, z); Q.identity(); S.set(1, 1, 1); T.compose(V, Q, S); this.b.stone.push(T, this.c.rubble1); return; }
    const k2 = clamp(k + 0.03, 0, 1);
    const x2 = lerp(p.x0, p.x1, k2), z2 = lerp(p.y0, p.y1, k2);
    const y2 = heightAt(x2, z2) + 0.45 + Math.sin(k2 * Math.PI) * Math.min(2, span * 0.15);
    V.set(x2 - x, y2 - y, z2 - z).normalize();
    Q.setFromUnitVectors(Z, V);
    V.set(x, y, z); S.set(1, 1, 1);
    T.compose(V, Q, S);
    this.b.arrow.push(T, p.kind === 'bolt' ? this.c.legs : this.c.wood);
  }

  drawEffect(e, heightAt) {
    const b = this.b, c = this.c;
    const k = e.t / e.dur;
    switch (e.kind) {
      case 'corpse': {
        const gy = heightAt(e.x, e.y) - Math.max(0, k - 0.8) * 0.6;
        V.set(e.x, gy + 0.04, e.y); Q.setFromEuler(E.set(0, hash2(e.x * 10, e.y * 10, 1) * 6, 0)); S.set(1, 1, 1);
        T.compose(V, Q, S); b.corpse.push(T, this.player[e.owner]);
        break;
      }
      case 'rubble': {
        const sink = Math.max(0, k - 0.7) * 0.8;
        for (let n = 0; n < e.w * e.h * 3; n++) {
          const rx = e.x + hash2(e.x + n, e.y, 1) * e.w, rz = e.y + hash2(e.x, e.y + n, 2) * e.h;
          V.set(rx, heightAt(rx, rz) + 0.05 - sink, rz); Q.setFromEuler(E.set(0, n, 0)); S.set(1, 1, 1);
          T.compose(V, Q, S); b.rubble.push(T, n % 2 ? c.rubble1 : c.rubble2);
        }
        break;
      }
      case 'dust': {
        const s = 0.7 + k * 1.6;
        V.set(e.x, heightAt(e.x, e.y) + 0.15 + k * 0.4, e.y); Q.identity(); S.set(s, s, s);
        T.compose(V, Q, S); b.puff.push(T, c.dust);
        break;
      }
      case 'spark': {
        for (let n = 0; n < 4; n++) {
          const a = n * 1.57 + e.x * 10, r = 0.05 + k * 0.2;
          V.set(e.x + Math.cos(a) * r, heightAt(e.x, e.y) + 0.35 + Math.sin(a) * r * 0.6, e.y); Q.identity(); S.set(1 - k, 1 - k, 1 - k);
          T.compose(V, Q, S); b.spark.push(T, c.spark);
        }
        break;
      }
      case 'fall': {
        const a = Math.min(1, e.t / 0.8) ** 2 * 1.45;
        const gy = heightAt(e.x, e.y);
        Q.setFromEuler(E.set(0, 0, -a)); V.set(e.x, gy, e.y); S.set(1, 1, 1);
        T.compose(V, Q, S);
        L.makeTranslation(0, 0.5, 0);
        const m2 = new THREE.Matrix4().multiplyMatrices(T, L);
        b.corpse.push(m2.multiply(new THREE.Matrix4().makeScale(0.35, 12, 0.6)), c.legs);
        break;
      }
    }
  }

  // Chimney smoke / burning building puffs, owned by the renderer (not the sim).
  drawPuff(x, y, z, s, dark) {
    V.set(x, y, z); Q.identity(); S.set(s, s, s);
    T.compose(V, Q, S);
    this.b.puff.push(T, dark ? this.c.darkSmoke : this.c.smoke);
  }

  drawSlot(x, y, z) {
    V.set(x, y + 0.03, z); Q.identity(); S.set(1, 1, 1);
    T.compose(V, Q, S);
    this.b.slot.push(T);
  }

  dispose() { for (const k in this.b) this.b[k].dispose(); }
}
