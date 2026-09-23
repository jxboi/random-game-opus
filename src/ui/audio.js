// ---------------------------------------------------------------------------
// Tiny WebAudio synth. Sounds carry information: what happened and, for
// combat, roughly where (stereo pan + distance falloff from the camera).
// ---------------------------------------------------------------------------
import { clamp } from '../core/util.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
    try { this.muted = localStorage.getItem('km.muted') === '1'; } catch (e) { /* storage blocked */ }
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }
  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('km.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  // Rate-limit a sound key to at most one per `gap` seconds.
  gate(key, gap) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (this.last[key] != null && now - this.last[key] < gap) return false;
    this.last[key] = now;
    return true;
  }
  out(pan, vol) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }
  tone(freq, dur, type = 'sine', vol = 0.3, pan = 0, slide = 0, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const e = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(1, t + 0.008);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(this.out(pan, vol));
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.3, pan = 0, freq = 1200, q = 1, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); f.connect(this.out(pan, vol));
    src.start(t);
  }

  // Named cues ----------------------------------------------------------
  click() { this.tone(660, 0.05, 'triangle', 0.15); }
  place() { this.noise(0.12, 0.35, 0, 300, 0.8); this.tone(140, 0.12, 'sine', 0.25, 0, 0.6); }
  plan() { if (this.gate('plan', 0.05)) this.tone(520, 0.04, 'triangle', 0.12); }
  complete() { [523, 659, 784].forEach((f, k) => this.tone(f, 0.25, 'triangle', 0.2, 0, 0, k * 0.09)); }
  trained() { if (this.gate('trained', 0.3)) { this.tone(700, 0.08, 'square', 0.08); this.tone(900, 0.1, 'square', 0.08, 0, 0, 0.07); } }
  soldier() { if (this.gate('soldier', 0.3)) { this.noise(0.1, 0.3, 0, 180, 1); this.noise(0.1, 0.3, 0, 180, 1, 0.12); } }
  clash(pan, vol) { if (this.gate('clash', 0.07)) { this.noise(0.08, 0.35 * vol, pan, 3200 + Math.random() * 1500, 6); this.tone(1800 + Math.random() * 600, 0.07, 'square', 0.04 * vol, pan); } }
  thud(pan, vol) { if (this.gate('thud', 0.15)) this.noise(0.15, 0.4 * vol, pan, 220, 1.5); }
  twang(pan, vol) { if (this.gate('twang', 0.09)) this.tone(420, 0.12, 'triangle', 0.12 * vol, pan, 0.5); }
  death(pan, vol) { if (this.gate('death', 0.2)) this.tone(260, 0.35, 'sawtooth', 0.08 * vol, pan, 0.4); }
  crash(pan, vol) { this.noise(0.8, 0.5 * vol, pan, 400, 0.6); this.noise(0.5, 0.3 * vol, pan, 1500, 0.8, 0.1); }
  horn() { if (this.gate('horn', 4)) { this.tone(196, 0.6, 'sawtooth', 0.12); this.tone(247, 0.6, 'sawtooth', 0.1, 0, 0, 0.45); this.tone(196, 0.9, 'sawtooth', 0.12, 0, 0, 0.9); } }
  warn() { if (this.gate('warn', 2)) { this.tone(440, 0.15, 'square', 0.08); this.tone(370, 0.25, 'square', 0.08, 0, 0, 0.16); } }
  error() { if (this.gate('error', 0.2)) this.tone(160, 0.12, 'square', 0.1); }
  fanfare(win) {
    const notes = win ? [392, 523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, k) => this.tone(f, 0.5, 'triangle', 0.22, 0, 0, k * 0.22));
  }
}
