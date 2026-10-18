import { C } from '../engine/constants.js';
import { seedFromText } from '../engine/rng.js';
import { LiveMatch, ReplayMatch } from '../match.js';
import { Renderer } from '../render/renderer.js';
import { matchEntries } from './storage.js';
import { downloadText, pickFiles, safeFileName, el } from './files.js';

const SLOT_KEY = 'shipArena.slots';
const MAX_STEPS_PER_FRAME = 12;

const $ = (id) => document.getElementById(id);

export class Arena {
  constructor(store) {
    this.store = store;
    this.match = null;
    this.paused = false;
    this.speed = 1;
    this.acc = 0;
    this.stepping = false;
    this.follow = null;
    this.lastHud = 0;
    this.renderer = new Renderer($('canvas'));
    this.slotSelects = [];
    this.buildSlots();
    this.bindControls();
    this.bindCanvas();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- setup ----------

  buildSlots() {
    const wrap = $('slots');
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(SLOT_KEY) || '[]'); } catch {}
    for (let i = 0; i < 4; i++) {
      const sel = el('select', { 'aria-label': `Ship ${i + 1}` });
      sel.dataset.saved = saved[i] ?? (i === 0 ? 'builtin:bots/hunter.js' : i === 1 ? 'builtin:bots/sniper.js' : '');
      sel.addEventListener('change', () => this.saveSlots());
      wrap.append(el('label', { class: 'row slot' }, el('span', { class: 'slot-num' }, `Ship ${i + 1}`), sel));
      this.slotSelects.push(sel);
    }
    this.refreshBots();
  }

  refreshBots() {
    const bots = this.store.all();
    this.slotSelects.forEach((sel, i) => {
      const current = sel.value || sel.dataset.saved;
      sel.innerHTML = '';
      if (i >= 2) sel.append(el('option', { value: '' }, '— empty —'));
      const mine = bots.filter((b) => !b.builtin), samples = bots.filter((b) => b.builtin);
      if (mine.length) sel.append(el('optgroup', { label: 'Your bots' }, mine.map((b) => el('option', { value: b.id }, b.name))));
      sel.append(el('optgroup', { label: 'Sample bots' }, samples.map((b) => el('option', { value: b.id }, b.name))));
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
      else if (i < 2) sel.value = samples[i]?.id || '';
    });
  }

  saveSlots() {
    try { localStorage.setItem(SLOT_KEY, JSON.stringify(this.slotSelects.map((s) => s.value))); } catch {}
  }

  setSlots(ids) {
    this.slotSelects.forEach((sel, i) => { sel.value = ids[i] || ''; });
    this.saveSlots();
  }

  bindControls() {
    $('start').onclick = () => this.startFromSetup();
    $('seed-random').onclick = () => { $('seed').value = String(Math.floor(Math.random() * 1e6)); };
    $('pause').onclick = () => this.setPaused(!this.paused);
    $('step').onclick = () => this.stepOnce();
    $('speed').onchange = (e) => { this.speed = Number(e.target.value); };
    $('camera').onchange = (e) => this.setFollow(e.target.value === 'fit' ? null : Number(e.target.value));
    $('save-replay').onclick = () => this.saveReplay();
    $('load-replay').onclick = () => this.loadReplay();
    $('console-ship').onchange = () => this.renderConsole(true);
    document.addEventListener('keydown', (e) => {
      if (!$('page-arena').classList.contains('active')) return;
      if (e.target.matches('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); this.setPaused(!this.paused); }
      if (e.key === '.') this.stepOnce();
    });
  }

  bindCanvas() {
    const canvas = $('canvas');
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this.renderer.camera.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      if (this.renderer.camera.mode === 'free') $('camera').value = 'fit';
    }, { passive: false });
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      drag = { x: e.clientX, y: e.clientY };
      this.renderer.camera.pan(dx, dy);
      this.follow = null;
      $('camera').value = 'fit';
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('dblclick', () => this.setFollow(null));
  }

  // ---------- starting matches ----------

  selectedBots() {
    return this.slotSelects.map((s) => this.store.get(s.value)).filter(Boolean);
  }

  startFromSetup() {
    const bots = this.selectedBots();
    if (bots.length < 1) return alert('Pick at least one bot.');
    this.startLive(matchEntries(bots), seedFromText($('seed').value || '1'));
  }

  async startLive(entries, seed) {
    this.disposeMatch();
    const m = new LiveMatch(seed, entries);
    this.lastSetup = { entries, seed };
    this.attach(m);
    $('loading').classList.remove('hidden');
    await m.init();
    if (this.match !== m) return;
    $('loading').classList.add('hidden');
    this.paused = false;
    this.updatePauseButton();
    for (const r of m.runners) {
      if (r.status === 'error') this.feed(`⚠ ${r.name} failed to load (see Bot console)`, '#ff5c5c');
    }
  }

  playReplay(replay) {
    let m;
    try {
      m = new ReplayMatch(replay);
    } catch (err) {
      alert(err.message);
      return;
    }
    this.disposeMatch();
    this.lastSetup = null;
    this.attach(m);
    this.paused = false;
    this.updatePauseButton();
  }

  attach(m) {
    this.match = m;
    this.acc = 0;
    this.renderer.reset();
    $('banner').classList.add('hidden');
    $('killfeed').innerHTML = '';
    $('replay-badge').classList.toggle('hidden', !m.isReplay);
    const cam = $('camera');
    cam.innerHTML = '';
    cam.append(el('option', { value: 'fit' }, 'Whole map'));
    m.entries.forEach((e, i) => cam.append(el('option', { value: String(i) }, `Follow ${e.name}`)));
    const cs = $('console-ship');
    cs.innerHTML = '';
    m.entries.forEach((e, i) => cs.append(el('option', { value: String(i) }, e.name)));
    this.setFollow(this.follow != null && this.follow < m.entries.length ? this.follow : null);
    this.buildShipCards();
    this.renderConsole(true);
  }

  disposeMatch() {
    if (this.match) this.match.dispose();
    this.match = null;
  }

  setFollow(id) {
    this.follow = id;
    this.renderer.camera.mode = id == null ? 'fit' : 'follow';
    $('camera').value = id == null ? 'fit' : String(id);
    if (id != null) $('console-ship').value = String(id);
    document.querySelectorAll('.ship-card').forEach((c, i) => c.classList.toggle('followed', i === id));
    this.renderConsole(true);
  }

  setPaused(p) {
    this.paused = p;
    this.updatePauseButton();
  }

  updatePauseButton() {
    $('pause').textContent = this.paused ? '▶ Resume' : '⏸ Pause';
  }

  async stepOnce() {
    if (!this.match || this.stepping) return;
    this.setPaused(true);
    this.stepping = true;
    await this.advance(this.match);
    this.stepping = false;
  }

  // ---------- main loop ----------

  async advance(m) {
    if (m.world.over) return;
    await m.step();
    if (m !== this.match) return;
    this.renderer.addEvents(m.world.events, m.world);
    this.handleEvents(m.world.events);
  }

  async runSteps() {
    const m = this.match;
    this.stepping = true;
    let n = 0;
    while (this.acc >= C.DT && n < MAX_STEPS_PER_FRAME && m === this.match && !m.world.over && !this.paused) {
      await this.advance(m);
      this.acc -= C.DT;
      n++;
    }
    this.stepping = false;
  }

  frame(now) {
    const dt = Math.min(0.1, (now - (this.lastNow ?? now)) / 1000);
    this.lastNow = now;
    const m = this.match;
    const loading = m && !m.isReplay && m.runners.some((r) => r.status === 'loading');
    if (m && !this.paused && !m.world.over && !loading) {
      this.acc = Math.min(this.acc + dt * this.speed, C.DT * MAX_STEPS_PER_FRAME);
      if (!this.stepping && this.acc >= C.DT) this.runSteps();
    }
    if (document.getElementById('page-arena').classList.contains('active')) {
      this.renderer.draw(m?.world, {
        alpha: m && !this.paused ? Math.min(1, this.acc / C.DT) : 1,
        follow: this.follow,
        vision: $('show-vision').checked ? this.follow : null,
        showDebug: $('show-debug').checked,
        debug: m?.debug,
      });
      if (m && now - this.lastHud > 120) {
        this.lastHud = now;
        this.updateHud();
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- HUD ----------

  handleEvents(events) {
    const ships = this.match.world.ships;
    for (const e of events) {
      if (e.type === 'kill') {
        const victim = ships[e.ship];
        if (e.killer >= 0) this.feed(`${ships[e.killer].name} 💥 ${victim.name}`, ships[e.killer].color);
        else this.feed(`${victim.name} crashed and exploded`, victim.color);
      } else if (e.type === 'pigEaten') {
        this.feed(`${ships[e.ship].name} ate the pig 🐷 +25 ${e.stat}`, '#ff9ec4');
      } else if (e.type === 'pigSpawn') {
        this.feed('A new pig appeared in the middle! 🐷', '#ff9ec4');
      } else if (e.type === 'over') {
        this.showBanner();
      }
    }
  }

  feed(text, color) {
    const item = el('div', { class: 'feed-item', style: `border-color:${color}` }, text);
    const box = $('killfeed');
    box.prepend(item);
    while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => item.classList.add('fade'), 7000);
    setTimeout(() => item.remove(), 8000);
  }

  buildShipCards() {
    const wrap = $('ship-cards');
    wrap.innerHTML = '';
    this.cards = this.match.entries.map((e, i) => {
      const card = el('div', { class: 'ship-card', title: 'Click to follow this ship' },
        el('div', { class: 'card-head' },
          el('span', { class: 'dot', style: `background:${e.color}` }),
          el('b', {}, e.name),
          el('span', { class: 'card-status' })),
        el('div', { class: 'bar hp' }, el('div')),
        el('div', { class: 'bar energy' }, el('div')),
        el('div', { class: 'card-stats small' }));
      card.onclick = () => this.setFollow(this.follow === i ? null : i);
      wrap.append(card);
      return card;
    });
  }

  updateHud() {
    const m = this.match;
    const w = m.world;
    const left = Math.max(0, w.maxTicks - w.tick) / C.TICK_RATE;
    $('timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    $('pig-status').textContent = w.pig ? '🐷 pig is out!' : w.pigRespawnAt >= 0
      ? `🐷 next pig in ${Math.ceil((w.pigRespawnAt - w.tick) / C.TICK_RATE)}s` : '';

    w.ships.forEach((s, i) => {
      const card = this.cards?.[i];
      if (!card) return;
      const r = m.runners[i];
      card.classList.toggle('dead', !s.alive);
      card.querySelector('.hp div').style.width = `${(100 * Math.max(0, s.hp)) / s.maxHp}%`;
      card.querySelector('.energy div').style.width = `${(100 * s.energy) / s.maxEnergy}%`;
      let status = s.alive ? (s.shieldOn ? '🛡' : '') : '☠';
      if (r?.status === 'error') status += ' ⚠ load error';
      else if (r?.status === 'killed') status += ' ⚠ frozen';
      else if (r && (r.errors || r.timeouts)) status += ` ⚠ ${r.errors + r.timeouts}`;
      card.querySelector('.card-status').textContent = status;
      const up = s.upgrades;
      card.querySelector('.card-stats').textContent =
        `HP ${Math.ceil(Math.max(0, s.hp))}/${s.maxHp} · 💣${s.bombs} · K ${s.stats.kills} · dmg ${Math.round(s.stats.damageDealt)}` +
        (up.hp + up.energy + up.speed ? ` · 🐷 ${['hp', 'energy', 'speed'].filter((k) => up[k]).map((k) => `${k}×${up[k]}`).join(' ')}` : '');
    });
    this.renderConsole(false);
  }

  renderConsole(force) {
    const box = $('console');
    const m = this.match;
    if (!m) { box.textContent = ''; return; }
    if (m.isReplay) { box.innerHTML = '<p class="muted">Replays re-run the recorded moves, not the bots, so there\'s no console output.</p>'; return; }
    const r = m.runners[Number($('console-ship').value) || 0];
    if (!r) return;
    const key = `${r.name}:${r.logs.length}:${r.logs[r.logs.length - 1]?.tick}`;
    if (!force && key === this.consoleKey) return;
    this.consoleKey = key;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    box.innerHTML = '';
    if (!r.logs.length) box.append(el('p', { class: 'muted' }, 'Nothing yet. Use console.log() in your bot to print here (5 lines per tick max).'));
    for (const l of r.logs.slice(-200)) {
      box.append(el('div', { class: `log ${l.level}` }, el('span', { class: 'log-tick' }, `[${l.tick}] `), l.text));
    }
    if (atBottom || force) box.scrollTop = box.scrollHeight;
  }

  showBanner() {
    const m = this.match;
    const w = m.world;
    const winner = w.winner != null ? w.ships[w.winner] : null;
    const banner = $('banner');
    banner.innerHTML = '';
    banner.append(
      el('h2', { style: winner ? `color:${winner.color}` : '' }, winner ? `🏆 ${winner.name} wins!` : 'Draw!'),
      el('p', { class: 'muted' }, `${w.endReason} · ${(w.tick / C.TICK_RATE).toFixed(1)}s`),
      el('table', { class: 'stats' },
        el('tr', {}, ['Ship', 'HP', 'Kills', 'Damage', 'Accuracy', 'Blocked', 'Pigs'].map((h) => el('th', {}, h))),
        w.ships.map((s) => el('tr', {},
          el('td', {}, el('span', { class: 'dot', style: `background:${s.color}` }), s.name),
          el('td', {}, s.alive ? String(Math.ceil(s.hp)) : '☠'),
          el('td', {}, String(s.stats.kills)),
          el('td', {}, String(Math.round(s.stats.damageDealt))),
          el('td', {}, s.stats.shots ? `${Math.round((100 * s.stats.hits) / s.stats.shots)}%` : '-'),
          el('td', {}, String(Math.round(s.stats.blocked))),
          el('td', {}, String(s.stats.pigs))))),
      el('div', { class: 'btn-row' },
        this.lastSetup && el('button', { class: 'primary', onclick: () => this.startLive(this.lastSetup.entries, this.lastSetup.seed) }, '↻ Rematch (same seed)'),
        this.lastSetup && el('button', {
          onclick: () => {
            const seed = (this.lastSetup.seed + 1) >>> 0;
            $('seed').value = String(seed);
            this.startLive(this.lastSetup.entries, seed);
          },
        }, '⏭ Next seed'),
        el('button', { onclick: () => this.saveReplay() }, '💾 Save replay'),
        el('button', { onclick: () => banner.classList.add('hidden') }, 'Close')));
    banner.classList.remove('hidden');
  }

  // ---------- replays ----------

  saveReplay() {
    if (!this.match) return alert('Nothing to save yet. Start a match first.');
    const replay = this.match.toReplay();
    const names = replay.entries.map((e) => safeFileName(e.name)).join('-vs-');
    downloadText(`replay-${names}-seed${replay.seed}.json`, JSON.stringify(replay), 'application/json');
  }

  async loadReplay() {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    try {
      this.playReplay(JSON.parse(file.text));
    } catch (err) {
      alert('Could not read that replay: ' + err.message);
    }
  }
}
