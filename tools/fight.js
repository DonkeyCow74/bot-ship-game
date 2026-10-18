// Headless fights from the command line (no sandbox, for quick bot testing):
//   node tools/fight.js bots/hunter.js bots/sniper.js [--rounds 10] [--seed 1]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { runLocalMatch } from '../src/bots/localRunner.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return Number(v);
};
const rounds = opt('--rounds', 10);
const seed0 = opt('--seed', 1);
if (args.length < 1) {
  console.log('usage: node tools/fight.js bot1.js bot2.js [bot3.js bot4.js] [--rounds N] [--seed S]');
  process.exit(1);
}

const bots = args.map((f) => {
  const code = readFileSync(f, 'utf8');
  const name = code.match(/@name\s+(.+)/)?.[1].trim() || basename(f, '.js');
  return { name, code };
});

const totals = bots.map((b) => ({ name: b.name, wins: 0, kills: 0, damage: 0, pigs: 0, shots: 0, hits: 0 }));
let draws = 0;
for (let r = 0; r < rounds; r++) {
  // Rotate spawn slots each round so nobody always gets the same start
  const order = bots.map((_, i) => (i + r) % bots.length);
  const w = runLocalMatch({ seed: seed0 + r, bots: order.map((i) => bots[i]) });
  const line = w.ships.map((s) => `${s.name}:${s.alive ? Math.round(s.hp) + 'hp' : 'dead'}`).join('  ');
  const winner = w.winner === null ? 'draw' : w.ships[w.winner].name;
  console.log(`seed ${seed0 + r}  ${(w.tick / 30).toFixed(0).padStart(3)}s  winner: ${winner.padEnd(10)} ${line}  (${w.endReason})`);
  if (w.winner === null) draws++;
  w.ships.forEach((s, slot) => {
    const t = totals[order[slot]];
    if (w.winner === slot) t.wins++;
    t.kills += s.stats.kills; t.damage += s.stats.damageDealt; t.pigs += s.stats.pigs;
    t.shots += s.stats.shots; t.hits += s.stats.hits;
  });
}
console.log('\nbot         wins  kills  dmg/match  pigs  accuracy');
for (const t of totals) {
  console.log(`${t.name.padEnd(11)} ${String(t.wins).padStart(4)}  ${String(t.kills).padStart(5)}  ${(t.damage / rounds).toFixed(0).padStart(9)}  ${String(t.pigs).padStart(4)}  ${t.shots ? ((100 * t.hits) / t.shots).toFixed(0) + '%' : '-'}`);
}
console.log(`draws: ${draws}`);
