// ---------------------------------------------------------------------------
// Procedural low-poly models for the 3D renderer.
//
// Buildings are assembled from primitives in a local frame: origin at the
// footprint's north-west corner on the ground, +x east, +z south (the front
// with the entrance), +y up; one unit = one tile. Parts are merged per
// material, so a building is a handful of draw calls. Models are cached per
// (type, owner) and instanced as meshes sharing geometry and materials.
//
// To restyle a building, edit STYLE / the special builders below. Swapping in
// authored glTF models later only needs buildBuilding() to return a Group
// with the same frame and the same `meta` fields.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { BUILDINGS, PLAYER_COLORS } from '../../core/data.js';

// ------------------------------------------------------------ materials
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...opts });
    matCache.set(key, m);
  }
  return m;
}
export const C = {
  plaster: '#e6d9bb', timber: '#5a3a22', stone: '#a9a396', stoneDark: '#8f897d', plank: '#8c5d34',
  roofTile: '#a4442c', roofThatch: '#c9a257', roofSlate: '#5d6673', door: '#2e1c10', window: '#2a2a30',
  dirt: '#7a5c3a', log: '#6e4524', logEnd: '#c99a62', hay: '#d8b54a', rock: '#7d7366', pig: '#f0a4a4',
  horse: '#6b4424', metal: '#9aa0a8', glow: '#ff8a2a', crate: '#9b6b3a', fence: '#5a3a1c',
};

// ------------------------------------------------------ geometry helpers
// Each helper returns a geometry already moved into place.
function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(rt, rb, h, x, y, z, seg = 8) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); return g; }
// A cylinder turned onto its side: axis 'z' lies east-west, 'x' faces south.
function lying(r, len, x, y, z, axis, seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
function cone(r, h, x, y, z, seg = 8) { const g = new THREE.ConeGeometry(r, h, seg); g.translate(x, y, z); return g; }
function ball(r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail); g.scale(sx, sy, sz); g.translate(x, y, z); return g;
}
// Gable roof: triangular prism with the ridge along x.
function gable(w, d, h, x, y, z) {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, -hd, hw, 0, -hd, hw, h, 0, -hw, h, 0, // back slope
    -hw, h, 0, hw, h, 0, hw, 0, hd, -hw, 0, hd,   // front slope
    -hw, 0, -hd, -hw, h, 0, -hw, 0, hd,            // west gable
    hw, 0, -hd, hw, 0, hd, hw, h, 0,               // east gable
    -hw, 0, -hd, -hw, 0, hd, hw, 0, hd, hw, 0, -hd, // underside
  ];
  const idx = [0, 3, 2, 0, 2, 1, 4, 7, 6, 4, 6, 5, 8, 10, 9, 11, 13, 12, 14, 15, 16, 14, 16, 17];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.translate(x, y, z);
  return g.toNonIndexed();
}

// Collects geometries per material and merges them into meshes.
class Builder {
  constructor() { this.parts = new Map(); }
  add(color, geo, opts) {
    const m = mat(color, opts);
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m).push(geo.index ? geo.toNonIndexed() : geo);
    return this;
  }
  build() {
    const g = new THREE.Group();
    for (const [m, geos] of this.parts) {
      for (const geo of geos) { if (!geo.attributes.uv) continue; geo.deleteAttribute('uv'); }
      const merged = mergeGeometries(geos, false);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}

function flag(B, x, y, color, h = 0.45) {
  B.add(C.timber, cyl(0.015, 0.015, h, x, y + h / 2, 0.02, 5));
  B.add(color, box(0.26, 0.15, 0.015, x + 0.13, y + h - 0.09, 0.02));
}

// ------------------------------------------------------------ buildings
const STYLE = {
  storehouse: { wall: 'timber', roof: 'roofTile', H: 1.0, rH: 0.7, props: ['crates'], bigDoor: true },
  school: { wall: 'stone', roof: 'roofSlate', H: 0.9, rH: 0.6, bell: true },
  inn: { wall: 'timber', roof: 'roofTile', H: 0.9, rH: 0.6, chimney: true, sign: '#d9a53a', props: ['barrels'] },
  woodcutter: { wall: 'plank', roof: 'roofThatch', H: 0.65, rH: 0.5, props: ['logs'] },
  sawmill: { wall: 'plank', roof: 'roofTile', H: 0.65, rH: 0.45, props: ['logs', 'planks'] },
  farm: { wall: 'timber', roof: 'roofThatch', H: 0.75, rH: 0.55, props: ['hay'] },
  bakery: { wall: 'stone', roof: 'roofTile', H: 0.7, rH: 0.45, chimney: true, sign: '#c98a3a' },
  swine: { wall: 'plank', roof: 'roofThatch', H: 0.6, rH: 0.4, yard: 'pen' },
  butcher: { wall: 'timber', roof: 'roofTile', H: 0.7, rH: 0.45, sign: '#b8452f' },
  vineyard: { wall: 'stone', roof: 'roofTile', H: 0.7, rH: 0.45, props: ['barrels'] },
  fisher: { wall: 'plank', roof: 'roofThatch', H: 0.6, rH: 0.45, props: ['net'] },
  tannery: { wall: 'plank', roof: 'roofTile', H: 0.65, rH: 0.4, props: ['hides'] },
  smelter: { wall: 'stone', roof: 'roofSlate', H: 0.75, rH: 0.4, chimney: true, glow: true },
  mint: { wall: 'stone', roof: 'roofSlate', H: 0.75, rH: 0.4, chimney: true, glow: true, sign: '#f0c419' },
  weaponshop: { wall: 'timber', roof: 'roofTile', H: 0.7, rH: 0.45, props: ['rack'] },
  armorshop: { wall: 'timber', roof: 'roofTile', H: 0.7, rH: 0.45, props: ['shields'] },
  weaponsmith: { wall: 'stone', roof: 'roofSlate', H: 0.75, rH: 0.45, chimney: true, glow: true, props: ['anvil'] },
  armorsmith: { wall: 'stone', roof: 'roofSlate', H: 0.75, rH: 0.45, chimney: true, glow: true, props: ['anvil'] },
  stables: { wall: 'plank', roof: 'roofThatch', H: 0.65, rH: 0.45, yard: 'paddock' },
};

function wallColor(kind) { return kind === 'stone' ? C.stone : kind === 'plank' ? C.plank : C.plaster; }

function house(B, def, st, color, meta) {
  const W = def.w, D = def.h;
  const bw = st.yard ? Math.min(2, W) : W;
  const x0 = 0.12, x1 = bw - 0.12, z0 = 0.25, z1 = D - 0.12;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = st.H;
  B.add(C.stoneDark, box(w + 0.08, 0.08, d + 0.08, cx, 0.04, cz));
  B.add(wallColor(st.wall), box(w, H, d, cx, H / 2 + 0.04, cz));
  if (st.wall === 'timber') { // half-timbering on the front and sides
    for (let x = x0 + 0.02; x <= x1; x += Math.max(0.3, w / Math.round(w / 0.5))) B.add(C.timber, box(0.045, H, 0.02, x, H / 2 + 0.04, z1 + 0.005));
    B.add(C.timber, box(w, 0.045, 0.02, cx, H * 0.55, z1 + 0.005));
    B.add(C.timber, box(w, 0.05, 0.02, cx, H + 0.02, z1 + 0.005));
  }
  // Roof
  const [rc] = [C[st.roof]];
  B.add(rc, gable(w + 0.2, d + 0.22, st.rH, cx, H + 0.04, cz));
  // Door, windows
  const dcx = Math.floor(W / 2) + 0.5;
  if (dcx < x1) {
    const dw = st.bigDoor ? 0.55 : 0.28, dh = st.bigDoor ? 0.6 : 0.45;
    B.add(C.door, box(dw, dh, 0.04, dcx, dh / 2 + 0.04, z1 + 0.01));
  }
  for (let x = x0 + 0.28; x < x1 - 0.18; x += 0.55) {
    if (Math.abs(x - dcx) < 0.35) continue;
    B.add(C.window, box(0.16, 0.16, 0.03, x, H * 0.62, z1 + 0.012));
  }
  if (st.chimney) {
    const chx = x1 - 0.35;
    B.add(C.stoneDark, box(0.18, 0.5, 0.18, chx, H + st.rH * 0.6, cz - d * 0.15));
    meta.chimney = new THREE.Vector3(chx, H + st.rH * 0.6 + 0.3, cz - d * 0.15);
  }
  if (st.glow) B.add(C.glow, box(0.2, 0.16, 0.03, x0 + 0.3, 0.2, z1 + 0.014), { emissive: '#ff6a10', emissiveIntensity: 1.2 });
  if (st.bell) {
    B.add(C.stone, box(0.26, 0.4, 0.26, cx, H + st.rH + 0.1, cz));
    B.add(C.roofSlate, cone(0.24, 0.35, cx, H + st.rH + 0.47, cz, 4));
    B.add('#d4a93a', ball(0.06, cx, H + st.rH + 0.12, cz + 0.14));
  }
  if (st.sign) {
    B.add(C.timber, box(0.3, 0.03, 0.03, x0 + 0.08, H * 0.8, z1 + 0.15));
    B.add(st.sign, box(0.18, 0.16, 0.02, x0 + 0.12, H * 0.68, z1 + 0.25));
  }
  flag(B, x1 - 0.2, H + st.rH + 0.04, color);
  if (st.yard) yard(B, bw, W, D, st.yard);
  for (const p of st.props || []) props(B, p, W, D);
}

function yard(B, x0, W, D, kind) {
  const x1 = W - 0.08, z0 = 0.3, z1 = D - 0.1;
  B.add(kind === 'pen' ? '#7d6a45' : '#8a7a4a', box(x1 - x0, 0.03, z1 - z0, (x0 + x1) / 2, 0.02, (z0 + z1) / 2));
  for (let x = x0; x <= x1 + 0.01; x += 0.2) { B.add(C.fence, box(0.035, 0.2, 0.035, x, 0.1, z0)); B.add(C.fence, box(0.035, 0.2, 0.035, x, 0.1, z1)); }
  for (let z = z0; z <= z1; z += 0.2) B.add(C.fence, box(0.035, 0.2, 0.035, x1, 0.1, z));
  B.add(C.fence, box(x1 - x0, 0.03, 0.03, (x0 + x1) / 2, 0.16, z0)); B.add(C.fence, box(x1 - x0, 0.03, 0.03, (x0 + x1) / 2, 0.16, z1));
  B.add(C.fence, box(0.03, 0.03, z1 - z0, x1, 0.16, (z0 + z1) / 2));
  if (kind === 'pen') {
    for (const [px, pz] of [[0.3, 0.6], [0.6, 1.2], [0.25, 1.5]]) {
      B.add(C.pig, ball(0.1, x0 + px, 0.1, z0 + pz, 1.4, 0.8, 0.9));
      B.add(C.pig, ball(0.06, x0 + px + 0.14, 0.12, z0 + pz));
    }
  } else {
    B.add(C.horse, box(0.14, 0.14, 0.4, x0 + 0.45, 0.25, z0 + 0.8));
    B.add(C.horse, box(0.1, 0.18, 0.12, x0 + 0.45, 0.36, z0 + 1.02));
    for (const [lx, lz] of [[-0.05, -0.15], [0.05, -0.15], [-0.05, 0.15], [0.05, 0.15]]) B.add(C.horse, box(0.04, 0.2, 0.04, x0 + 0.45 + lx, 0.1, z0 + 0.8 + lz));
    B.add(C.hay, box(0.3, 0.2, 0.25, x0 + 0.3, 0.1, z1 - 0.3));
  }
}

function props(B, p, W, D) {
  const z = D - 0.05;
  switch (p) {
    case 'logs': for (let k = 0; k < 3; k++) B.add(C.log, lying(0.06, 0.5, W - 0.35, 0.07 + k * 0.1, z - 0.12 - (k % 2) * 0.03, 'z')); break;
    case 'planks': B.add(C.logEnd, box(0.45, 0.06, 0.18, 0.35, 0.05, z - 0.1)); B.add(C.logEnd, box(0.4, 0.06, 0.18, 0.37, 0.11, z - 0.1)); break;
    case 'crates': for (const [x, y] of [[W - 0.35, 0.1], [W - 0.62, 0.1], [W - 0.48, 0.3]]) B.add(C.crate, box(0.22, 0.2, 0.22, x, y, z - 0.15)); break;
    case 'barrels': for (const x of [0.25, 0.48]) B.add('#7a4a26', cyl(0.09, 0.09, 0.24, x, 0.12, z - 0.12, 8)); break;
    case 'hay': B.add(C.hay, ball(0.26, W - 0.35, 0.18, z - 0.2, 1, 0.8, 1, 1)); break;
    case 'net': B.add('#e6e6d2', box(0.4, 0.3, 0.01, W - 0.4, 0.2, z - 0.05)); break;
    case 'hides': B.add(C.timber, box(0.6, 0.03, 0.03, W - 0.4, 0.42, z - 0.1)); for (let k = 0; k < 3; k++) B.add(k % 2 ? '#d9a07a' : '#b8845c', box(0.15, 0.26, 0.01, W - 0.6 + k * 0.19, 0.28, z - 0.1)); break;
    case 'rack': B.add(C.timber, box(0.5, 0.04, 0.04, W - 0.38, 0.45, z - 0.1)); for (let k = 0; k < 3; k++) B.add(C.metal, box(0.03, 0.45, 0.03, W - 0.52 + k * 0.13, 0.25, z - 0.08)); break;
    case 'shields': for (let k = 0; k < 2; k++) B.add('#9b6b3a', lying(0.11, 0.03, W - 0.5 + k * 0.25, 0.2, z - 0.05, 'x')); break;
    case 'anvil': B.add('#333', box(0.3, 0.1, 0.14, W - 0.4, 0.2, z - 0.15)); B.add('#333', box(0.14, 0.15, 0.1, W - 0.4, 0.08, z - 0.15)); break;
  }
}

function crenels(B, color, x0, x1, y, z0, z1) {
  for (let x = x0; x < x1 - 0.05; x += 0.22) { B.add(color, box(0.12, 0.12, 0.12, x + 0.06, y + 0.06, z0 + 0.06)); B.add(color, box(0.12, 0.12, 0.12, x + 0.06, y + 0.06, z1 - 0.06)); }
  for (let z = z0 + 0.22; z < z1 - 0.2; z += 0.22) { B.add(color, box(0.12, 0.12, 0.12, x0 + 0.06, y + 0.06, z + 0.06)); B.add(color, box(0.12, 0.12, 0.12, x1 - 0.06, y + 0.06, z + 0.06)); }
}

function tower(B, W, D, color) {
  const x0 = 0.3, x1 = W - 0.3, z0 = 0.3, z1 = D - 0.2, H = 2.1;
  B.add(C.stone, box(x1 - x0, H, z1 - z0, W / 2, H / 2, (z0 + z1) / 2));
  B.add(C.stoneDark, box(x1 - x0 + 0.16, 0.12, z1 - z0 + 0.16, W / 2, H + 0.06, (z0 + z1) / 2));
  crenels(B, C.stoneDark, x0 - 0.08, x1 + 0.08, H + 0.12, z0 - 0.08, z1 + 0.08);
  B.add(C.door, box(0.3, 0.45, 0.04, Math.floor(W / 2) + 0.5, 0.23, z1 + 0.01));
  B.add(C.window, box(0.08, 0.22, 0.03, W / 2, H * 0.7, z1 + 0.01));
  flag(B, W / 2, H + 0.12, color, 0.6);
}

function barracks(B, W, D, color) {
  const H = 0.85;
  // curtain walls round a courtyard
  B.add('#8a7a5a', box(W - 0.3, 0.03, D - 0.3, W / 2, 0.02, D / 2));
  B.add(C.stone, box(W - 0.2, H, 0.22, W / 2, H / 2, D - 0.2));
  B.add(C.stone, box(W - 0.2, H, 0.22, W / 2, H / 2, 0.3));
  B.add(C.stone, box(0.22, H, D - 0.5, 0.2, H / 2, D / 2 + 0.05));
  B.add(C.stone, box(0.22, H, D - 0.5, W - 0.2, H / 2, D / 2 + 0.05));
  crenels(B, C.stoneDark, 0.1, W - 0.1, H, D - 0.31, D - 0.09);
  // keep
  B.add(C.stone, box(1.2, 1.6, 1.0, W / 2, 0.8, 0.95));
  B.add(C.stoneDark, box(1.32, 0.1, 1.12, W / 2, 1.65, 0.95));
  crenels(B, C.stoneDark, W / 2 - 0.66, W / 2 + 0.66, 1.7, 0.39, 1.51);
  // corner turrets
  for (const [x, z] of [[0.25, D - 0.25], [W - 0.25, D - 0.25], [0.25, 0.3], [W - 0.25, 0.3]]) {
    B.add(C.stone, cyl(0.24, 0.26, 1.2, x, 0.6, z, 8));
    B.add(C.roofSlate, cone(0.3, 0.4, x, 1.4, z, 8));
  }
  B.add(C.door, box(0.6, 0.6, 0.06, Math.floor(W / 2) + 0.5, 0.3, D - 0.08));
  B.add(color, box(0.2, 0.36, 0.02, 0.9, 0.5, D - 0.08));
  B.add(color, box(0.2, 0.36, 0.02, W - 0.9, 0.5, D - 0.08));
  flag(B, W / 2, 1.75, color, 0.7);
}

function mill(B, W, D, color, meta) {
  const cx = W / 2, cz = D / 2;
  B.add('#b3aa98', cyl(0.42, 0.55, 1.5, cx, 0.75, cz, 10));
  B.add(C.roofThatch, cone(0.55, 0.6, cx, 1.8, cz, 10));
  B.add(C.door, box(0.3, 0.42, 0.05, Math.floor(W / 2) + 0.5, 0.21, cz + 0.52));
  B.add(C.window, box(0.14, 0.14, 0.03, cx, 1.0, cz + 0.48));
  flag(B, cx, 2.05, color, 0.3);
  meta.hub = new THREE.Vector3(cx, 1.35, cz + 0.55);
}

function mine(B, W, D, type, color) {
  const oc = type === 'coalmine' ? '#26221f' : type === 'ironmine' ? '#a45c3a' : '#e9c23a';
  B.add(C.rock, ball(1.0, W / 2, 0.2, D / 2 - 0.2, 1.1, 0.7, 0.9, 1));
  const dcx = Math.floor(W / 2) + 0.5;
  B.add('#140e0a', box(0.55, 0.6, 0.3, dcx, 0.3, D - 0.25));
  B.add(C.log, box(0.08, 0.7, 0.08, dcx - 0.32, 0.35, D - 0.1));
  B.add(C.log, box(0.08, 0.7, 0.08, dcx + 0.32, 0.35, D - 0.1));
  B.add(C.log, box(0.76, 0.08, 0.1, dcx, 0.72, D - 0.1));
  B.add(oc, ball(0.28, 0.4, 0.05, D - 0.25, 1.2, 0.5, 1));
  B.add(C.fence, box(0.35, 0.16, 0.24, W - 0.4, 0.14, D - 0.25));
  B.add(oc, ball(0.14, W - 0.4, 0.24, D - 0.25, 1.2, 0.5, 1));
  flag(B, 0.35, 0.6, color, 0.5);
}

function quarry(B, W, D, color) {
  B.add(C.plank, box(1.0, 0.55, 0.7, 0.6, 0.28, D - 0.5));
  B.add(C.roofTile, box(1.2, 0.06, 0.95, 0.6, 0.62, D - 0.5, 0).rotateX(0));
  B.add(C.door, box(0.28, 0.4, 0.03, 0.7, 0.2, D - 0.14));
  for (const [x, y, z] of [[1.4, 0.1, D - 0.3], [1.66, 0.1, D - 0.3], [1.53, 0.3, D - 0.3], [1.5, 0.1, D - 0.75]]) B.add('#b8b2a6', box(0.24, 0.2, 0.22, x, y, z));
  flag(B, 1.1, 0.64, color, 0.4);
}

export function buildBuilding(type, owner) {
  const def = BUILDINGS[type];
  const color = PLAYER_COLORS[owner].main;
  const B = new Builder();
  const meta = { chimney: null, hub: null };
  switch (type) {
    case 'tower': tower(B, def.w, def.h, color); break;
    case 'barracks': barracks(B, def.w, def.h, color); break;
    case 'mill': mill(B, def.w, def.h, color, meta); break;
    case 'quarry': quarry(B, def.w, def.h, color); break;
    case 'coalmine': case 'ironmine': case 'goldmine': mine(B, def.w, def.h, type, color); break;
    default: house(B, def, STYLE[type] || STYLE.storehouse, color, meta);
  }
  const g = B.build();
  g.userData.meta = meta;
  return g;
}

// Windmill sails, animated by the renderer.
export function buildSails() {
  const B = new Builder();
  B.add('#4a3420', box(0.06, 1.8, 0.04, 0, 0, 0));
  B.add('#4a3420', box(1.8, 0.06, 0.04, 0, 0, 0));
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const g = box(0.16, 0.6, 0.02, 0.1, 0.55, 0.02);
    g.rotateZ(a);
    B.add('#ebe1c8', g);
  }
  return B.build();
}

// Clone a cached model: shares geometry and materials.
const modelCache = new Map();
export function instanceBuilding(type, owner) {
  const k = type + ':' + owner;
  let src = modelCache.get(k);
  if (!src) { src = buildBuilding(type, owner); modelCache.set(k, src); }
  const g = src.clone();
  g.userData.meta = src.userData.meta;
  return g;
}

// ------------------------------------------------------------- nature
export function treeGeometries() {
  const trunk = cyl(0.05, 0.08, 0.5, 0, 0.25, 0, 6);
  const crown = mergeGeometries([
    ball(0.36, 0, 0.78, 0, 1, 0.9, 1, 1),
    ball(0.24, -0.2, 0.62, 0.08, 1, 1, 1, 0),
    ball(0.25, 0.2, 0.66, -0.06, 1, 1, 1, 0),
    ball(0.22, 0, 1.02, 0, 1, 1, 1, 0),
  ].map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
  const pine = mergeGeometries([cone(0.36, 0.55, 0, 0.55, 0, 7), cone(0.28, 0.5, 0, 0.85, 0, 7), cone(0.18, 0.42, 0, 1.12, 0, 7)]
    .map(g => { g.deleteAttribute('uv'); return g.toNonIndexed(); }));
  const pineTrunk = cyl(0.04, 0.06, 0.4, 0, 0.2, 0, 5);
  return { trunk, crown, pine, pineTrunk };
}

export function rockGeometry() { return new THREE.IcosahedronGeometry(0.2, 0); }
