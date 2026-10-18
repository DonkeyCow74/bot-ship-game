import { C } from './constants.js';
import { damageShip } from './ship.js';
import { breakAsteroid } from './asteroid.js';

export function tryDropBomb(world, ship) {
  if (ship.bombs <= 0 || ship.bombCooldown > 0) return false;
  const back = C.SHIP_RADIUS + C.BOMB_RADIUS + 6;
  const x = ship.x - Math.cos(ship.angle) * back;
  const y = ship.y - Math.sin(ship.angle) * back;
  world.bombs.push({
    id: world.nextId++,
    owner: ship.id,
    x, y, px: x, py: y,
    vx: ship.vx * 0.3,
    vy: ship.vy * 0.3,
    armAt: world.tick + C.BOMB_ARM_TICKS,
    fuseAt: world.tick + C.BOMB_FUSE_TICKS,
    dead: false,
  });
  ship.bombs--;
  ship.bombCooldown = C.BOMB_COOLDOWN_TICKS;
  world.events.push({ type: 'bombDrop', x, y, ship: ship.id });
  return true;
}

export function updateBombs(world) {
  const dt = C.DT;
  const drag = 1 - C.BOMB_DRAG * dt;
  for (const b of world.bombs) {
    if (b.dead) continue;
    b.px = b.x; b.py = b.y;
    b.vx *= drag; b.vy *= drag;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (world.tick >= b.fuseAt) { detonateBomb(world, b); continue; }
    if (world.tick < b.armAt) continue;
    for (const s of world.ships) {
      if (!s.alive || s.id === b.owner) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) <= C.BOMB_TRIGGER_RADIUS + C.SHIP_RADIUS) {
        detonateBomb(world, b);
        break;
      }
    }
  }
}

// Blasts everything nearby, including the bomb's owner. Chains into other bombs.
export function detonateBomb(world, bomb) {
  if (bomb.dead) return;
  bomb.dead = true;
  const R = C.BOMB_BLAST_RADIUS;
  world.events.push({ type: 'explosion', x: bomb.x, y: bomb.y, r: R, owner: bomb.owner });
  for (const s of world.ships) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - bomb.x, s.y - bomb.y) - C.SHIP_RADIUS;
    if (d > R) continue;
    const falloff = 1 - 0.5 * Math.max(0, d) / R;
    damageShip(world, s, C.BOMB_DAMAGE * falloff, bomb.owner, 'bomb');
  }
  // Snapshot: pieces created by this blast shouldn't be broken again by it
  for (const a of world.asteroids.slice()) {
    if (a.dead) continue;
    if (Math.hypot(a.x - bomb.x, a.y - bomb.y) - a.r <= R) breakAsteroid(world, a);
  }
  for (const other of world.bombs) {
    if (!other.dead && Math.hypot(other.x - bomb.x, other.y - bomb.y) <= R) detonateBomb(world, other);
  }
}
