// Minimap, shared by every renderer. Draws terrain, roads, buildings and
// units, plus the ground footprint of the camera (renderer.viewPolygon()).
import { T_MOUNTAIN } from '../core/map.js';
import { ORE_RGB, TERRAIN_RGB, makeCanvas } from './art2d.js';

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(world, renderer) {
    const m = world.map, g = this.ctx, canvas = this.canvas;
    const W = m.W, H = m.H;
    if (!this.img || this.img.width !== W || this.img.height !== H) {
      this.img = g.createImageData(W, H);
      this.tmp = makeCanvas(W, H);
    }
    const d = this.img.data;
    for (let i = 0; i < m.N; i++) {
      const c = TERRAIN_RGB[m.terrain[i]];
      let r = c[0], gg = c[1], b = c[2];
      if (m.tree[i] >= 3) { r = 46; gg = 88; b = 36; }
      if (m.stone[i]) { r = 170; gg = 168; b = 160; }
      if (m.field[i]) { r = 190; gg = 160; b = 70; }
      if (m.road[i]) { r = 170; gg = 140; b = 100; }
      if (m.ore[i] && m.terrain[i] === T_MOUNTAIN) { const o = ORE_RGB[m.ore[i]]; r = (r + o[0]) / 2; gg = (gg + o[1]) / 2; b = (b + o[2]) / 2; }
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    for (const bld of world.buildings.values()) {
      const col = bld.owner === 0 ? [70, 130, 255] : [230, 60, 50];
      for (let y = bld.y; y < bld.y + bld.h; y++) for (let x = bld.x; x < bld.x + bld.w; x++) {
        const o = (y * W + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
      }
    }
    this.tmp.getContext('2d').putImageData(this.img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.tmp, 0, 0, canvas.width, canvas.height);
    const sx = canvas.width / W, sy = canvas.height / H;
    for (const u of world.units.values()) {
      if (u.inside) continue;
      g.fillStyle = u.owner === 0 ? (u.kind === 'soldier' ? '#9fd0ff' : '#5f8fe0') : (u.kind === 'soldier' ? '#ffb0a0' : '#c05040');
      const r = u.kind === 'soldier' ? 2.2 : 1.4;
      g.fillRect(u.x * sx - r / 2, u.y * sy - r / 2, r, r);
    }
    const poly = renderer.viewPolygon();
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.beginPath();
    poly.forEach(([x, y], k) => (k ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)));
    g.closePath(); g.stroke();
  }
}
