'use strict';
// ---------------------------------------------------------------------------
// Boot, game loop and overlays.
//   Fixed 10 Hz simulation (TICK) with an accumulator; rendering interpolates.
//   Frame time is clamped at 250 ms (not lower) so game time tracks wall time
//   on slow devices; MAX_STEPS bounds the catch-up work instead.
// ---------------------------------------------------------------------------

const MAX_FRAME = 0.25;
const MAX_STEPS = 64;

class Game {
  constructor() {
    this.sfx = new Sfx();
    this.speed = 1;
    this.paused = false;
    this.acc = 0;
    this.overlayOpen = true;
    this.world = null;
    this.shift = false;
    window.addEventListener('keydown', e => { if (e.key === 'Shift') this.shift = true; });
    window.addEventListener('keyup', e => { if (e.key === 'Shift') this.shift = false; });
    window.addEventListener('blur', () => { this.shift = false; });
    this.bindChrome();
    this.showStart();
  }

  shiftHeld() { return this.shift; }
  escape() { if (this.onEsc) this.onEsc(); }

  start(seed, difficulty) {
    this.world = new World({ seed, difficulty });
    if (!this.renderer) this.renderer = new Renderer(document.getElementById('view'), this.world);
    else this.renderer.setWorld(this.world);
    if (!this.ui) this.ui = new UI(this);
    this.ui.messages = [];
    this.ui.renderMessages();
    this.ui.clearSelection();
    this.ui.state.tool = null;
    const s = this.world.map.starts[0];
    this.renderer.resize();
    this.renderer.cam = { x: s.x + 2, y: s.y - 2, zoom: 1.1 };
    this.speed = 1; this.paused = false; this.acc = 0;
    this.closeOverlay();
    this.ui.message('Build a woodcutter, sawmill and quarry first. Connect every entrance with roads.', s.x, s.y);
    this.ui.message(`The red lord's town lies to the north-east. Difficulty: ${DIFFICULTY[difficulty].name}.`);
    this.ui.refreshPanel(true);
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(t => this.frame(t)); }
  }

  frame(now) {
    const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const w = this.world;
    if (!this.paused && !this.overlayOpen && !w.over) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < MAX_STEPS) { w.step(); this.acc -= TICK; steps++; }
      if (steps >= MAX_STEPS) this.acc = 0;
    }
    this.handleEvents(w.drainEvents());
    this.ui.update(dt);
    const alpha = this.paused || w.over ? 1 : clamp(this.acc / TICK, 0, 1);
    this.renderer.draw(alpha, this.ui.state, dt);
    this.ui.tick(dt);
    requestAnimationFrame(t => this.frame(t));
  }

  // Positional audio helpers: pan by screen x, fade with distance from view.
  where(x, y) {
    const r = this.renderer;
    const [sx, sy] = r.toScreen(x, y);
    const pan = clamp((sx / r.cw) * 2 - 1, -1, 1) * 0.8;
    const out = Math.max(0, Math.max(-sx, sx - r.cw, -sy, sy - r.ch)) / r.scale;
    return { pan, vol: clamp(1 - out / 25, 0, 1) };
  }

  handleEvents(events) {
    const ui = this.ui, sfx = this.sfx;
    for (const e of events) {
      const mine = e.owner === 0;
      switch (e.type) {
        case 'placed': if (mine) sfx.place(); break;
        case 'planned': if (mine) sfx.plan(); break;
        case 'completed':
          if (mine) { sfx.complete(); ui.message(`${BUILDINGS[e.btype].name} completed.`, e.x, e.y, 'good'); }
          break;
        case 'trained': if (mine) { sfx.trained(); } break;
        case 'soldier': if (mine) { sfx.soldier(); ui.message(`${SOLDIERS[e.utype].name} ready for duty.`, e.x, e.y); } break;
        case 'hit': { const p = this.where(e.x, e.y); if (p.vol > 0) { if (e.melee) sfx.clash(p.pan, p.vol); else sfx.thud(p.pan, p.vol * 0.6); } break; }
        case 'hitb': { const p = this.where(e.x, e.y); if (p.vol > 0) sfx.thud(p.pan, p.vol); break; }
        case 'shoot': { const p = this.where(e.x, e.y); if (p.vol > 0) sfx.twang(p.pan, p.vol); break; }
        case 'death': { const p = this.where(e.x, e.y); if (p.vol > 0 && e.soldier) sfx.death(p.pan, p.vol); if (mine && e.cause === 'starved') ui.message('Someone starved! Stock the inn with food.', e.x, e.y, 'bad'); break; }
        case 'destroyed': {
          const p = this.where(e.x, e.y); sfx.crash(p.pan, Math.max(0.3, p.vol));
          if (e.cause !== 'demolish') ui.message(`${mine ? 'Our' : 'Enemy'} ${BUILDINGS[e.btype].name} was destroyed!`, e.x, e.y, mine ? 'bad' : 'good');
          break;
        }
        case 'attacked':
          if (mine) { sfx.horn(); ui.message('We are under attack!', Math.round(e.x), Math.round(e.y), 'bad'); ui.bannerShow('⚔ Under attack!', 'bad'); }
          break;
        case 'hungry': if (mine) { sfx.warn(); ui.message('Your people are starving. Build an inn and bring food.', Math.round(e.x), Math.round(e.y), 'bad'); } break;
        case 'wave': if (e.owner === 1) { sfx.horn(); ui.message(`War horns! ${e.n} enemy soldiers are marching on your town.`, null, null, 'bad'); ui.bannerShow('The enemy is marching!', 'bad'); } break;
        case 'victory': sfx.fanfare(true); this.showEnd(true); break;
        case 'defeat': sfx.fanfare(false); this.showEnd(false); break;
      }
    }
  }

  setSpeed(s) { this.speed = s; this.paused = false; this.syncChrome(); }
  togglePause() { this.paused = !this.paused; this.syncChrome(); }

  bindChrome() {
    document.getElementById('btn-pause').onclick = () => { this.sfx.unlock(); this.togglePause(); };
    document.querySelectorAll('[data-speed]').forEach(b => { b.onclick = () => { this.sfx.unlock(); this.setSpeed(+b.dataset.speed); }; });
    document.getElementById('btn-mute').onclick = () => { this.sfx.unlock(); this.sfx.setMuted(!this.sfx.muted); this.syncChrome(); };
    document.getElementById('btn-menu').onclick = () => { this.sfx.unlock(); this.showMenu(); };
    window.addEventListener('resize', () => { if (this.renderer) this.renderer.resize(); });
    this.syncChrome();
  }

  syncChrome() {
    document.getElementById('btn-pause').textContent = this.paused ? '▶' : '⏸';
    document.getElementById('btn-pause').classList.toggle('on', this.paused);
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', !this.paused && +b.dataset.speed === this.speed));
    document.getElementById('btn-mute').textContent = this.sfx.muted ? '🔇' : '🔊';
  }

  // ------------------------------------------------------------ overlays
  overlay(html, onEsc = null) {
    this.onEsc = onEsc;
    const o = document.getElementById('overlay');
    o.innerHTML = `<div class="card">${html}</div>`;
    o.classList.add('show');
    this.overlayOpen = true;
    const first = o.querySelector('button.primary');
    if (first) first.focus();
    return o;
  }
  closeOverlay() {
    if (!this.world) return;
    document.getElementById('overlay').classList.remove('show');
    this.overlayOpen = false;
  }

  showStart() {
    let seed = Math.floor(Math.random() * 99999);
    let diff = 'normal';
    try { diff = localStorage.getItem('km.diff') || 'normal'; } catch (e) { /* ignore */ }
    const o = this.overlay(`
      <h1>Knights <span>&amp;</span> Merchants</h1>
      <p class="sub">A browser tribute to the classic medieval economy strategy game.</p>
      <div class="lore">Build a thriving town: fell trees, saw timber, quarry stone, grow corn and bake bread.
      Mine coal and iron, forge weapons and train an army. Then march on the red lord and burn his keep.</div>
      <label>Difficulty
        <select id="st-diff">${Object.keys(DIFFICULTY).map(k => `<option value="${k}" ${k === diff ? 'selected' : ''}>${DIFFICULTY[k].name}</option>`).join('')}</select></label>
      <label>Map seed <input id="st-seed" type="number" value="${seed}" min="0" max="99999"></label>
      <div class="btns"><button class="primary" id="st-go">Start game</button> <button id="st-help">How to play</button></div>
      <p class="fine">Fan-made remake. Not affiliated with the original developers or publishers. All art is procedurally drawn.</p>`);
    o.querySelector('#st-go').onclick = () => {
      this.sfx.unlock();
      const d = o.querySelector('#st-diff').value;
      try { localStorage.setItem('km.diff', d); } catch (e) { /* ignore */ }
      this.start(Math.abs(parseInt(o.querySelector('#st-seed').value, 10) || 1), d);
    };
    o.querySelector('#st-help').onclick = () => this.showHelp(() => this.showStart());
  }

  showHelp(back) {
    const o = this.overlay(`<h2>How to play</h2>
      <div class="help">
      <p><b>Scroll</b> with WASD / arrow keys, right-drag or the minimap. <b>Zoom</b> with the mouse wheel.</p>
      <p><b>Build</b> from the panel on the right. Every building's entrance (yellow marker) must be joined to your roads — serfs only carry goods along roads. Laborers level the ground and build once timber and stone arrive.</p>
      <p><b>Staff</b> buildings by training workers at the School (1 gold chest each). Idle workshops show a red 👤.</p>
      <p><b>Feed</b> your people: stock the Inn with bread, sausages, wine or fish or they will starve.</p>
      <p><b>Fight:</b> recruits go to the Barracks and are equipped with weapons and armor. Click a soldier to select the group (drag to box-select several), then right-click to move or attack. Lances and pikes are strong against horsemen; bowmen and crossbowmen shoot from range.</p>
      <p><b>Win</b> by destroying the enemy's storehouse, school and barracks and defeating all their soldiers. Their first attack comes after a while — be ready.</p>
      <p><b>Keys:</b> R road · F corn field · V wine field · X demolish · Space pause · 1/2/3 speed · H home · Tab next group · G halt · Esc cancel</p>
      </div>
      <div class="btns"><button class="primary" id="hp-back">Back</button></div>`, back);
    o.querySelector('#hp-back').onclick = back;
  }

  showMenu() {
    if (!this.world || this.world.over) return;
    const wasPaused = this.paused;
    this.paused = true; this.syncChrome();
    const o = this.overlay(`<h2>Paused</h2>
      <div class="btns col"><button class="primary" id="mn-resume">Resume</button>
      <button id="mn-help">How to play</button>
      <button id="mn-restart">Restart (same map)</button>
      <button id="mn-new">New game</button></div>`, () => resume());
    const resume = () => { this.closeOverlay(); this.paused = wasPaused; this.syncChrome(); };
    o.querySelector('#mn-resume').onclick = resume;
    o.querySelector('#mn-help').onclick = () => this.showHelp(() => this.showMenu());
    o.querySelector('#mn-restart').onclick = () => this.start(this.world.seed, this.world.difficulty);
    o.querySelector('#mn-new').onclick = () => this.showStart();
  }

  showEnd(win) {
    const w = this.world, p = w.players[0], e = w.players[1];
    this.ui.state.tool = null;
    const o = this.overlay(`<h1 class="${win ? 'win' : 'lose'}">${win ? 'Victory!' : 'Defeat'}</h1>
      <p class="sub">${win ? 'The red lord’s keep lies in ashes. Your people will sing of this day.' : 'Your town has fallen. The red banners fly over its ruins.'}</p>
      <table class="stats">
        <tr><th></th><th>You</th><th>Enemy</th></tr>
        <tr><td>Time</td><td colspan="2">${fmtTime(w.time)}</td></tr>
        <tr><td>Buildings built</td><td>${p.stats.built}</td><td>${e.stats.built}</td></tr>
        <tr><td>Citizens trained</td><td>${p.stats.trained}</td><td>${e.stats.trained}</td></tr>
        <tr><td>Soldiers equipped</td><td>${p.stats.soldiers}</td><td>${e.stats.soldiers}</td></tr>
        <tr><td>Enemies slain</td><td>${p.stats.kills}</td><td>${e.stats.kills}</td></tr>
        <tr><td>Soldiers lost</td><td>${p.stats.lost}</td><td>${e.stats.lost}</td></tr>
        <tr><td>Goods produced</td><td>${Object.values(p.stats.produced).reduce((a, b) => a + b, 0)}</td><td>${Object.values(e.stats.produced).reduce((a, b) => a + b, 0)}</td></tr>
      </table>
      <div class="btns"><button class="primary" id="end-again">Play again</button> <button id="end-new">New map</button></div>`);
    o.querySelector('#end-again').onclick = () => this.start(w.seed, w.difficulty);
    o.querySelector('#end-new').onclick = () => this.showStart();
  }
}

window.addEventListener('load', () => { window.game = new Game(); });
