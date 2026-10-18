import { C } from './constants.js';
import { damageShip, shieldCovers, useCharge } from './ship.js';
import { hitAsteroid } from './asteroid.js';

// A blast all around the ship: damages, knocks back and spins every enemy in range, and
// counts as one hit on nearby asteroids. A shield facing the blast blocks the damage and
// the spin, but its owner still gets pushed.
export function tryShockwave(world, ship) {
  if (!useCharge(ship, 'shockwave')) return false;
  world.events.push({ type: 'shockwave', x: ship.x, y: ship.y, r: C.SHOCKWAVE_RADIUS, ship: ship.id });

  for (const o of world.ships) {
    if (o === ship || !o.alive) continue;
    const dx = o.x - ship.x, dy = o.y - ship.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > C.SHOCKWAVE_RADIUS) continue;
    const nx = dx / d, ny = dy / d;
    o.vx += nx * C.SHOCKWAVE_KNOCKBACK;
    o.vy += ny * C.SHOCKWAVE_KNOCKBACK;
    const shielded = shieldCovers(o, ship.x, ship.y);
    damageShip(world, o, C.SHOCKWAVE_DAMAGE, ship.id, 'shockwave', ship.x, ship.y);
    if (shielded) continue;
    o.spinTicks = C.SHOCKWAVE_SPIN_TICKS;
    // Spin the way the blast would twist them (based on which way they're facing)
    o.spinDir = Math.cos(o.angle) * ny - Math.sin(o.angle) * nx >= 0 ? -1 : 1;
    world.events.push({ type: 'shockHit', x: o.x, y: o.y, ship: o.id });
  }
  for (const a of world.asteroids.slice()) {
    if (a.dead) continue;
    if (Math.hypot(a.x - ship.x, a.y - ship.y) - a.r <= C.SHOCKWAVE_RADIUS) hitAsteroid(world, a);
  }
  return true;
}
