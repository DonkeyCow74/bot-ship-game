import { C } from './constants.js';
import { wrapAngle } from './vec.js';
import { damageShip, useCharge } from './ship.js';
import { breakAsteroid } from './asteroid.js';

// Mines and trackers share world.bombs. kind: 'mine' | 'tracker'
function dropBehind(world, ship, kind) {
  const back = C.SHIP_RADIUS + C.BOMB_RADIUS + 6;
  const x = ship.x - Math.cos(ship.angle) * back;
  const y = ship.y - Math.sin(ship.angle) * back;
  const isMine = kind === 'mine';
  const bomb = {
    id: world.nextId++,
    kind,
    owner: ship.id,
    x, y, px: x, py: y,
    vx: ship.vx * 0.3,
    vy: ship.vy * 0.3,
    armAt: world.tick + (isMine ? C.MINE_ARM_TICKS : C.TRACKER_ARM_TICKS),
    fuseAt: world.tick + (isMine ? C.MINE_FUSE_TICKS : C.TRACKER_FUSE_TICKS),
    dead: false,
  };
  if (!isMine) {
    bomb.heading = ship.angle + Math.PI; // starts pointing backward, then turns to chase
    bomb.speed = 0;
    bomb.target = -1;
    bomb.hp = C.TRACKER_HP;
  }
  world.bombs.push(bomb);
  world.events.push({ type: isMine ? 'bombDrop' : 'trackerDrop', x, y, ship: ship.id });
  return bomb;
}

export function tryDropMine(world, ship) {
  return useCharge(ship, 'mine') && dropBehind(world, ship, 'mine');
}

export function tryDropTracker(world, ship) {
  return useCharge(ship, 'tracker') && dropBehind(world, ship, 'tracker');
}

function nearestEnemy(world, bomb) {
  let best = null, bestD = Infinity;
  for (const s of world.ships) {
    if (!s.alive || s.id === bomb.owner) continue;
    const d = Math.hypot(s.x - bomb.x, s.y - bomb.y);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

// Picks the nearest enemy once armed (and again if that one dies), turns toward it at a
// limited rate, and keeps speeding up.
function steerTracker(world, b) {
  const dt = C.DT;
  let target = world.ships[b.target];
  if (!target || !target.alive) {
    target = nearestEnemy(world, b);
    b.target = target ? target.id : -1;
  }
  if (target) {
    const want = Math.atan2(target.y - b.y, target.x - b.x);
    const diff = wrapAngle(want - b.heading);
    const maxTurn = C.TRACKER_TURN_RATE * dt;
    b.heading = wrapAngle(b.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }
  b.speed = Math.min(C.TRACKER_MAX_SPEED, b.speed + C.TRACKER_ACCEL * dt);
  b.vx = Math.cos(b.heading) * b.speed;
  b.vy = Math.sin(b.heading) * b.speed;
}

export function updateBombs(world) {
  const dt = C.DT;
  const drag = 1 - C.MINE_DRAG * dt;
  for (const b of world.bombs) {
    if (b.dead) continue;
    b.px = b.x; b.py = b.y;
    const armed = world.tick >= b.armAt;
    if (b.kind === 'tracker' && armed) {
      steerTracker(world, b);
    } else {
      b.vx *= drag; b.vy *= drag;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (world.tick >= b.fuseAt) { detonateBomb(world, b); continue; }

    if (b.kind === 'tracker') {
      // Trackers blow up when they hit a wall or an asteroid
      if (b.x < 0 || b.y < 0 || b.x > C.ARENA_W || b.y > C.ARENA_H ||
        world.asteroids.some((a) => !a.dead && Math.hypot(a.x - b.x, a.y - b.y) <= a.r + C.BOMB_RADIUS)) {
        detonateBomb(world, b);
        continue;
      }
    }
    if (!armed) continue;
    const reach = b.kind === 'mine' ? C.MINE_TRIGGER_RADIUS : C.TRACKER_TRIGGER_RADIUS;
    for (const s of world.ships) {
      if (!s.alive || s.id === b.owner) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) <= reach + C.SHIP_RADIUS) {
        detonateBomb(world, b);
        break;
      }
    }
  }
}

// A bullet hit: trackers take TRACKER_HP hits, mines go off on the first.
export function shootBomb(world, bomb) {
  if (bomb.kind === 'tracker' && --bomb.hp > 0) {
    world.events.push({ type: 'trackerHit', x: bomb.x, y: bomb.y });
    return;
  }
  detonateBomb(world, bomb);
}

// Blasts everything nearby, including the bomb's owner. Chains into other bombs.
export function detonateBomb(world, bomb) {
  if (bomb.dead) return;
  bomb.dead = true;
  const mine = bomb.kind === 'mine';
  const R = mine ? C.MINE_BLAST_RADIUS : C.TRACKER_BLAST_RADIUS;
  const damage = mine ? C.MINE_DAMAGE : C.TRACKER_DAMAGE;
  world.events.push({ type: 'explosion', x: bomb.x, y: bomb.y, r: R, owner: bomb.owner, kind: bomb.kind });
  for (const s of world.ships) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - bomb.x, s.y - bomb.y) - C.SHIP_RADIUS;
    if (d > R) continue;
    const falloff = 1 - 0.5 * Math.max(0, d) / R;
    damageShip(world, s, damage * falloff, bomb.owner, bomb.kind, bomb.x, bomb.y);
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
