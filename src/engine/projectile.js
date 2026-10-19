import { C } from './constants.js';
import { segmentCircleEntry } from './vec.js';
import { damageShip } from './ship.js';
import { hitAsteroid } from './asteroid.js';
import { shootBomb } from './bomb.js';

export function tryFire(world, ship) {
  if (!ship.loadout.includes('gun') || ship.shieldOn || ship.gunCooldown > 0 || ship.energy < C.BULLET_COST) return false;
  const cos = Math.cos(ship.angle), sin = Math.sin(ship.angle);
  const nose = C.SHIP_RADIUS + 4;
  const x = ship.x + cos * nose, y = ship.y + sin * nose;
  world.bullets.push({
    id: world.nextId++,
    owner: ship.id,
    x, y, px: x, py: y,
    vx: ship.vx + cos * C.BULLET_SPEED,
    vy: ship.vy + sin * C.BULLET_SPEED,
    life: Math.round((C.BULLET_RANGE / C.BULLET_SPEED) * C.TICK_RATE),
    dead: false,
  });
  ship.energy -= C.BULLET_COST;
  ship.gunCooldown = C.FIRE_COOLDOWN_TICKS;
  ship.stats.shots++;
  world.events.push({ type: 'fire', x, y, ship: ship.id });
  return true;
}

export function updateBullets(world) {
  const dt = C.DT;
  for (const b of world.bullets) {
    if (b.dead) continue;
    const x1 = b.x, y1 = b.y;
    const x2 = x1 + b.vx * dt, y2 = y1 + b.vy * dt;
    b.px = x1; b.py = y1;

    // Find the first thing along this tick's path
    let bestT = 2, hit = null, kind = null;
    for (const s of world.ships) {
      if (!s.alive || s.id === b.owner) continue;
      const t = segmentCircleEntry(x1, y1, x2, y2, s.x, s.y, C.SHIP_RADIUS + C.BULLET_RADIUS);
      if (t >= 0 && t < bestT) { bestT = t; hit = s; kind = 'ship'; }
    }
    for (const a of world.asteroids) {
      if (a.dead) continue;
      const t = segmentCircleEntry(x1, y1, x2, y2, a.x, a.y, a.r + C.BULLET_RADIUS);
      if (t >= 0 && t < bestT) { bestT = t; hit = a; kind = 'asteroid'; }
    }
    for (const bomb of world.bombs) {
      if (bomb.dead) continue;
      const t = segmentCircleEntry(x1, y1, x2, y2, bomb.x, bomb.y, C.BOMB_RADIUS + C.BULLET_RADIUS);
      if (t >= 0 && t < bestT) { bestT = t; hit = bomb; kind = 'bomb'; }
    }

    if (hit) {
      b.dead = true;
      b.x = x1 + (x2 - x1) * bestT;
      b.y = y1 + (y2 - y1) * bestT;
      if (kind === 'ship') {
        const shooter = world.ships[b.owner];
        damageShip(world, hit, C.BULLET_DAMAGE, b.owner, 'bullet', x1, y1);
        if (shooter) shooter.stats.hits++;
      } else if (kind === 'asteroid') {
        hitAsteroid(world, hit);
      } else {
        shootBomb(world, hit);
      }
      continue;
    }

    b.x = x2; b.y = y2;
    b.life--;
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > C.ARENA_W || b.y > C.ARENA_H) b.dead = true;
  }
}
