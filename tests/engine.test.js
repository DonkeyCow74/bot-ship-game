import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C, createWorld, step, getView, hashWorld, sanitizeCommand, encodeCommand, decodeCommand } from '../src/engine/sim.js';
import { createAsteroid } from '../src/engine/asteroid.js';
import { runLocalMatch } from '../src/bots/localRunner.js';

const bot = (file) => ({ name: file, code: readFileSync(new URL(`../bots/${file}.js`, import.meta.url), 'utf8') });
const two = [{ name: 'A' }, { name: 'B' }];

// An empty arena with ships placed by hand, for focused tests.
function emptyWorld(entries = two) {
  const w = createWorld(1, entries);
  w.asteroids = [];
  w.pig = null;
  w.pigRespawnAt = -1;
  return w;
}
const idle = (n) => Array.from({ length: n }, () => null);

test('same seed + same bots = identical match', () => {
  const bots = [bot('hunter'), bot('sniper'), bot('spinner')];
  const a = runLocalMatch({ seed: 1234, bots, maxTicks: 1500 });
  const b = runLocalMatch({ seed: 1234, bots, maxTicks: 1500 });
  assert.equal(hashWorld(a), hashWorld(b));
  const c = runLocalMatch({ seed: 999, bots, maxTicks: 1500 });
  assert.notEqual(hashWorld(a), hashWorld(c));
});

test('replaying recorded commands reproduces the match', () => {
  const bots = [bot('hunter'), bot('sniper')];
  const log = [];
  const live = runLocalMatch({
    seed: 77, bots, maxTicks: 1200,
    onTick: (w, cmds) => log.push(cmds.map((c) => encodeCommand(sanitizeCommand(c)))),
  });
  const replay = createWorld(77, bots);
  replay.maxTicks = 1200;
  for (const rec of log) step(replay, rec.map(decodeCommand));
  assert.equal(hashWorld(replay), hashWorld(live));
});

test('asteroids break after 3 hits: large -> 2 medium -> 2 small -> gone', () => {
  const w = emptyWorld();
  const a = createAsteroid(w, 2, 1000, 1000, 0, 0);
  const shoot = (target) => {
    w.bullets.push({ id: w.nextId++, owner: 0, x: target.x - 200, y: target.y, px: 0, py: 0, vx: C.BULLET_SPEED, vy: 0, life: 99, dead: false });
    for (let i = 0; i < 10; i++) step(w, idle(2));
  };
  shoot(a); shoot(a);
  assert.equal(a.hitsLeft, 1);
  assert.equal(w.asteroids.length, 1);
  shoot(a);
  assert.equal(w.asteroids.length, 2);
  assert.ok(w.asteroids.every((x) => x.size === 1));
  const m = w.asteroids[0];
  m.vx = m.vy = 0;
  w.asteroids[1].x = 4000; // move the other one out of the way
  for (let i = 0; i < 3; i++) shoot(m);
  assert.equal(w.asteroids.filter((x) => x.size === 0).length, 2);
  const s = w.asteroids.find((x) => x.size === 0);
  for (const other of w.asteroids) if (other !== s) other.x = 5000;
  s.vx = s.vy = 0;
  for (let i = 0; i < 3; i++) shoot(s);
  assert.ok(!w.asteroids.includes(s));
});

test('asteroids block line of sight', () => {
  const w = emptyWorld();
  const [me, them] = w.ships;
  me.x = 1000; me.y = 1000;
  them.x = 1800; them.y = 1000;
  assert.equal(getView(w, 0).enemies.length, 1);
  createAsteroid(w, 1, 1400, 1000, 0, 0);
  assert.equal(getView(w, 0).enemies.length, 0);
  them.y = 1300; // step out from behind it
  assert.equal(getView(w, 0).enemies.length, 1);
  them.x = 1000 + C.SENSOR_RANGE + 100; them.y = 1000; // out of sensor range
  w.asteroids = [];
  assert.equal(getView(w, 0).enemies.length, 0);
});

test('bombs arm after 1 s, trigger on enemies, blast hurts', () => {
  const w = emptyWorld();
  const [me, them] = w.ships;
  me.x = 1000; me.y = 1000; me.angle = 0;
  them.x = 3000; them.y = 3000;
  step(w, [{ bomb: true }, null]);
  assert.equal(w.bombs.length, 1);
  assert.equal(me.bombs, C.BOMBS - 1);
  const bomb = w.bombs[0];
  them.x = bomb.x + 60; them.y = bomb.y; // right on top of it, but it isn't armed yet
  them.vx = them.vy = 0;
  step(w, idle(2));
  assert.equal(w.bombs.length, 1);
  for (let i = 0; i < C.BOMB_ARM_TICKS; i++) {
    them.x = bomb.x + 60; them.y = bomb.y; // hold still next to it
    step(w, idle(2));
  }
  assert.equal(w.bombs.length, 0);
  assert.ok(them.hp < C.SHIP_HP - 30, `took ${C.SHIP_HP - them.hp}`);
});

test('ships bounce off walls', () => {
  const w = emptyWorld();
  const s = w.ships[0];
  s.x = 30; s.y = 3000; s.vx = -200; s.vy = 0;
  for (let i = 0; i < 10; i++) step(w, idle(2));
  assert.ok(s.x >= C.SHIP_RADIUS);
  assert.ok(s.vx > 0);
});

test('front shield blocks hits from the front, costs a chunk to raise, and stops firing', () => {
  const w = emptyWorld();
  const [me, them] = w.ships;
  me.x = 1000; me.y = 1000; me.vx = me.vy = 0; me.angle = 0; // facing right, toward them
  them.x = 1300; them.y = 1000; them.angle = Math.PI; them.vx = them.vy = 0;
  step(w, [{ shield: 'front', fire: true }, null]);
  assert.ok(me.shieldOn);
  assert.equal(me.shieldSide, 'front');
  assert.ok(me.energy < C.SHIP_ENERGY - C.SHIELD_ACTIVATE_COST + 1, 'paid the activation cost');
  for (let i = 0; i < 20; i++) step(w, [{ shield: 'front', fire: true }, { fire: true }]);
  assert.equal(me.hp, C.SHIP_HP);
  assert.ok(me.stats.blocked > 0);
  assert.equal(me.stats.shots, 0);
  // Shield runs out of energy and drops
  for (let i = 0; i < 200; i++) step(w, [{ shield: 'front' }, { fire: true }]);
  assert.ok(me.hp < C.SHIP_HP);
});

test('back shield does not block hits from the front', () => {
  const w = emptyWorld();
  const [me, them] = w.ships;
  me.x = 1000; me.y = 1000; me.vx = me.vy = 0; me.angle = 0;
  them.x = 1300; them.y = 1000; them.angle = Math.PI; them.vx = them.vy = 0;
  for (let i = 0; i < 30; i++) step(w, [{ shield: 'back' }, { fire: true }]);
  assert.equal(me.shieldSide, 'back');
  assert.ok(me.hp < C.SHIP_HP);
  assert.equal(me.stats.blocked, 0);
  // Turn around: now the back shield faces them
  me.angle = Math.PI;
  const hp = me.hp;
  for (let i = 0; i < 20; i++) step(w, [{ shield: 'back' }, { fire: true }]);
  assert.equal(me.hp, hp);
  assert.ok(me.stats.blocked > 0);
});

test('shield needs enough energy to raise', () => {
  const w = emptyWorld();
  const me = w.ships[0];
  me.energy = C.SHIELD_MIN_ENERGY - 1;
  step(w, [{ shield: true }, null]);
  assert.equal(me.shieldOn, false);
  me.energy = C.SHIELD_MIN_ENERGY + 5;
  step(w, [{ shield: true }, null]); // true means 'front'
  assert.equal(me.shieldSide, 'front');
});

test('pig zone stays clear of asteroids', () => {
  const w = createWorld(5, two);
  const cx = C.ARENA_W / 2, cy = C.ARENA_H / 2;
  createAsteroid(w, 2, cx + 1000, cy, -C.ASTEROID_MAX_SPEED, 0); // aimed right at the middle
  for (let t = 0; t < 1500; t++) {
    step(w, idle(2));
    for (const a of w.asteroids) {
      assert.ok(Math.hypot(a.x - cx, a.y - cy) >= C.PIG_ZONE_RADIUS + a.r - 2, `asteroid in zone at tick ${t}`);
    }
  }
});

test('pig gives the chosen upgrade once, then respawns after 60 s', () => {
  const w = emptyWorld();
  w.maxTicks = 99999;
  const [me, them] = w.ships;
  them.x = 200; them.y = 200;
  step(w, idle(2));
  assert.equal(w.pig, null);
  // Fast-forward to the respawn
  w.pigRespawnAt = w.tick + 1;
  step(w, idle(2)); step(w, idle(2));
  assert.ok(w.pig);
  me.x = w.pig.x; me.y = w.pig.y; me.vx = me.vy = 0;
  step(w, [{ pigStat: 'energy' }, null]);
  assert.equal(w.pig, null);
  assert.equal(me.maxEnergy, C.SHIP_ENERGY + C.PIG_BONUS);
  assert.equal(me.upgrades.energy, 1);
  for (let i = 0; i < 20; i++) step(w, [{ pigStat: 'energy' }, null]);
  assert.equal(me.upgrades.energy, 1);
  for (let i = 0; i < C.PIG_RESPAWN_TICKS; i++) step(w, idle(2));
  assert.ok(w.pig, 'pig respawned');
  me.x = w.pig.x; me.y = w.pig.y;
  step(w, [{ pigStat: 'speed' }, null]);
  assert.equal(me.maxSpeed, C.MAX_SPEED + C.MAX_SPEED * C.PIG_SPEED_BONUS);
  me.x = 3000; me.y = 3000;
  w.pigRespawnAt = w.tick + 1;
  step(w, idle(2)); step(w, idle(2));
  me.x = w.pig.x; me.y = w.pig.y;
  step(w, [{ pigStat: 'hp' }, null]);
  assert.equal(me.maxHp, C.SHIP_HP + C.PIG_BONUS);
});

test('bad commands are sanitized', () => {
  assert.deepEqual(sanitizeCommand({ thrust: 99, turn: -Infinity, fire: 'yes', pigStat: 'lasers' }),
    { thrust: 1, turn: 0, fire: true, bomb: false, shield: false, pigStat: 'hp' });
  assert.equal(sanitizeCommand({ shield: 'back' }).shield, 'back');
  assert.equal(sanitizeCommand({ shield: 'sideways' }).shield, 'front');
  assert.equal(sanitizeCommand(null).thrust, 0);
  assert.equal(sanitizeCommand({ thrust: NaN }).thrust, 0);
});

test('views contain only plain data', () => {
  const w = createWorld(3, two);
  const v = getView(w, 0);
  assert.deepEqual(structuredClone(v), v);
});

test('sample bots finish full matches', () => {
  const w = runLocalMatch({ seed: 42, bots: [bot('hunter'), bot('sniper'), bot('spinner')] });
  assert.ok(w.over);
});
