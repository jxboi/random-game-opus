'use strict';
// ---------------------------------------------------------------------------
// Procedural art. Sprites are drawn once into offscreen canvases at SPR px per
// tile and scaled when drawn. Nothing here touches the simulation.
// ---------------------------------------------------------------------------

const SPR = 64; // sprite resolution (px per tile)

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ------------------------------------------------------------ terrain chunks
const TERRAIN_RGB = {
  [T_GRASS]: [92, 138, 56],
  [T_WATER]: [44, 92, 132],
  [T_MOUNTAIN]: [132, 120, 104],
  [T_SAND]: [214, 194, 138],
};
const ORE_RGB = [null, [34, 30, 28], [176, 96, 58], [242, 200, 56]];

function renderTerrainChunk(map, cx, cy, seed) {
  const S = 16, T = TILE, W = map.W, H = map.H;
  const size = S * T;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const x0 = cx * S, y0 = cy * S;
  const P = 2; // tile padding around the chunk for warped lookups
  const tcol = (x, y) => {
    x = clamp(x, 0, W - 1); y = clamp(y, 0, H - 1);
    const i = y * W + x;
    const t = map.terrain[i];
    const base = TERRAIN_RGB[t];
    const v = (hash2(x, y, seed) - 0.5) * (t === T_WATER ? 0.04 : 0.08);
    let r = base[0] * (1 + v), g = base[1] * (1 + v), b = base[2] * (1 + v);
    if (t === T_GRASS) { const mo = valueNoise(x / 6, y / 6, seed + 5) - 0.5; r += mo * 26; g += mo * 18; b += mo * 6; }
    if (t === T_WATER) {
      let near = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = clamp(x + dx, 0, W - 1), ny = clamp(y + dy, 0, H - 1);
        if (map.terrain[ny * W + nx] !== T_WATER) near++;
      }
      const deep = 1 - Math.min(1, near / 6);
      r -= deep * 18; g -= deep * 26; b -= deep * 10;
    }
    return [r, g, b];
  };
  const TS = S + 2 * P;
  const TC = new Array(TS * TS);
  for (let ty = 0; ty < TS; ty++) for (let tx = 0; tx < TS; tx++) TC[ty * TS + tx] = tcol(x0 + tx - P, y0 + ty - P);
  const tileAt = (tx, ty) => { // global tile -> index into map arrays (clamped)
    tx = clamp(tx, 0, W - 1); ty = clamp(ty, 0, H - 1);
    return ty * W + tx;
  };
  // Coarse domain-warp field (every 4 px), bilinearly sampled per pixel.
  const G = 4, GN = size / G + 1;
  const warpX = new Float32Array(GN * GN), warpY = new Float32Array(GN * GN);
  for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
    const px = x0 * T + gx * G, py = y0 * T + gy * G;
    warpX[gy * GN + gx] = (valueNoise(px / 13, py / 13, seed + 21) - 0.5) * 0.75 + (valueNoise(px / 5, py / 5, seed + 23) - 0.5) * 0.2;
    warpY[gy * GN + gx] = (valueNoise(px / 13, py / 13, seed + 22) - 0.5) * 0.75 + (valueNoise(px / 5, py / 5, seed + 24) - 0.5) * 0.2;
  }
  const hW = W + 1;
  const hAt = (vx, vy) => map.height[clamp(vy, 0, H) * hW + clamp(vx, 0, W)];
  for (let py = 0; py < size; py++) {
    const gy0 = (py / G) | 0, gfy = (py % G) / G;
    const ty = (py / T) | 0, fy = (py % T + 0.5) / T;
    for (let px = 0; px < size; px++) {
      const gx0 = (px / G) | 0, gfx = (px % G) / G;
      const k00 = gy0 * GN + gx0;
      const wxo = warpX[k00] * (1 - gfx) * (1 - gfy) + warpX[k00 + 1] * gfx * (1 - gfy) + warpX[k00 + GN] * (1 - gfx) * gfy + warpX[k00 + GN + 1] * gfx * gfy;
      const wyo = warpY[k00] * (1 - gfx) * (1 - gfy) + warpY[k00 + 1] * gfx * (1 - gfy) + warpY[k00 + GN] * (1 - gfx) * gfy + warpY[k00 + GN + 1] * gfx * gfy;
      // warped position in chunk-local tile units
      const lx = px / T + wxo, ly = py / T + wyo;
      // blend between the four nearest tile centres with a sharpened ramp
      const bx = lx - 0.5, by = ly - 0.5;
      const ix = Math.floor(bx), iy = Math.floor(by);
      const sx = smoothstep(0.3, 0.7, bx - ix), sy = smoothstep(0.3, 0.7, by - iy);
      const A = TC[(iy + P) * TS + ix + P], B = TC[(iy + P) * TS + ix + 1 + P];
      const C = TC[(iy + 1 + P) * TS + ix + P], D = TC[(iy + 1 + P) * TS + ix + 1 + P];
      let r = (A[0] * (1 - sx) + B[0] * sx) * (1 - sy) + (C[0] * (1 - sx) + D[0] * sx) * sy;
      let g = (A[1] * (1 - sx) + B[1] * sx) * (1 - sy) + (C[1] * (1 - sx) + D[1] * sx) * sy;
      let b = (A[2] * (1 - sx) + B[2] * sx) * (1 - sy) + (C[2] * (1 - sx) + D[2] * sx) * sy;
      // dominant tile drives detail texture
      const gxT = x0 + Math.floor(lx), gyT = y0 + Math.floor(ly);
      const di = tileAt(gxT, gyT);
      const t = map.terrain[di];
      // relief shading from unwarped vertex heights, light from the upper left
      const tx = x0 + ((px / T) | 0), tyG = y0 + ty;
      const fx = (px % T + 0.5) / T;
      const h00 = hAt(tx, tyG), h10 = hAt(tx + 1, tyG), h01 = hAt(tx, tyG + 1), h11 = hAt(tx + 1, tyG + 1);
      const dhdx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const dhdy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const kk = t === T_MOUNTAIN ? 0.9 : t === T_WATER ? 0.05 : 0.45;
      let sh = 1 + (-dhdx * 0.45 - dhdy * 0.6) * kk;
      const gpx = x0 * T + px, gpy = y0 * T + py;
      const n = hash2(gpx, gpy, seed + 9);
      if (t === T_GRASS) {
        sh += (n - 0.5) * 0.08;
        if (n > 0.975) sh -= 0.16;
        else if (n < 0.01) { r += 26; g += 28; }
      } else if (t === T_MOUNTAIN) {
        const strata = valueNoise(gpx / 7, gpy / 3, seed + 11);
        sh += (strata - 0.5) * 0.28 + (n - 0.5) * 0.12;
        const ore = map.ore[di];
        if (ore) {
          const cl = valueNoise(gpx / 4, gpy / 4, seed + 12 + ore);
          if (cl > 0.58 || n > 0.95) {
            const oc = ORE_RGB[ore];
            const f = cl > 0.58 ? 0.55 + (cl - 0.58) : 0.45;
            r += (oc[0] - r) * f; g += (oc[1] - g) * f; b += (oc[2] - b) * f;
            if (ore === 3 && n > 0.985) { r = 255; g = 236; b = 150; }
          }
        }
      } else if (t === T_SAND) {
        sh += (n - 0.5) * 0.1;
      } else if (t === T_WATER) {
        sh += (n - 0.5) * 0.03;
      }
      const o = (py * size + px) * 4;
      d[o] = clamp(r * sh, 0, 255); d[o + 1] = clamp(g * sh, 0, 255); d[o + 2] = clamp(b * sh, 0, 255); d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// -------------------------------------------------------------- trees/stone
function makeTreeSprite(stage, variant) {
  const c = makeCanvas(SPR * 1.6, SPR * 2.2);
  const g = c.getContext('2d');
  const s = [0, 0.32, 0.5, 0.68, 0.84, 1][stage];
  const bx = c.width / 2, by = c.height - SPR * 0.25;
  g.save();
  g.translate(bx, by);
  g.scale(s, s);
  // shadow
  g.fillStyle = 'rgba(20,30,10,0.32)';
  g.beginPath(); g.ellipse(SPR * 0.18, 0, SPR * 0.42, SPR * 0.16, 0, 0, Math.PI * 2); g.fill();
  if (variant === 2) { // pine
    g.fillStyle = '#5a3a1e';
    g.fillRect(-SPR * 0.05, -SPR * 0.35, SPR * 0.1, SPR * 0.35);
    const tiers = [[0.42, -0.25, -0.85], [0.34, -0.62, -1.18], [0.24, -0.95, -1.48]];
    tiers.forEach(([hw, yb, yt], k) => {
      g.fillStyle = k === 0 ? '#1f4a26' : k === 1 ? '#27592d' : '#2f6934';
      g.beginPath(); g.moveTo(-SPR * hw, SPR * yb); g.lineTo(SPR * hw, SPR * yb); g.lineTo(0, SPR * yt); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,220,0.12)';
      g.beginPath(); g.moveTo(-SPR * hw * 0.9, SPR * yb); g.lineTo(-SPR * hw * 0.1, SPR * yb); g.lineTo(0, SPR * yt); g.closePath(); g.fill();
    });
  } else {
    g.fillStyle = '#5e3d20';
    g.fillRect(-SPR * 0.06, -SPR * 0.5, SPR * 0.12, SPR * 0.5);
    const greens = variant === 0 ? ['#2d5a24', '#3b7030', '#4f8a3a', '#6ea04a'] : ['#355e22', '#44722a', '#5a8a34', '#7aa648'];
    const blobs = [[0, -0.95, 0.46, 0], [-0.24, -0.8, 0.3, 1], [0.24, -0.82, 0.32, 1], [0, -1.12, 0.3, 2], [-0.12, -1.02, 0.18, 3], [0.14, -0.72, 0.16, 2]];
    for (const [x, y, r, k] of blobs) {
      g.fillStyle = greens[k];
      g.beginPath(); g.arc(SPR * x, SPR * y, SPR * r, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,200,0.10)';
    g.beginPath(); g.arc(-SPR * 0.12, -SPR * 1.08, SPR * 0.2, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  return c;
}

function makeStoneSprite(size, variant) {
  const c = makeCanvas(SPR * 1.3, SPR * 1.3);
  const g = c.getContext('2d');
  const rng = new RNG(variant * 31 + size * 7 + 1);
  const cx = c.width / 2, cy = c.height * 0.62;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(cx + 4, cy + SPR * 0.12, SPR * 0.5 * (0.5 + size * 0.2), SPR * 0.18, 0, 0, Math.PI * 2); g.fill();
  const n = 2 + size;
  for (let k = 0; k < n; k++) {
    const rx = cx + (rng.next() - 0.5) * SPR * 0.6, ry = cy + (rng.next() - 0.6) * SPR * 0.35;
    const r = SPR * (0.14 + rng.next() * 0.12) * (0.8 + size * 0.15);
    const pts = 6 + rng.int(0, 2);
    const base = 150 + rng.int(-15, 15);
    g.fillStyle = `rgb(${base},${base - 4},${base - 10})`;
    g.beginPath();
    for (let p = 0; p < pts; p++) {
      const a = (p / pts) * Math.PI * 2;
      const rr = r * (0.75 + rng.next() * 0.35);
      g.lineTo(rx + Math.cos(a) * rr, ry + Math.sin(a) * rr * 0.75);
    }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.ellipse(rx - r * 0.25, ry - r * 0.25, r * 0.45, r * 0.3, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.ellipse(rx + r * 0.2, ry + r * 0.3, r * 0.6, r * 0.25, 0, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// ---------------------------------------------------------------- buildings
const BSTYLE = {
  storehouse: { wall: 'timber', roof: 'tile', H: 0.95, roofH: 0.75, props: ['crates'], bigDoor: true },
  school: { wall: 'stone', roof: 'slate', H: 0.85, roofH: 0.6, bell: true },
  inn: { wall: 'timber', roof: 'tile', H: 0.85, roofH: 0.6, chimney: 0.8, sign: '#d9a53a', props: ['barrels'] },
  woodcutter: { wall: 'wood', roof: 'thatch', H: 0.6, roofH: 0.45, props: ['logs'] },
  quarry: { special: 'quarry' },
  sawmill: { wall: 'wood', roof: 'tile', H: 0.6, roofH: 0.45, props: ['logs', 'planks'] },
  farm: { wall: 'timber', roof: 'thatch', H: 0.7, roofH: 0.55, props: ['hay'] },
  mill: { special: 'mill' },
  bakery: { wall: 'stone', roof: 'tile', H: 0.65, roofH: 0.45, chimney: 0.7, sign: '#c98a3a' },
  swine: { wall: 'wood', roof: 'thatch', H: 0.55, roofH: 0.4, props: ['pen'], half: true },
  butcher: { wall: 'timber', roof: 'tile', H: 0.65, roofH: 0.45, sign: '#b8452f' },
  vineyard: { wall: 'stone', roof: 'tile', H: 0.65, roofH: 0.45, props: ['barrels'] },
  fisher: { wall: 'wood', roof: 'thatch', H: 0.55, roofH: 0.45, props: ['net'] },
  tannery: { wall: 'wood', roof: 'tile', H: 0.6, roofH: 0.4, props: ['hides'] },
  coalmine: { special: 'mine' }, ironmine: { special: 'mine' }, goldmine: { special: 'mine' },
  smelter: { wall: 'stone', roof: 'slate', H: 0.7, roofH: 0.4, chimney: 1.0, glow: true },
  mint: { wall: 'stone', roof: 'slate', H: 0.7, roofH: 0.4, chimney: 1.0, glow: true, sign: '#f0c419' },
  weaponshop: { wall: 'timber', roof: 'tile', H: 0.65, roofH: 0.45, props: ['rack'] },
  armorshop: { wall: 'timber', roof: 'tile', H: 0.65, roofH: 0.45, props: ['shields'] },
  weaponsmith: { wall: 'stone', roof: 'slate', H: 0.7, roofH: 0.45, chimney: 0.9, glow: true, props: ['anvil'] },
  armorsmith: { wall: 'stone', roof: 'slate', H: 0.7, roofH: 0.45, chimney: 0.9, glow: true, props: ['anvil'] },
  stables: { wall: 'wood', roof: 'thatch', H: 0.6, roofH: 0.45, props: ['fence'], half: true },
  barracks: { special: 'barracks' },
  tower: { special: 'tower' },
};
const ROOF = { tile: ['#a4442c', '#7a2f1e'], thatch: ['#c9a257', '#9b7a3a'], slate: ['#5d6673', '#434a55'] };
const TOP = 1.4; // sprite margin above the footprint (tiles) for roofs and towers

// Draws a building sprite. Coordinates are in tiles; (0, TOP) is the footprint's top-left.
function makeBuildingSprite(type, color) {
  const def = BUILDINGS[type];
  const st = BSTYLE[type];
  const c = makeCanvas(def.w * SPR, (def.h + TOP) * SPR);
  const g = c.getContext('2d');
  g.scale(SPR, SPR);
  g.lineWidth = 1 / SPR;
  const meta = { chimney: null, hub: null };
  const W = def.w, Hh = def.h, top = TOP;
  // soft ground shadow
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0.12, top + 0.25, W - 0.05, Hh - 0.2);

  if (st.special === 'mine') drawMine(g, W, Hh, top, type, color);
  else if (st.special === 'quarry') drawQuarry(g, W, Hh, top, color);
  else if (st.special === 'tower') drawTower(g, W, Hh, top, color);
  else if (st.special === 'barracks') drawBarracks(g, W, Hh, top, color);
  else if (st.special === 'mill') { drawMill(g, W, Hh, top, color); meta.hub = { x: W / 2, y: top + 0.12 }; }
  else {
    const bw = st.half ? Math.min(2, W) : W; // half buildings leave room for a yard
    const x0 = 0.1, x1 = bw - 0.1;
    const yf = top + Hh - 0.12, yb = top + 0.35;
    const H = st.H, rH = st.roofH;
    // yard props on the side
    if (st.half) drawYard(g, bw, W, top, Hh, st.props[0]);
    // front wall
    drawWall(g, st.wall, x0, yf - H, x1 - x0, H);
    // door
    const dcx = Math.floor(W / 2) + 0.5;
    const dw = st.bigDoor ? 0.62 : 0.34, dh = st.bigDoor ? 0.62 : 0.46;
    if (dcx < x1) {
      g.fillStyle = '#3b2515';
      roundTop(g, dcx - dw / 2, yf - dh, dw, dh);
      g.fillStyle = '#23150b';
      roundTop(g, dcx - dw / 2 + 0.04, yf - dh + 0.05, dw - 0.08, dh - 0.05);
      if (st.bigDoor) { g.strokeStyle = '#6b4a2a'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(dcx, yf - dh + 0.1); g.lineTo(dcx, yf); g.stroke(); }
    }
    // windows
    g.fillStyle = '#2a2a30';
    const wy = yf - H * 0.72;
    for (let wx = x0 + 0.25; wx < x1 - 0.25; wx += 0.62) {
      if (Math.abs(wx + 0.09 - dcx) < 0.35) continue;
      g.fillRect(wx, wy, 0.18, 0.18);
      g.fillStyle = 'rgba(255,220,140,0.35)'; g.fillRect(wx + 0.02, wy + 0.02, 0.06, 0.06); g.fillStyle = '#2a2a30';
    }
    // roof: back slope, then front slope
    const eaveF = yf - H, eaveB = yb - H * 0.2;
    const ridge = (eaveF + eaveB) / 2 - rH;
    const [rc, rd] = ROOF[st.roof];
    g.fillStyle = rd;
    g.beginPath(); g.moveTo(x0 - 0.06, ridge); g.lineTo(x1 + 0.06, ridge); g.lineTo(x1 + 0.02, eaveB); g.lineTo(x0 - 0.02, eaveB); g.closePath(); g.fill();
    g.fillStyle = rc;
    g.beginPath(); g.moveTo(x0 - 0.06, ridge); g.lineTo(x1 + 0.06, ridge); g.lineTo(x1 + 0.1, eaveF + 0.04); g.lineTo(x0 - 0.1, eaveF + 0.04); g.closePath(); g.fill();
    // roof texture
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.025;
    if (st.roof === 'thatch') {
      for (let x = x0; x < x1; x += 0.07) { g.beginPath(); g.moveTo(x, ridge + 0.03); g.lineTo(x - 0.02, eaveF); g.stroke(); }
    } else {
      for (let y = ridge + 0.12; y < eaveF; y += 0.12) { g.beginPath(); g.moveTo(x0 - 0.08, y); g.lineTo(x1 + 0.08, y); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x0 - 0.06, ridge, x1 - x0 + 0.12, 0.05);
    // eave shadow on the wall
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, eaveF + 0.04, x1 - x0, 0.06);
    // chimney
    if (st.chimney) {
      const cx = x1 - 0.45, cy = ridge + 0.05;
      g.fillStyle = '#7a6a5a'; g.fillRect(cx, cy - 0.35, 0.18, 0.4);
      g.fillStyle = '#5a4a3a'; g.fillRect(cx - 0.02, cy - 0.38, 0.22, 0.06);
      meta.chimney = { x: cx + 0.09, y: cy - 0.4 };
    }
    if (st.glow) {
      g.fillStyle = 'rgba(255,120,30,0.8)'; g.fillRect(x0 + 0.2, yf - 0.3, 0.2, 0.18);
    }
    if (st.bell) {
      const bx = (x0 + x1) / 2;
      g.fillStyle = '#8a8478'; g.fillRect(bx - 0.14, ridge - 0.42, 0.28, 0.44);
      g.fillStyle = ROOF.slate[0]; g.beginPath(); g.moveTo(bx - 0.2, ridge - 0.4); g.lineTo(bx + 0.2, ridge - 0.4); g.lineTo(bx, ridge - 0.72); g.fill();
      g.fillStyle = '#d4a93a'; g.beginPath(); g.arc(bx, ridge - 0.22, 0.07, 0, Math.PI * 2); g.fill();
    }
    if (st.sign) {
      const sx = x0 + 0.08, sy = eaveF + 0.2;
      g.strokeStyle = '#3b2515'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 0.3, sy); g.stroke();
      g.fillStyle = st.sign; g.fillRect(sx + 0.12, sy + 0.02, 0.2, 0.16);
    }
    // player pennant on the ridge
    flag(g, x1 - 0.2, ridge, color, 0.45);
    if (st.props && !st.half) drawProps(g, st.props, W, Hh, top);
  }
  c.meta = meta;
  return c;
}

function roundTop(g, x, y, w, h) {
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y + w / 2);
  g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  g.lineTo(x + w, y + h); g.closePath(); g.fill();
}

function flag(g, x, y, color, h) {
  g.strokeStyle = '#3a2a1a'; g.lineWidth = 0.035;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
  g.fillStyle = color;
  g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + 0.3, y - h + 0.08); g.lineTo(x, y - h + 0.17); g.closePath(); g.fill();
}

function drawWall(g, kind, x, y, w, h) {
  if (kind === 'stone') {
    g.fillStyle = '#a9a396'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(60,55,50,0.45)'; g.lineWidth = 0.02;
    let row = 0;
    for (let yy = y + 0.13; yy < y + h; yy += 0.13, row++) {
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
      for (let xx = x + (row % 2 ? 0.1 : 0.2); xx < x + w; xx += 0.22) { g.beginPath(); g.moveTo(xx, yy - 0.13); g.lineTo(xx, yy); g.stroke(); }
    }
  } else if (kind === 'wood') {
    g.fillStyle = '#8c5d34'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(40,20,10,0.4)'; g.lineWidth = 0.02;
    for (let xx = x + 0.12; xx < x + w; xx += 0.12) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); }
  } else {
    g.fillStyle = '#e6d9bb'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#5a3a22'; g.lineWidth = 0.05;
    g.strokeRect(x + 0.02, y + 0.02, w - 0.04, h - 0.04);
    for (let xx = x + 0.5; xx < x + w - 0.1; xx += 0.5) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); }
    g.beginPath(); g.moveTo(x, y + h * 0.45); g.lineTo(x + w, y + h * 0.45); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x, y + h - 0.06, w, 0.06);
}

function drawProps(g, props, W, Hh, top) {
  const yb = top + Hh - 0.05;
  for (const p of props) {
    if (p === 'logs') {
      for (let k = 0; k < 3; k++) { g.fillStyle = '#6e4524'; g.fillRect(W - 0.55, yb - 0.12 - k * 0.1, 0.45, 0.09); g.fillStyle = '#c99a62'; g.beginPath(); g.arc(W - 0.1, yb - 0.075 - k * 0.1, 0.045, 0, 7); g.fill(); }
    } else if (p === 'planks') {
      g.fillStyle = '#d2a468'; g.fillRect(0.05, yb - 0.14, 0.4, 0.06); g.fillRect(0.08, yb - 0.22, 0.36, 0.06);
    } else if (p === 'crates') {
      for (const [x, y] of [[W - 0.45, yb - 0.3], [W - 0.7, yb - 0.25], [W - 0.55, yb - 0.52]]) {
        g.fillStyle = '#9b6b3a'; g.fillRect(x, y, 0.24, 0.22); g.strokeStyle = '#5a3a1c'; g.lineWidth = 0.02; g.strokeRect(x, y, 0.24, 0.22);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.24, y + 0.22); g.stroke();
      }
    } else if (p === 'barrels') {
      for (const x of [0.1, 0.32]) { g.fillStyle = '#7a4a26'; g.beginPath(); g.ellipse(x + 0.1, yb - 0.14, 0.1, 0.13, 0, 0, 7); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(x, yb - 0.18); g.lineTo(x + 0.2, yb - 0.18); g.stroke(); }
    } else if (p === 'hay') {
      g.fillStyle = '#d8b54a'; g.beginPath(); g.ellipse(W - 0.35, yb - 0.18, 0.28, 0.2, 0, 0, 7); g.fill();
      g.fillStyle = '#b8942e'; g.beginPath(); g.ellipse(W - 0.35, yb - 0.12, 0.28, 0.1, 0, 0, Math.PI); g.fill();
    } else if (p === 'net') {
      g.strokeStyle = 'rgba(230,230,210,0.8)'; g.lineWidth = 0.015;
      for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(W - 0.6 + k * 0.1, yb - 0.45); g.lineTo(W - 0.6 + k * 0.1, yb - 0.1); g.stroke(); g.beginPath(); g.moveTo(W - 0.62, yb - 0.45 + k * 0.08); g.lineTo(W - 0.18, yb - 0.45 + k * 0.08); g.stroke(); }
    } else if (p === 'hides') {
      g.strokeStyle = '#3b2515'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(W - 0.7, yb - 0.45); g.lineTo(W - 0.1, yb - 0.45); g.stroke();
      for (let k = 0; k < 3; k++) { g.fillStyle = k % 2 ? '#d9a07a' : '#b8845c'; g.fillRect(W - 0.65 + k * 0.19, yb - 0.44, 0.15, 0.28); }
    } else if (p === 'rack') {
      g.strokeStyle = '#5a3a1c'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(W - 0.6, yb - 0.1); g.lineTo(W - 0.6, yb - 0.5); g.moveTo(W - 0.15, yb - 0.1); g.lineTo(W - 0.15, yb - 0.5); g.moveTo(W - 0.62, yb - 0.45); g.lineTo(W - 0.13, yb - 0.45); g.stroke();
      g.strokeStyle = '#b8b0a0'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(W - 0.5 + k * 0.13, yb - 0.1); g.lineTo(W - 0.5 + k * 0.13, yb - 0.55); g.stroke(); }
    } else if (p === 'shields') {
      for (let k = 0; k < 2; k++) { g.fillStyle = '#9b6b3a'; g.beginPath(); g.arc(W - 0.5 + k * 0.25, yb - 0.2, 0.11, 0, 7); g.fill(); g.fillStyle = '#c0b090'; g.beginPath(); g.arc(W - 0.5 + k * 0.25, yb - 0.2, 0.03, 0, 7); g.fill(); }
    } else if (p === 'anvil') {
      g.fillStyle = '#333'; g.fillRect(W - 0.5, yb - 0.2, 0.3, 0.08); g.fillRect(W - 0.42, yb - 0.12, 0.14, 0.1);
    }
  }
}

function drawYard(g, bw, W, top, Hh, kind) {
  const x0 = bw - 0.05, x1 = W - 0.08, y0 = top + 0.3, y1 = top + Hh - 0.1;
  g.fillStyle = kind === 'pen' ? '#7d6a45' : '#8a7a4a';
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.strokeStyle = '#5a3a1c'; g.lineWidth = 0.035;
  g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  for (let x = x0; x <= x1; x += 0.2) { g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y1 - 0.15); g.stroke(); }
  if (kind === 'pen') {
    for (const [px, py] of [[0.3, 0.45], [0.62, 0.9], [0.35, 1.2]]) {
      g.fillStyle = '#f0a4a4'; g.beginPath(); g.ellipse(x0 + px, y0 + py * (y1 - y0) / 1.4, 0.13, 0.08, 0, 0, 7); g.fill();
      g.fillStyle = '#e08888'; g.beginPath(); g.arc(x0 + px + 0.12, y0 + py * (y1 - y0) / 1.4 - 0.02, 0.05, 0, 7); g.fill();
    }
  } else {
    g.fillStyle = '#6b4424'; g.beginPath(); g.ellipse(x0 + 0.45, y0 + 0.7, 0.24, 0.1, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x0 + 0.67, y0 + 0.62, 0.07, 0.06, 0, 0, 7); g.fill();
    g.fillStyle = '#d8b54a'; g.fillRect(x0 + 0.1, y1 - 0.35, 0.25, 0.2);
  }
}

function drawMine(g, W, Hh, top, type, color) {
  const oc = type === 'coalmine' ? '#26221f' : type === 'ironmine' ? '#a45c3a' : '#e9c23a';
  const yf = top + Hh - 0.1;
  // rock face
  g.fillStyle = '#7a6e60';
  g.beginPath(); g.moveTo(0.05, yf); g.lineTo(0.1, top + 0.4); g.lineTo(W * 0.5, top - 0.1); g.lineTo(W - 0.1, top + 0.35); g.lineTo(W - 0.05, yf); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.moveTo(0.1, top + 0.4); g.lineTo(W * 0.5, top - 0.1); g.lineTo(W * 0.45, top + 0.6); g.closePath(); g.fill();
  // tunnel
  const cx = Math.floor(W / 2) + 0.5;
  g.fillStyle = '#140e0a';
  roundTop(g, cx - 0.35, yf - 0.75, 0.7, 0.75);
  g.strokeStyle = '#6b4424'; g.lineWidth = 0.09;
  g.beginPath(); g.moveTo(cx - 0.38, yf); g.lineTo(cx - 0.38, yf - 0.8); g.lineTo(cx + 0.38, yf - 0.8); g.lineTo(cx + 0.38, yf); g.stroke();
  // spoil heap and cart
  g.fillStyle = oc;
  g.beginPath(); g.ellipse(0.4, yf - 0.1, 0.3, 0.14, 0, 0, 7); g.fill();
  g.fillStyle = '#5a3a1c'; g.fillRect(W - 0.6, yf - 0.3, 0.4, 0.2);
  g.fillStyle = oc; g.beginPath(); g.ellipse(W - 0.4, yf - 0.3, 0.18, 0.08, 0, 0, 7); g.fill();
  g.fillStyle = '#222'; g.beginPath(); g.arc(W - 0.52, yf - 0.08, 0.05, 0, 7); g.arc(W - 0.28, yf - 0.08, 0.05, 0, 7); g.fill();
  flag(g, 0.3, top + 0.35, color, 0.5);
}

function drawQuarry(g, W, Hh, top, color) {
  const yf = top + Hh - 0.1;
  // lean-to shed
  drawWall(g, 'wood', 0.15, yf - 0.55, 1.0, 0.55);
  g.fillStyle = ROOF.tile[0];
  g.beginPath(); g.moveTo(0.05, yf - 0.55); g.lineTo(1.25, yf - 0.55); g.lineTo(1.2, yf - 1.05); g.lineTo(0.1, yf - 1.05); g.closePath(); g.fill();
  g.fillStyle = '#23150b'; roundTop(g, 0.55, yf - 0.4, 0.3, 0.4);
  // cut stone blocks
  for (const [x, y] of [[1.35, yf - 0.28], [1.6, yf - 0.28], [1.47, yf - 0.5], [1.35, yf - 0.8]]) {
    g.fillStyle = '#b8b2a6'; g.fillRect(x, y, 0.24, 0.2);
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + 0.15, 0.24, 0.05);
  }
  flag(g, 1.15, yf - 1.05, color, 0.4);
}

function crenels(g, x, y, w, color) {
  g.fillStyle = color;
  for (let xx = x; xx < x + w - 0.05; xx += 0.2) g.fillRect(xx, y - 0.12, 0.12, 0.12);
}

function drawTower(g, W, Hh, top, color) {
  const x0 = 0.3, x1 = W - 0.3, yf = top + Hh - 0.15, H = 1.9;
  drawWall(g, 'stone', x0, yf - H, x1 - x0, H);
  g.fillStyle = '#8f897d'; g.fillRect(x0 - 0.08, yf - H - 0.28, x1 - x0 + 0.16, 0.3);
  crenels(g, x0 - 0.08, yf - H - 0.28, x1 - x0 + 0.16, '#8f897d');
  g.fillStyle = '#1e1a16'; g.fillRect((x0 + x1) / 2 - 0.05, yf - H * 0.7, 0.1, 0.25);
  g.fillStyle = '#23150b'; roundTop(g, Math.floor(W / 2) + 0.5 - 0.18, yf - 0.42, 0.36, 0.42);
  flag(g, (x0 + x1) / 2, yf - H - 0.35, color, 0.6);
}

function drawBarracks(g, W, Hh, top, color) {
  const yf = top + Hh - 0.1;
  // courtyard wall
  drawWall(g, 'stone', 0.08, yf - 0.8, W - 0.16, 0.8);
  crenels(g, 0.08, yf - 0.8, W - 0.16, '#9a9488');
  // keep behind
  drawWall(g, 'stone', 0.7, top + 0.2 - 0.7, W - 1.4, 1.5);
  g.fillStyle = '#8f897d'; g.fillRect(0.62, top - 0.55, W - 1.24, 0.12);
  crenels(g, 0.62, top - 0.55, W - 1.24, '#8f897d');
  // corner turrets
  for (const x of [0.02, W - 0.42]) { drawWall(g, 'stone', x, yf - 1.1, 0.4, 1.1); crenels(g, x, yf - 1.1, 0.4, '#8f897d'); }
  // gate
  g.fillStyle = '#23150b'; roundTop(g, Math.floor(W / 2) + 0.5 - 0.32, yf - 0.6, 0.64, 0.6);
  g.strokeStyle = '#555'; g.lineWidth = 0.03;
  for (let x = -0.24; x <= 0.24; x += 0.12) { g.beginPath(); g.moveTo(Math.floor(W / 2) + 0.5 + x, yf - 0.55); g.lineTo(Math.floor(W / 2) + 0.5 + x, yf); g.stroke(); }
  // banners
  g.fillStyle = color; g.fillRect(0.95, yf - 0.72, 0.18, 0.35); g.fillRect(W - 1.13, yf - 0.72, 0.18, 0.35);
  flag(g, W / 2, top - 0.6, color, 0.7);
}

function drawMill(g, W, Hh, top, color) {
  const cx = W / 2, yf = top + Hh - 0.1;
  // round stone tower
  g.fillStyle = '#b3aa98';
  g.beginPath(); g.moveTo(cx - 0.55, yf); g.lineTo(cx - 0.42, top - 0.05); g.lineTo(cx + 0.42, top - 0.05); g.lineTo(cx + 0.55, yf); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.beginPath(); g.moveTo(cx + 0.15, yf); g.lineTo(cx + 0.15, top - 0.05); g.lineTo(cx + 0.42, top - 0.05); g.lineTo(cx + 0.55, yf); g.closePath(); g.fill();
  g.fillStyle = ROOF.thatch[0];
  g.beginPath(); g.moveTo(cx - 0.5, top); g.lineTo(cx + 0.5, top); g.lineTo(cx, top - 0.7); g.closePath(); g.fill();
  g.fillStyle = '#23150b'; roundTop(g, Math.floor(W / 2) + 0.5 - 0.17, yf - 0.42, 0.34, 0.42);
  g.fillStyle = '#2a2a30'; g.fillRect(cx - 0.08, top + 0.35, 0.16, 0.16);
  flag(g, cx, top - 0.68, color, 0.35);
}

// ---------------------------------------------------------------- UI icons
// Renders a small canvas icon of a building for the build menu.
function buildingIcon(type, color, size = 44) {
  const spr = makeBuildingSprite(type, color);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const s = Math.min(size / spr.width, size / spr.height);
  g.drawImage(spr, (size - spr.width * s) / 2, (size - spr.height * s) / 2, spr.width * s, spr.height * s);
  return c.toDataURL();
}
