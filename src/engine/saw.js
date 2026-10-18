import { C } from './constants.js';
import { damageShip } from './ship.js';
import { hitAsteroid } from './asteroid.js';

// Where the blade is (just past the ship's nose).
export function sawCenter(ship) {
  const d = C.SHIP_RADIUS + C.SAW_REACH;
  return { x: ship.x + Math.cos(ship.angle) * d, y: ship.y + Math.sin(ship.angle) * d };
}

// One saw strike: a chunk of damage plus a shove to every ship the blade touches, and
// one hit to every asteroid it touches. Not allowed with the shield up.
export function trySaw(world, ship) {
  if (ship.shieldOn || ship.sawCooldown > 0 || ship.energy < C.SAW_COST) return false;
  ship.energy -= C.SAW_COST;
  ship.sawCooldown = C.SAW_COOLDOWN_TICKS;
  ship.sawTicks = C.SAW_SHOW_TICKS;
  const blade = sawCenter(ship);
  world.events.push({ type: 'saw', x: blade.x, y: blade.y, ship: ship.id });

  for (const o of world.ships) {
    if (o === ship || !o.alive) continue;
    if (Math.hypot(o.x - blade.x, o.y - blade.y) > C.SAW_RADIUS + C.SHIP_RADIUS) continue;
    damageShip(world, o, C.SAW_DAMAGE, ship.id, 'saw', blade.x, blade.y);
    // Knock them away from us (even a shield gets shoved), and we recoil a little
    const dx = o.x - ship.x, dy = o.y - ship.y;
    const d = Math.hypot(dx, dy) || 1;
    o.vx += (dx / d) * C.SAW_KNOCKBACK;
    o.vy += (dy / d) * C.SAW_KNOCKBACK;
    ship.vx -= (dx / d) * C.SAW_RECOIL;
    ship.vy -= (dy / d) * C.SAW_RECOIL;
    world.events.push({ type: 'sawHit', x: (o.x + blade.x) / 2, y: (o.y + blade.y) / 2, ship: ship.id });
  }
  for (const a of world.asteroids) {
    if (a.dead) continue;
    if (Math.hypot(a.x - blade.x, a.y - blade.y) > C.SAW_RADIUS + a.r) continue;
    hitAsteroid(world, a);
    world.events.push({ type: 'sawHit', x: blade.x, y: blade.y, ship: ship.id });
  }
  return true;
}
