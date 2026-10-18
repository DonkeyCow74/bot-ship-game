import { C } from './constants.js';
import { applyPig } from './ship.js';

const CX = C.ARENA_W / 2, CY = C.ARENA_H / 2;

export function spawnPig(world) {
  const phase = world.rng.angle();
  world.pig = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, phase };
  placePig(world.pig);
  world.pig.px = world.pig.x;
  world.pig.py = world.pig.y;
  world.pigRespawnAt = -1;
  world.events.push({ type: 'pigSpawn', x: world.pig.x, y: world.pig.y });
}

function placePig(pig) {
  pig.x = CX + Math.cos(pig.phase) * C.PIG_ORBIT_RADIUS;
  pig.y = CY + Math.sin(pig.phase) * C.PIG_ORBIT_RADIUS;
  const sp = C.PIG_ORBIT_SPEED * C.PIG_ORBIT_RADIUS;
  pig.vx = -Math.sin(pig.phase) * sp;
  pig.vy = Math.cos(pig.phase) * sp;
}

// Moves the pig, lets ships eat it, and handles the respawn timer.
// cmds[i].pigStat says which upgrade ship i wants.
export function updatePig(world, cmds) {
  const pig = world.pig;
  if (!pig) {
    if (world.pigRespawnAt >= 0 && world.tick >= world.pigRespawnAt) spawnPig(world);
    return;
  }
  pig.px = pig.x; pig.py = pig.y;
  pig.phase += C.PIG_ORBIT_SPEED * C.DT;
  placePig(pig);

  // Closest ship touching the pig gets it (ties go to the lower id)
  let best = null, bestD = Infinity;
  for (const s of world.ships) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - pig.x, s.y - pig.y);
    if (d <= C.SHIP_RADIUS + C.PIG_RADIUS && d < bestD) { best = s; bestD = d; }
  }
  if (!best) return;
  const stat = applyPig(best, cmds[best.id]?.pigStat);
  world.events.push({ type: 'pigEaten', x: pig.x, y: pig.y, ship: best.id, stat });
  world.pig = null;
  world.pigRespawnAt = world.tick + C.PIG_RESPAWN_TICKS;
}
