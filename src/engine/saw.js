import { C } from './constants.js';
import { damageShip } from './ship.js';
import { hitAsteroid } from './asteroid.js';

// Where the spinning blade is (just past the ship's nose).
export function sawCenter(ship) {
  const d = C.SHIP_RADIUS + C.SAW_REACH;
  return { x: ship.x + Math.cos(ship.angle) * d, y: ship.y + Math.sin(ship.angle) * d };
}

// Spinning saws chew on any ship or asteroid touching the blade.
export function updateSaws(world) {
  for (const s of world.ships) {
    if (!s.alive || !s.sawOn) continue;
    const blade = sawCenter(s);
    for (const o of world.ships) {
      if (o === s || !o.alive) continue;
      if (Math.hypot(o.x - blade.x, o.y - blade.y) > C.SAW_RADIUS + C.SHIP_RADIUS) continue;
      damageShip(world, o, C.SAW_DPS * C.DT, s.id, 'saw', blade.x, blade.y);
      world.events.push({ type: 'sawHit', x: blade.x, y: blade.y, ship: s.id });
    }
    for (const a of world.asteroids) {
      if (a.dead) continue;
      if (Math.hypot(a.x - blade.x, a.y - blade.y) > C.SAW_RADIUS + a.r) continue;
      a.sawGrind = (a.sawGrind || 0) + C.DT;
      world.events.push({ type: 'sawHit', x: blade.x, y: blade.y, ship: s.id });
      if (a.sawGrind >= C.SAW_ASTEROID_SECONDS) {
        a.sawGrind = 0;
        hitAsteroid(world, a);
      }
    }
  }
}
