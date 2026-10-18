import { C } from './constants.js';
import { damageShip } from './ship.js';

const BOUNCE = 0.5;

function impactDamage(speed) {
  return Math.max(0, speed - C.COLLISION_DAMAGE_THRESHOLD) * C.COLLISION_DAMAGE_FACTOR;
}

export function moveShips(world) {
  const dt = C.DT;
  for (const s of world.ships) {
    if (!s.alive) continue;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
}

export function collideShips(world) {
  const R = C.SHIP_RADIUS;
  for (const s of world.ships) {
    if (!s.alive) continue;

    // Walls
    let impact = 0, wx = s.x, wy = s.y; // (wx, wy) = point on the wall we hit
    if (s.x < R) { impact = Math.max(impact, -s.vx); s.x = R; s.vx = Math.abs(s.vx) * BOUNCE; wx = 0; }
    if (s.x > C.ARENA_W - R) { impact = Math.max(impact, s.vx); s.x = C.ARENA_W - R; s.vx = -Math.abs(s.vx) * BOUNCE; wx = C.ARENA_W; }
    if (s.y < R) { impact = Math.max(impact, -s.vy); s.y = R; s.vy = Math.abs(s.vy) * BOUNCE; wy = 0; }
    if (s.y > C.ARENA_H - R) { impact = Math.max(impact, s.vy); s.y = C.ARENA_H - R; s.vy = -Math.abs(s.vy) * BOUNCE; wy = C.ARENA_H; }
    if (impact > 0) {
      const dmg = impactDamage(impact);
      if (dmg > 0) damageShip(world, s, dmg, -1, 'wall', wx, wy);
      world.events.push({ type: 'bump', x: s.x, y: s.y });
    }

    // Asteroids (they're heavy: only the ship bounces)
    for (const a of world.asteroids) {
      if (a.dead) continue;
      const dx = s.x - a.x, dy = s.y - a.y;
      const rr = R + a.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, ny = dy / d;
      s.x = a.x + nx * rr;
      s.y = a.y + ny * rr;
      const vn = (s.vx - a.vx) * nx + (s.vy - a.vy) * ny;
      if (vn < 0) {
        s.vx -= (1 + BOUNCE) * vn * nx;
        s.vy -= (1 + BOUNCE) * vn * ny;
        const dmg = impactDamage(-vn);
        if (dmg > 0) damageShip(world, s, dmg, -1, 'asteroid', a.x, a.y);
        world.events.push({ type: 'bump', x: s.x - nx * R, y: s.y - ny * R });
      }
    }
  }

  // Ship vs ship (equal mass). Both take damage, each credited to the other.
  const ships = world.ships;
  for (let i = 0; i < ships.length; i++) {
    const a = ships[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < ships.length; j++) {
      const b = ships[j];
      if (!b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = R * 2;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, ny = dy / d;
      const overlap = (rr - d) / 2;
      a.x -= nx * overlap; a.y -= ny * overlap;
      b.x += nx * overlap; b.y += ny * overlap;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn < 0) {
        const imp = ((1 + BOUNCE) * vn) / 2;
        a.vx += imp * nx; a.vy += imp * ny;
        b.vx -= imp * nx; b.vy -= imp * ny;
        const dmg = impactDamage(-vn);
        if (dmg > 0) {
          damageShip(world, a, dmg, b.id, 'ram', b.x, b.y);
          damageShip(world, b, dmg, a.id, 'ram', a.x, a.y);
        }
        world.events.push({ type: 'bump', x: a.x + nx * R, y: a.y + ny * R });
      }
    }
  }
}
