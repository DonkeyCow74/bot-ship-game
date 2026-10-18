import { C, MATCH_TICKS } from './constants.js';
import { createRng } from './rng.js';
import { createShip } from './ship.js';
import { createAsteroid, randomAsteroidVelocity } from './asteroid.js';

// entries: [{name, color}] — one per ship, in spawn-slot order.
export function createWorld(seed, entries) {
  const rng = createRng(seed);
  const world = {
    seed,
    tick: 0,
    maxTicks: MATCH_TICKS,
    rng,
    nextId: 1,
    ships: [],
    asteroids: [],
    bullets: [],
    bombs: [],
    pig: null,
    pigRespawnAt: -1,
    events: [],
    over: false,
    winner: null,   // ship id, or null for a draw
    endReason: '',
  };

  const cx = C.ARENA_W / 2, cy = C.ARENA_H / 2;
  const n = entries.length;
  const base = rng.angle();
  const spawns = [];
  for (let i = 0; i < n; i++) {
    const a = base + (i * Math.PI * 2) / n;
    const x = cx + Math.cos(a) * C.SPAWN_RADIUS;
    const y = cy + Math.sin(a) * C.SPAWN_RADIUS;
    spawns.push([x, y]);
    world.ships.push(createShip(i, entries[i], x, y, a + Math.PI)); // facing the center
  }

  const place = (size) => {
    const r = C.ASTEROID_RADII[size];
    for (let tries = 0; tries < 200; tries++) {
      const x = rng.range(r + 20, C.ARENA_W - r - 20);
      const y = rng.range(r + 20, C.ARENA_H - r - 20);
      if (Math.hypot(x - cx, y - cy) < C.PIG_ZONE_RADIUS + r + 60) continue;
      if (spawns.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < 350 + r)) continue;
      if (world.asteroids.some((o) => Math.hypot(x - o.x, y - o.y) < r + o.r + 30)) continue;
      const [vx, vy] = randomAsteroidVelocity(rng);
      createAsteroid(world, size, x, y, vx, vy);
      return;
    }
  };
  for (let i = 0; i < C.ASTEROID_LARGE_COUNT; i++) place(2);
  for (let i = 0; i < C.ASTEROID_MEDIUM_COUNT; i++) place(1);

  world.pigRespawnAt = C.PIG_FIRST_SPAWN_TICKS;
  world.events = [];
  return world;
}
