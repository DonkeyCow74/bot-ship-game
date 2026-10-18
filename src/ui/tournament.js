import { C } from '../engine/constants.js';
import { seedFromText } from '../engine/rng.js';
import { LiveMatch } from '../match.js';
import { matchEntries } from './storage.js';
import { el } from './files.js';

const $ = (id) => document.getElementById(id);
const MAX_KEPT_REPLAYS = 300;

// Every spawn order is played (rotations), so starting position isn't an advantage.
function schedule(bots, mode, rounds, seed0) {
  const games = [];
  if (mode === 'ffa') {
    for (let r = 0; r < rounds; r++) {
      const order = bots.map((_, i) => bots[(i + r) % bots.length]);
      games.push({ bots: order, seed: (seed0 + r) >>> 0 });
    }
  } else {
    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        for (let r = 0; r < rounds; r++) {
          games.push({ bots: r % 2 ? [bots[j], bots[i]] : [bots[i], bots[j]], seed: (seed0 + r) >>> 0 });
        }
      }
    }
  }
  return games;
}

export class Tournament {
  constructor(store, onWatch) {
    this.store = store;
    this.onWatch = onWatch;
    this.running = false;
    $('t-run').onclick = () => this.run();
    $('t-stop').onclick = () => { this.stopRequested = true; };
    this.store.onChange(() => this.renderBotChecks());
    this.renderBotChecks();
  }

  renderBotChecks() {
    const wrap = $('t-bots');
    const checked = new Set([...wrap.querySelectorAll('input:checked')].map((i) => i.value));
    const first = !wrap.children.length;
    wrap.replaceChildren(...this.store.all().map((b) => el('label', { class: 'check' },
      el('input', { type: 'checkbox', value: b.id, checked: checked.has(b.id) || (first && b.builtin && !b.name.includes('Spinner')) }),
      el('span', { class: 'dot', style: `background:${b.color}` }), b.name)));
  }

  async run() {
    if (this.running) return;
    const bots = [...$('t-bots').querySelectorAll('input:checked')].map((i) => this.store.get(i.value)).filter(Boolean);
    const mode = $('t-mode').value;
    if (bots.length < 2) return alert('Pick at least two bots.');
    if (mode === 'ffa' && bots.length > 4) return alert('Free-for-all fits at most 4 ships. Pick 4 or fewer bots, or use 1 vs 1.');
    const rounds = Math.max(1, Math.min(200, Number($('t-rounds').value) || 1));
    const games = schedule(bots, mode, rounds, seedFromText($('t-seed').value || '1'));

    this.running = true;
    this.stopRequested = false;
    $('t-run').disabled = true;
    const table = new Map(bots.map((b) => [b.id, {
      bot: b, played: 0, wins: 0, draws: 0, losses: 0, kills: 0, damage: 0, pigs: 0, survived: 0, errors: 0,
    }]));
    this.results = [];
    $('t-matches').replaceChildren();
    const started = performance.now();

    for (let g = 0; g < games.length && !this.stopRequested; g++) {
      const game = games[g];
      const entries = matchEntries(game.bots);
      $('t-status').textContent = `Match ${g + 1} of ${games.length}: ${entries.map((e) => e.name).join(' vs ')}`;
      const m = new LiveMatch(game.seed, entries);
      await m.init();
      // Each step waits on worker messages, so the page stays responsive
      while (!m.world.over && !this.stopRequested) await m.step();
      m.dispose();
      if (this.stopRequested) break;

      const w = m.world;
      w.ships.forEach((s, i) => {
        const row = table.get(entries[i].botId);
        row.played++;
        if (w.winner === i) row.wins++;
        else if (w.winner === null) row.draws++;
        else row.losses++;
        row.kills += s.stats.kills;
        row.damage += s.stats.damageDealt;
        row.pigs += s.stats.pigs;
        row.survived += (s.alive ? w.tick : s.diedAt) / C.TICK_RATE;
        row.errors += m.runners[i].errors + m.runners[i].timeouts + (m.runners[i].status === 'ready' ? 0 : 1);
      });
      const result = {
        n: g + 1, seed: game.seed, entries, winner: w.winner, reason: w.endReason, seconds: w.tick / C.TICK_RATE,
        replay: this.results.length < MAX_KEPT_REPLAYS ? m.toReplay() : null,
      };
      this.results.push(result);
      this.addMatchRow(result);
      this.renderStandings(table);
      $('t-progress-bar').style.width = `${(100 * (g + 1)) / games.length}%`;
    }

    const secs = ((performance.now() - started) / 1000).toFixed(1);
    $('t-status').textContent = this.stopRequested
      ? `Stopped after ${this.results.length} matches.`
      : `Done: ${this.results.length} matches in ${secs}s.`;
    $('t-run').disabled = false;
    this.running = false;
  }

  renderStandings(table) {
    const rows = [...table.values()].sort((a, b) =>
      b.wins / (b.played || 1) - a.wins / (a.played || 1) || b.damage - a.damage);
    const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
    $('t-standings').replaceChildren(el('table', { class: 'stats standings' },
      el('tr', {}, ['#', 'Bot', 'Win %', 'W', 'D', 'L', 'Kills', 'Avg dmg', 'Avg survival', 'Pigs', 'Bot errors'].map((h) => el('th', {}, h))),
      rows.map((r, i) => el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, el('span', { class: 'dot', style: `background:${r.bot.color}` }), r.bot.name),
        el('td', { class: 'big' }, pct(r.wins, r.played)),
        el('td', {}, String(r.wins)), el('td', {}, String(r.draws)), el('td', {}, String(r.losses)),
        el('td', {}, String(r.kills)),
        el('td', {}, r.played ? String(Math.round(r.damage / r.played)) : '-'),
        el('td', {}, r.played ? `${Math.round(r.survived / r.played)}s` : '-'),
        el('td', {}, String(r.pigs)),
        el('td', { class: r.errors ? 'warn' : '' }, String(r.errors))))));
  }

  addMatchRow(r) {
    const winner = r.winner != null ? r.entries[r.winner] : null;
    $('t-matches').prepend(el('div', { class: 't-match' },
      el('span', { class: 'muted' }, `#${r.n}`),
      el('span', {}, r.entries.map((e, i) => el('span', { class: i === r.winner ? 'won' : '' },
        el('span', { class: 'dot', style: `background:${e.color}` }), e.name, i < r.entries.length - 1 ? ' vs ' : ''))),
      el('span', { class: 'muted' }, `${winner ? winner.name + ' won' : 'draw'} · ${r.reason} · ${r.seconds.toFixed(0)}s · seed ${r.seed}`),
      r.replay ? el('button', { onclick: () => this.onWatch(r.replay) }, '▶ Watch') : null));
  }
}
