import { C } from './constants.js';
import { clamp } from './vec.js';

export function createAsteroid(world, size, x, y, vx, vy) {
  const a = {
    id: world.nextId++,
    size,
    r: C.ASTEROID_RADII[size],
    x, y, vx, vy,
    px: x, py: y,
    angle: world.rng.angle(),
    spin: world.rng.range(-0.6, 0.6),
    hitsLeft: C.ASTEROID_HITS,
    dead: false,
  };
  world.asteroids.push(a);
  return a;
}

export function randomAsteroidVelocity(rng) {
  const ang = rng.angle();
  const sp = rng.range(C.ASTEROID_MIN_SPEED, C.ASTEROID_MAX_SPEED);
  return [Math.cos(ang) * sp, Math.sin(ang) * sp];
}

// One bullet hit. Every 3 hits breaks the asteroid down a size.
export function hitAsteroid(world, a) {
  if (a.dead) return;
  a.hitsLeft--;
  world.events.push({ type: 'asteroidHit', x: a.x, y: a.y, r: a.r });
  if (a.hitsLeft <= 0) breakAsteroid(world, a);
}

export function breakAsteroid(world, a) {
  if (a.dead) return;
  a.dead = true;
  world.events.push({ type: 'asteroidBreak', x: a.x, y: a.y, r: a.r, size: a.size });
  if (a.size === 0) return;
  const child = a.size - 1;
  const cr = C.ASTEROID_RADII[child];
  const ang = world.rng.angle();
  const nx = Math.cos(ang), ny = Math.sin(ang);
  for (const sign of [1, -1]) {
    const kick = world.rng.range(25, 55) * sign;
    let x = a.x + nx * cr * sign;
    let y = a.y + ny * cr * sign;
    const speedCap = C.ASTEROID_MAX_SPEED * 1.6;
    let vx = a.vx + nx * kick, vy = a.vy + ny * kick;
    const sp = Math.hypot(vx, vy);
    if (sp > speedCap) { vx *= speedCap / sp; vy *= speedCap / sp; }
    const pos = keepOutOfPigZone(x, y, cr);
    x = clamp(pos[0], cr, C.ARENA_W - cr);
    y = clamp(pos[1], cr, C.ARENA_H - cr);
    createAsteroid(world, child, x, y, vx, vy);
  }
}

function keepOutOfPigZone(x, y, r) {
  const cx = C.ARENA_W / 2, cy = C.ARENA_H / 2;
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const min = C.PIG_ZONE_RADIUS + r + 1;
  if (d >= min) return [x, y];
  return [cx + (dx / d) * min, cy + (dy / d) * min];
}

export function moveAsteroids(world) {
  const dt = C.DT;
  const cx = C.ARENA_W / 2, cy = C.ARENA_H / 2;
  for (const a of world.asteroids) {
    a.px = a.x; a.py = a.y;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.angle += a.spin * dt;

    // Walls
    if (a.x < a.r) { a.x = a.r; a.vx = Math.abs(a.vx); }
    if (a.x > C.ARENA_W - a.r) { a.x = C.ARENA_W - a.r; a.vx = -Math.abs(a.vx); }
    if (a.y < a.r) { a.y = a.r; a.vy = Math.abs(a.vy); }
    if (a.y > C.ARENA_H - a.r) { a.y = C.ARENA_H - a.r; a.vy = -Math.abs(a.vy); }

    // The pig zone repels asteroids so the middle stays wide open
    const dx = a.x - cx, dy = a.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const min = C.PIG_ZONE_RADIUS + a.r;
    if (d < min) {
      const nx = dx / d, ny = dy / d;
      a.x = cx + nx * min;
      a.y = cy + ny * min;
      const vn = a.vx * nx + a.vy * ny;
      if (vn < 0) { a.vx -= 2 * vn * nx; a.vy -= 2 * vn * ny; }
    }
  }

  // Asteroids bounce off each other (mass ~ area)
  const list = world.asteroids;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, ny = dy / d;
      const ma = a.r * a.r, mb = b.r * b.r;
      const overlap = rr - d;
      a.x -= nx * overlap * (mb / (ma + mb));
      a.y -= ny * overlap * (mb / (ma + mb));
      b.x += nx * overlap * (ma / (ma + mb));
      b.y += ny * overlap * (ma / (ma + mb));
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const imp = (-2 * rv) / (ma + mb);
        a.vx -= imp * mb * nx; a.vy -= imp * mb * ny;
        b.vx += imp * ma * nx; b.vy += imp * ma * ny;
      }
    }
  }
}
