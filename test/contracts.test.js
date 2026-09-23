// Architecture guardrails. These fail when a change breaks a rule other code
// relies on; see AGENTS.md ("Invariants") for the reasons behind each.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import * as core from '../src/core/index.js';

const root = new URL('..', import.meta.url).pathname;
const read = p => readFileSync(root + p, 'utf8');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const coreFiles = readdirSync(root + 'src/core').filter(f => f.endsWith('.js'));

test('core stays pure: no DOM, timers, storage or wall-clock randomness', () => {
  for (const f of coreFiles) {
    const s = stripComments(read('src/core/' + f));
    for (const bad of ['document.', 'window.', 'localStorage', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'performance.now', 'Date.now', 'Math.random', "from '../render", "from '../ui", "from 'three"]) {
      assert.ok(!s.includes(bad), `src/core/${f} uses ${bad}`);
    }
  }
});

test('event contract: every emitted event is declared, emitted and handled by the shell', () => {
  const emitted = new Set();
  for (const f of coreFiles) for (const m of read('src/core/' + f).matchAll(/emit\('([a-z]+)'/g)) emitted.add(m[1]);
  const declared = new Set(Object.keys(core.EVENTS));
  const game = read('src/game.js');
  for (const e of emitted) assert.ok(declared.has(e), `event '${e}' is emitted but not declared in src/core/events.js`);
  for (const e of declared) {
    assert.ok(emitted.has(e), `event '${e}' is declared but never emitted`);
    assert.ok(game.includes(`case '${e}'`), `event '${e}' is not handled in src/game.js handleEvents()`);
  }
});

test('content tables are consistent', () => {
  const { GOODS, BUILDINGS, CITIZENS, SOLDIERS, FOODS, WARFARE, BUILD_GROUPS } = core;
  const produced = new Set(), consumed = new Set();
  for (const [k, d] of Object.entries(BUILDINGS)) {
    assert.ok(d.name && d.w >= 2 && d.h >= 2, `${k}: name and footprint`);
    assert.ok(BUILD_GROUPS.includes(d.group), `${k}: group ${d.group}`);
    for (const g in d.cost) assert.ok(g === 'wood' || g === 'stone', `${k}: construction uses timber and stone only`);
    if (d.worker) assert.ok(CITIZENS[d.worker], `${k}: worker ${d.worker}`);
    for (const r of d.recipes || []) {
      assert.ok(r.time > 0, `${k}: recipe time`);
      for (const g in r.in) { assert.ok(GOODS[g], `${k}: input ${g}`); consumed.add(g); }
      for (const g in r.out) { assert.ok(GOODS[g], `${k}: output ${g}`); produced.add(g); }
    }
    for (const g of d.out || []) { assert.ok(GOODS[g], `${k}: output ${g}`); produced.add(g); }
    if (['gather', 'farm', 'convert', 'mine'].includes(d.kind)) assert.ok(d.worker, `${k}: production needs a worker`);
  }
  for (const s of Object.values(SOLDIERS)) for (const g of s.needs) { assert.ok(WARFARE.includes(g), `${s.name}: ${g} is warfare`); consumed.add(g); }
  for (const g in FOODS) { assert.ok(GOODS[g], `food ${g}`); consumed.add(g); }
  consumed.add('wood'); consumed.add('stone'); consumed.add('gold');
  for (const g in GOODS) {
    assert.ok(produced.has(g), `good '${g}' has no producer`);
    assert.ok(consumed.has(g), `good '${g}' is never used`);
  }
});

test('every building type has art in both renderers', () => {
  const art2d = read('src/render/art2d.js'), models = read('src/render/three/models.js');
  for (const k of Object.keys(core.BUILDINGS)) {
    assert.ok(new RegExp(`\\b${k}:`).test(art2d), `2D style missing for ${k} (BSTYLE in src/render/art2d.js)`);
    assert.ok(new RegExp(`\\b${k}:|case '${k}'`).test(models), `3D model missing for ${k} (STYLE / buildBuilding in src/render/three/models.js)`);
  }
});

// The UI and shell may only use the renderer through the documented contract.
const CONTRACT = ['kind', 'cam', 'cw', 'ch', 'view', 'setWorld', 'resize', 'draw', 'toScreen', 'toWorld', 'pxPerTile',
  'panBy', 'zoomAt', 'clampCam', 'pickBuilding', 'viewPolygon', 'flash', 'floater', 'dispose', 'canvas'];

test('renderer contract: both renderers implement it and the UI uses nothing else', () => {
  for (const f of ['src/render/renderer2d.js', 'src/render/three/renderer3d.js']) {
    const s = read(f);
    for (const m of CONTRACT) {
      if (['kind', 'cam', 'cw', 'ch', 'view', 'canvas'].includes(m)) assert.ok(new RegExp(`this\\.${m}\\s*=`).test(s), `${f}: field ${m}`);
      else assert.ok(new RegExp(`^  ${m}\\(`, 'm').test(s), `${f}: method ${m}()`);
    }
  }
  for (const f of ['src/ui/ui.js', 'src/game.js', 'src/render/minimap.js']) {
    const s = stripComments(read(f)).replace(/^import .*$/gm, '');
    for (const m of s.matchAll(/(?:this\.r|renderer)\.([A-Za-z_]\w*)/g)) {
      assert.ok(CONTRACT.includes(m[1]), `${f} uses renderer.${m[1]}, which is not in the renderer contract (src/render/renderer.js)`);
    }
  }
});

test('the UI changes the world only through commands', () => {
  const s = stripComments(read('src/ui/ui.js'));
  for (const bad of [/\.placeBuilding\(/, /\.planLine\(/, /\.demolish\(/, /\.destroyBuilding\(/, /\b(?:w|world)\.cmd[A-Z]/, /applyCommand\(/]) {
    assert.ok(!bad.test(s), `src/ui/ui.js matches ${bad} (a direct world mutation); use this.game.exec({ type, ... })`);
  }
});
