// ---------------------------------------------------------------------------
// 3D terrain: the map as 16×16-tile chunk meshes over a vertex height grid.
//
// Each chunk has its own canvas texture. The base layer reuses the 2D terrain
// painter (renderTerrainChunk) with reduced baked shading because the mesh is
// lit for real. Roads, fields and plans are painted on top with the same
// painters the 2D renderer uses, and a chunk is repainted only when a
// per-tile signature changes. Ground under buildings is flattened visually.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FIELD_GROW_TIME, T_WATER, WINE_GROW_TIME } from '../../core/map.js';
import { TERRAIN_RGB, makeCanvas, paintTileOverlay, renderTerrainChunk } from '../art2d.js';

export const HS = 0.55;      // vertical scale: map.height units -> tiles
export const TEX_PX = 32;    // texture pixels per tile
const CS = 16;               // chunk size in tiles

export class Terrain {
  constructor(world, scene) {
    this.world = world;
    const m = world.map;
    this.map = m;
    this.W = m.W; this.H = m.H;
    this.VW = m.W + 1;
    this.waterY = 0.3 * HS;
    this.vy = new Float32Array((m.W + 1) * (m.H + 1));
    this.computeHeights();
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.chunks = [];
    this.ccols = Math.ceil(m.W / CS); this.crows = Math.ceil(m.H / CS);
    for (let cy = 0; cy < this.crows; cy++) for (let cx = 0; cx < this.ccols; cx++) this.chunks.push(this.makeChunk(cx, cy));
    this.sig = new Int32Array(m.N).fill(-1);
    this.flattened = new Set();
    // Water surface
    const wg = new THREE.PlaneGeometry(m.W + 40, m.H + 40);
    wg.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x2f6390, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.78 });
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.set(m.W / 2, this.waterY, m.H / 2);
    this.water.receiveShadow = true;
    scene.add(this.water);
  }

  computeHeights() {
    const m = this.map, VW = this.VW, W = m.W, H = m.H, wy = this.waterY;
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
      let land = 0, water = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        if (m.terrain[ty * W + tx] === T_WATER) water++; else land++;
      }
      let h = m.height[y * VW + x] * HS;
      if (!water) h = Math.max(h, wy + 0.06);
      else if (!land) h = Math.min(h, wy - 0.18);
      else h = wy - 0.03;
      this.vy[y * VW + x] = h;
    }
  }

  makeChunk(cx, cy) {
    const x0 = cx * CS, y0 = cy * CS;
    const nx = Math.min(CS, this.W - x0), ny = Math.min(CS, this.H - y0);
    const geo = new THREE.BufferGeometry();
    const vcount = (nx + 1) * (ny + 1);
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), uv = new Float32Array(vcount * 2);
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      uv[k * 2] = i / CS; uv[k * 2 + 1] = 1 - j / CS;
    }
    const idx = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const canvas = makeCanvas(CS * TEX_PX, CS * TEX_PX);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = `chunk ${cx},${cy}`;
    this.group.add(mesh);
    const ch = { cx, cy, x0, y0, nx, ny, geo, canvas, ctx: canvas.getContext('2d'), tex, mesh, base: null, dirty: true };
    this.writeGeometry(ch);
    this.paintPlaceholder(ch);
    return ch;
  }

  // Positions and seamless normals from the global height grid.
  writeGeometry(ch) {
    const { x0, y0, nx, ny } = ch;
    const pos = ch.geo.attributes.position.array, nor = ch.geo.attributes.normal.array;
    const VW = this.VW, vy = this.vy, W = this.W, H = this.H;
    const hv = (x, y) => vy[Math.min(H, Math.max(0, y)) * VW + Math.min(W, Math.max(0, x))];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, x = x0 + i, y = y0 + j;
      pos[k * 3] = x; pos[k * 3 + 1] = hv(x, y); pos[k * 3 + 2] = y;
      const dx = (hv(x + 1, y) - hv(x - 1, y)) / 2, dz = (hv(x, y + 1) - hv(x, y - 1)) / 2;
      const len = Math.hypot(dx, 1, dz);
      nor[k * 3] = -dx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = -dz / len;
    }
    ch.geo.attributes.position.needsUpdate = true;
    ch.geo.attributes.normal.needsUpdate = true;
    ch.geo.computeBoundingSphere();
    ch.geo.computeBoundingBox();
  }

  paintPlaceholder(ch) {
    const g = ch.ctx, m = this.map;
    for (let j = 0; j < ch.ny; j++) for (let i = 0; i < ch.nx; i++) {
      const c = TERRAIN_RGB[m.terrain[(ch.y0 + j) * m.W + ch.x0 + i]];
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(i * TEX_PX, j * TEX_PX, TEX_PX, TEX_PX);
    }
    ch.tex.needsUpdate = true;
  }

  // Bilinear ground height at tile coords (x, y).
  heightAt(x, y) {
    const W = this.W, H = this.H, VW = this.VW, vy = this.vy;
    x = Math.min(W, Math.max(0, x)); y = Math.min(H, Math.max(0, y));
    const ix = Math.min(W - 1, Math.floor(x)), iy = Math.min(H - 1, Math.floor(y));
    const fx = x - ix, fy = y - iy;
    const a = vy[iy * VW + ix], b = vy[iy * VW + ix + 1], c = vy[(iy + 1) * VW + ix], d = vy[(iy + 1) * VW + ix + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  // Level the ground under a building (visual only; the simulation is 2D).
  flatten(b) {
    if (this.flattened.has(b.id)) return this.baseHeight(b);
    this.flattened.add(b.id);
    const VW = this.VW;
    let s = 0, n = 0;
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) { s += this.vy[y * VW + x]; n++; }
    const avg = s / n;
    if (b.def.kind === 'mine') return avg; // mines dig into the slope instead
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) this.vy[y * VW + x] = avg;
    const touched = new Set();
    for (let y = b.y - 1; y <= b.y + b.h + 1; y++) for (let x = b.x - 1; x <= b.x + b.w + 1; x++) {
      const cx = Math.floor(Math.min(this.W - 1, Math.max(0, x)) / CS), cy = Math.floor(Math.min(this.H - 1, Math.max(0, y)) / CS);
      touched.add(cy * this.ccols + cx);
    }
    for (const k of touched) this.writeGeometry(this.chunks[k]);
    return avg;
  }

  baseHeight(b) {
    const VW = this.VW;
    let s = 0, n = 0;
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) { s += this.vy[y * VW + x]; n++; }
    return s / n;
  }

  // Detect overlay changes and repaint dirty chunks. `baseBudget` limits the
  // expensive base-texture renders per call.
  update(visible, baseBudget) {
    const m = this.map, W = m.W, sig = this.sig;
    for (let i = 0; i < m.N; i++) {
      let s = m.road[i] | ((m.roadOwner[i] + 1) << 1) | (m.field[i] << 3) | (m.plan[i] << 9) | ((m.planOwner[i] + 1) << 11);
      if (m.field[i]) {
        const st = m.fieldStage[i];
        const grow = st === 1 ? Math.min(3, Math.floor(m.fieldT[i] / (m.field[i] === 1 ? FIELD_GROW_TIME : WINE_GROW_TIME) * 4)) : 0;
        s |= (st << 5) | (grow << 7);
      }
      if (s !== sig[i]) {
        sig[i] = s;
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= m.H) continue;
          this.chunks[Math.floor(ty / CS) * this.ccols + Math.floor(tx / CS)].dirty = true;
        }
      }
    }
    // Visible chunks first, then the rest in the background.
    const order = this.chunks.slice().sort((a, b) => (visible(b) ? 1 : 0) - (visible(a) ? 1 : 0));
    for (const ch of order) {
      if (!ch.base) {
        if (baseBudget <= 0) continue;
        baseBudget--;
        ch.base = renderTerrainChunk(m, ch.cx, ch.cy, this.world.seed, 0.35);
        ch.dirty = true;
      }
      if (ch.dirty) this.paint(ch);
    }
  }

  paint(ch) {
    const g = ch.ctx, m = this.map, W = m.W;
    g.drawImage(ch.base, 0, 0);
    for (let j = 0; j < ch.ny; j++) for (let i = 0; i < ch.nx; i++) {
      const x = ch.x0 + i, y = ch.y0 + j, t = y * W + x;
      if (m.field[t] || m.road[t] || m.plan[t]) paintTileOverlay(g, m, t, x, y, i * TEX_PX, j * TEX_PX, TEX_PX, false);
    }
    ch.tex.needsUpdate = true;
    ch.dirty = false;
  }

  meshes() { return this.chunks.map(c => c.mesh); }

  dispose() {
    for (const ch of this.chunks) { ch.geo.dispose(); ch.tex.dispose(); ch.mesh.material.dispose(); }
    this.group.removeFromParent();
    this.water.geometry.dispose(); this.waterMat.dispose();
    this.water.removeFromParent();
  }
}
