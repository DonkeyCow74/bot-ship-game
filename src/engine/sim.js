import { C, PIG_STATS } from './constants.js';
import { controlShip } from './ship.js';
import { moveAsteroids } from './asteroid.js';
import { tryFire, updateBullets } from './projectile.js';
import { tryDropBomb, updateBombs } from './bomb.js';
import { updatePig } from './pig.js';
import { moveShips, collideShips } from './collision.js';
import { updateSaws } from './saw.js';

export { createWorld } from './world.js';
export { getView, hasLineOfSight } from './vision.js';

const IDLE = Object.freeze({ thrust: 0, turn: 0, fire: false, bomb: false, shield: false, saw: false, dash: false, pigStat: 'hp' });

function num(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  v = v < lo ? lo : v > hi ? hi : v;
  return Math.round(v * 1000) / 1000; // quantized so replays are exact
}

// Whatever a bot returns, this turns it into a legal command. Nothing else gets through.
export function sanitizeCommand(c) {
  if (!c || typeof c !== 'object') return IDLE;
  return {
    thrust: num(c.thrust, 0, 1),
    turn: num(c.turn, -1, 1),
    fire: !!c.fire,
    bomb: !!c.bomb,
    shield: c.shield === 'back' ? 'back' : c.shield ? 'front' : false, // true = 'front'
    saw: !!c.saw,
    dash: !!c.dash,
    pigStat: PIG_STATS.includes(c.pigStat) ? c.pigStat : 'hp',
  };
}

const SHIELDS = [false, 'front', 'back'];

// Compact form for replays: [thrust, turn, flags]
export function encodeCommand(c) {
  const flags = (c.fire ? 1 : 0) | (c.bomb ? 2 : 0) | (SHIELDS.indexOf(c.shield) << 2) | (PIG_STATS.indexOf(c.pigStat) << 4) |
    (c.saw ? 64 : 0) | (c.dash ? 128 : 0);
  return [c.thrust, c.turn, flags];
}

export function decodeCommand(e) {
  if (!e) return IDLE;
  const [thrust, turn, flags] = e;
  return {
    thrust, turn,
    fire: !!(flags & 1), bomb: !!(flags & 2), shield: SHIELDS[(flags >> 2) & 3] || false,
    saw: !!(flags & 64), dash: !!(flags & 128),
    pigStat: PIG_STATS[(flags >> 4) & 3] || 'hp',
  };
}

// Advances the world by one tick. commands[i] is ship i's command (anything; it's sanitized).
export function step(world, commands) {
  if (world.over) return world.events;
  world.events = [];
  const cmds = world.ships.map((s, i) => sanitizeCommand(commands?.[i]));

  for (const s of world.ships) {
    s.px = s.x; s.py = s.y; s.pa = s.angle;
    if (!s.alive) continue;
    const cmd = cmds[s.id];
    s.lastCmd = cmd;
    controlShip(s, cmd);
    if (cmd.fire) tryFire(world, s);
    if (cmd.bomb) tryDropBomb(world, s);
    if (s.dashTicks === C.DASH_TICKS) world.events.push({ type: 'dash', x: s.x, y: s.y, ship: s.id, angle: s.angle });
  }

  moveShips(world);
  moveAsteroids(world);
  collideShips(world);
  updateSaws(world);
  updateBullets(world);
  updateBombs(world);
  updatePig(world, cmds);

  // Deaths
  for (const s of world.ships) {
    if (!s.alive || s.hp > 0) continue;
    s.hp = 0;
    s.alive = false;
    s.shieldOn = false;
    s.shieldSide = null;
    s.sawOn = false;
    s.diedAt = world.tick;
    // Credit whoever hit them last within 5 seconds (covers being knocked into rocks)
    const killer = s.lastHitBy >= 0 && world.tick - s.lastHitTick <= 150 ? s.lastHitBy : -1;
    s.killedBy = killer;
    if (killer >= 0) world.ships[killer].stats.kills++;
    world.events.push({ type: 'kill', x: s.x, y: s.y, ship: s.id, killer });
  }

  world.bullets = world.bullets.filter((b) => !b.dead);
  world.bombs = world.bombs.filter((b) => !b.dead);
  world.asteroids = world.asteroids.filter((a) => !a.dead);
  world.tick++;
  checkWin(world);
  return world.events;
}

function checkWin(world) {
  const alive = world.ships.filter((s) => s.alive);
  if (world.ships.length >= 2 && alive.length <= 1) {
    world.over = true;
    world.winner = alive.length === 1 ? alive[0].id : null;
    world.endReason = alive.length === 1 ? 'last ship flying' : 'everyone exploded';
  } else if (world.ships.length === 1 && alive.length === 0) {
    world.over = true;
    world.winner = null;
    world.endReason = 'destroyed';
  } else if (world.tick >= world.maxTicks) {
    world.over = true;
    const best = Math.max(...alive.map((s) => s.hp));
    const top = alive.filter((s) => s.hp === best);
    world.winner = top.length === 1 ? top[0].id : null;
    world.endReason = top.length === 1 ? 'time up: most HP' : 'time up: tied on HP';
  }
  if (world.over) world.events.push({ type: 'over', winner: world.winner });
}

// Short fingerprint of the full state, for determinism tests.
export function hashWorld(world) {
  const parts = [world.tick, world.over, world.winner];
  const r = (v) => Math.round(v * 1000);
  for (const s of world.ships) parts.push(r(s.x), r(s.y), r(s.vx), r(s.vy), r(s.angle), r(s.hp), r(s.energy), s.bombs, s.alive);
  for (const a of world.asteroids) parts.push(a.id, r(a.x), r(a.y), a.hitsLeft);
  for (const b of world.bullets) parts.push(b.id, r(b.x), r(b.y));
  for (const b of world.bombs) parts.push(b.id, r(b.x), r(b.y));
  if (world.pig) parts.push(r(world.pig.x), r(world.pig.y));
  const str = parts.join(',');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export { C };
