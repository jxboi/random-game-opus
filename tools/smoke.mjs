// ---------------------------------------------------------------------------
// Browser smoke test: drives the real UI in headless Chromium, once per
// renderer, and fails on any page error or broken flow. Screenshots land in
// shots/ (git-ignored) so a reviewer or agent can look at the result.
//
//   npm run smoke                 both renderers
//   npm run smoke -- 2d           one renderer
//
// Needs Playwright + Chromium: `npm i -D playwright && npx playwright install chromium`
// (or a globally installed playwright). Software GL (no GPU) is slow but works.
// ---------------------------------------------------------------------------
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startServer } from './serve.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const root = execSync('npm root -g').toString().trim();
  return createRequire(import.meta.url)(createRequire(import.meta.url).resolve('playwright', { paths: [root] }));
}

const kinds = process.argv.slice(2).filter(a => a === '2d' || a === '3d');
const KINDS = kinds.length ? kinds : ['3d', '2d'];
const PORT = 8790;
const OUT = new URL('../shots/', import.meta.url).pathname;

const { chromium } = await loadPlaywright();
await mkdir(OUT, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const failures = [];
const check = (kind, ok, what) => { console.log(`${ok ? '  ok ' : '  FAIL'} [${kind}] ${what}`); if (!ok) failures.push(`[${kind}] ${what}`); };

for (const kind of KINDS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.evaluate(k => { localStorage.clear(); localStorage.setItem('km.renderer', k); }, kind);
  await page.reload();
  await page.fill('#st-seed', '42');
  await page.click('#st-go');
  await page.waitForFunction(() => window.km && km.game.renderer && km.world);
  await page.waitForTimeout(1500);
  check(kind, await page.evaluate(k => km.game.renderer.kind === k, kind), 'requested renderer is active');
  // Screen position of a tile point (h = height above ground in tiles), in page coords.
  const scr = (x, y, h = 0) => page.evaluate(([x, y, h]) => {
    const r = km.game.renderer, rc = r.canvas.getBoundingClientRect();
    const [sx, sy] = r.toScreen(x, y, h);
    return [sx + rc.left, sy + rc.top];
  }, [x, y, h]);
  const start = await page.evaluate(() => km.world.map.starts[0]);
  const store = await page.evaluate(() => { const b = [...km.world.buildings.values()].find(b => b.owner === 0 && b.type === 'storehouse'); return { dx: b.dx, dy: b.dy }; });

  // 1. Place a sawmill from the build menu, east of the storehouse.
  await page.evaluate(([x, y]) => Object.assign(km.game.renderer.cam, { x, y, zoom: 1.2 }), [start.x + 3, start.y - 1]);
  await page.waitForTimeout(400);
  await page.click('button.bbtn[data-v="sawmill"]');
  let spot = null;
  for (const [x, y] of [[start.x + 5, start.y - 3], [start.x + 6, start.y - 4], [start.x + 5, start.y + 4], [start.x - 5, start.y - 4]]) {
    const ok = await page.evaluate(([x, y]) => !km.world.canPlace(0, 'sawmill', x - 1, y), [x, y]);
    if (ok) { spot = [x, y]; break; }
  }
  const [px, py] = await scr(spot[0] + 0.5, spot[1] + 0.5);
  await page.mouse.move(px, py);
  await page.waitForTimeout(150);
  const ghost = await page.evaluate(() => km.game.ui.state.ghost);
  check(kind, ghost && ghost.kind === 'build' && ghost.ok, 'placement ghost follows the cursor and is valid');
  await page.mouse.click(px, py);
  await page.waitForTimeout(150);
  const site = await page.evaluate(() => { const b = [...km.world.buildings.values()].find(b => b.owner === 0 && b.type === 'sawmill'); return b && { dx: b.dx, dy: b.dy, id: b.id }; });
  check(kind, !!site, 'clicking places a construction site');
  await page.screenshot({ path: `${OUT}${kind}-1-placed.png` });

  // 2. Drag a road from its entrance to the main road.
  if (site) {
    await page.keyboard.press('r');
    const a = await scr(site.dx + 0.5, site.dy + 0.5), b = await scr(site.dx + 0.5, store.dy + 0.5);
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 6 }); await page.mouse.up();
    await page.keyboard.press('Escape');
    const plans = await page.evaluate(() => [...km.world.cjobs.values()].filter(c => c.owner === 0 && c.type === 'road').length);
    check(kind, plans >= Math.abs(store.dy - site.dy) - 1, `road drag laid plans (${plans})`);
  }

  // 3. Select a soldier group by clicking a soldier, then order it with a right-click.
  const sol = await page.evaluate(() => { const u = [...km.world.units.values()].find(u => u.owner === 0 && u.type === 'axeman'); return { x: u.x, y: u.y, g: u.group }; });
  await page.evaluate(([x, y]) => Object.assign(km.game.renderer.cam, { x, y: y + 1 }), [sol.x, sol.y]);
  await page.waitForTimeout(300);
  const sp = await scr(sol.x, sol.y, 0.3);
  await page.mouse.click(sp[0], sp[1]);
  await page.waitForTimeout(100);
  check(kind, await page.evaluate(g => km.game.ui.state.selGroups.has(g), sol.g), 'clicking a soldier selects its group');
  const tp = await scr(sol.x - 3, sol.y + 3);
  await page.mouse.click(tp[0], tp[1], { button: 'right' });
  await page.waitForTimeout(100);
  check(kind, await page.evaluate(g => km.world.groups.get(g).order.kind === 'move', sol.g), 'right-click orders the group to move');

  // 4. Box select.
  await page.keyboard.press('Escape');
  const c0 = await scr(sol.x - 4, sol.y - 3), c1 = await scr(sol.x + 4, sol.y + 5);
  await page.mouse.move(c0[0], c0[1]); await page.mouse.down(); await page.mouse.move(c1[0], c1[1], { steps: 5 }); await page.mouse.up();
  check(kind, await page.evaluate(() => km.game.ui.state.selGroups.size > 0), 'box select picks soldier groups');
  await page.screenshot({ path: `${OUT}${kind}-2-army.png` });

  // 5. School queue through the panel.
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = [...km.world.buildings.values()].find(b => b.owner === 0 && b.type === 'school'); km.game.ui.state.selBuilding = b.id; km.game.ui.refreshPanel(true); });
  await page.click('button.ubtn[data-v="miner"]');
  check(kind, await page.evaluate(() => { const b = [...km.world.buildings.values()].find(b => b.owner === 0 && b.type === 'school'); return b.queue.length + (b.train ? 1 : 0) > 0; }), 'school panel queues a citizen');

  // 6. The economy advances: the connected site gets built.
  await page.evaluate(() => km.step(1500));
  await page.waitForTimeout(800);
  const built = site && await page.evaluate(id => { const b = km.world.buildings.get(id); return b && (b.state === 'done' || b.site.used > 0); }, site.id);
  check(kind, !!built, 'construction progresses once the road is built');
  await page.evaluate(([x, y]) => Object.assign(km.game.renderer.cam, { x, y, zoom: 1.4 }), [start.x + 3, start.y - 2]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}${kind}-3-town.png` });

  // 7. Save, reload, continue.
  await page.click('#btn-menu');
  await page.click('#mn-save');
  const t0 = await page.evaluate(() => km.world.time);
  await page.reload();
  await page.click('#st-load');
  await page.waitForFunction(() => window.km && km.world);
  const t1 = await page.evaluate(() => km.world.time);
  check(kind, Math.abs(t1 - t0) < 2, `save/load restores the game (${t0.toFixed(1)} -> ${t1.toFixed(1)})`);

  // 8. Graphics toggle round-trip (3D -> 2D -> 3D) keeps the game running.
  if (kind === '3d') {
    await page.click('#btn-menu'); await page.click('#mn-gfx');
    await page.waitForFunction(() => km.game.renderer.kind === '2d', null, { timeout: 5000 }).catch(() => {});
    const k1 = await page.evaluate(() => km.game.renderer.kind);
    await page.click('#mn-gfx');
    await page.waitForFunction(() => km.game.renderer.kind === '3d', null, { timeout: 10000 }).catch(() => {});
    const k2 = await page.evaluate(() => km.game.renderer.kind);
    await page.click('#mn-resume');
    const running = await page.evaluate(async () => { const t = km.world.time; await new Promise(r => setTimeout(r, 1500)); return km.world.time > t; });
    check(kind, running, 'game resumes after switching renderers');
    check(kind, k1 === '2d' && k2 === '3d', `graphics toggle switches renderers (${k1}, ${k2})`);
  }

  // 9. Victory screen.
  await page.evaluate(() => {
    const w = km.world;
    for (const u of [...w.units.values()]) if (u.owner === 1 && u.kind === 'soldier') w.killUnit(u, null);
    for (const b of [...w.buildings.values()]) if (b.owner === 1 && ['store', 'school', 'barracks'].includes(b.def.kind)) w.destroyBuilding(b, 'battle');
    km.step(12);
  });
  await page.waitForTimeout(300);
  check(kind, await page.evaluate(() => km.world.over && km.world.over.winner === 0 && document.getElementById('overlay').classList.contains('show')), 'victory ends the game and shows the result');
  await page.screenshot({ path: `${OUT}${kind}-4-victory.png` });

  check(kind, errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall smoke checks passed');
process.exit(failures.length ? 1 : 0);
