import { C } from './constants.js';
import { clamp, wrapAngle } from './vec.js';

export function createShip(id, entry, x, y, angle) {
  return {
    id,
    name: entry.name || `Ship ${id + 1}`,
    color: entry.color || '#ffffff',
    x, y, vx: 0, vy: 0, angle,
    px: x, py: y, pa: angle, // previous tick, used for smooth drawing
    hp: C.SHIP_HP,
    maxHp: C.SHIP_HP,
    energy: C.SHIP_ENERGY,
    maxEnergy: C.SHIP_ENERGY,
    maxSpeed: C.MAX_SPEED,
    thrustAccel: C.THRUST_ACCEL,
    bombs: C.BOMBS,
    gunCooldown: 0,
    bombCooldown: 0,
    shieldOn: false,
    shieldSide: null,          // 'front' | 'back' while the shield is up
    sawOn: false,
    dashTicks: 0,              // > 0 while dashing
    dashCooldown: 0,
    alive: true,
    upgrades: { hp: 0, energy: 0, speed: 0 },
    lastCmd: null,
    lastHitBy: -1,
    lastHitTick: -1,
    diedAt: -1,
    killedBy: -1,
    stats: { damageDealt: 0, damageTaken: 0, kills: 0, shots: 0, hits: 0, pigs: 0, blocked: 0 },
  };
}

// Applies a sanitized command: turning, shield, thrust, energy. Firing and bombs are
// handled by the projectile/bomb modules.
export function controlShip(ship, cmd) {
  const dt = C.DT;
  ship.angle = wrapAngle(ship.angle + cmd.turn * C.TURN_RATE * dt);

  // Raising the shield costs a chunk of energy; keeping it up drains more. Flipping
  // between front and back while it's up is free.
  if (cmd.shield && ship.shieldOn && ship.energy > 0) {
    ship.shieldSide = cmd.shield;
  } else if (cmd.shield && !ship.shieldOn && ship.energy >= C.SHIELD_MIN_ENERGY) {
    ship.energy -= C.SHIELD_ACTIVATE_COST;
    ship.shieldOn = true;
    ship.shieldSide = cmd.shield;
  } else {
    ship.shieldOn = false;
    ship.shieldSide = null;
  }

  // No sawing from behind a shield
  ship.sawOn = cmd.saw && !ship.shieldOn && ship.energy > 0;

  const cos = Math.cos(ship.angle), sin = Math.sin(ship.angle);
  if (cmd.thrust > 0) {
    const a = ship.thrustAccel * cmd.thrust * dt;
    ship.vx += cos * a;
    ship.vy += sin * a;
  }

  // Dash: bring our forward speed up to DASH_SPEED (sideways drift is kept)
  if (ship.dashTicks > 0) ship.dashTicks--;
  if (ship.dashCooldown > 0) ship.dashCooldown--;
  if (cmd.dash && ship.dashCooldown <= 0 && ship.energy >= C.DASH_COST) {
    ship.energy -= C.DASH_COST;
    ship.dashTicks = C.DASH_TICKS;
    ship.dashCooldown = C.DASH_COOLDOWN_TICKS;
    const forward = ship.vx * cos + ship.vy * sin;
    if (forward < C.DASH_SPEED) {
      ship.vx += cos * (C.DASH_SPEED - forward);
      ship.vy += sin * (C.DASH_SPEED - forward);
    }
  }

  const drag = 1 - C.DRAG * dt;
  ship.vx *= drag;
  ship.vy *= drag;
  const speed = Math.hypot(ship.vx, ship.vy);
  const limit = ship.dashTicks > 0 ? Math.max(C.DASH_SPEED, ship.maxSpeed) : ship.maxSpeed;
  if (speed > limit) {
    // Right after a dash, ease back down to normal top speed instead of stopping dead
    const k = ship.dashTicks > 0 ? limit / speed : Math.max(limit / speed, 0.9);
    ship.vx *= k;
    ship.vy *= k;
  }

  if (ship.shieldOn) {
    ship.energy -= C.SHIELD_DRAIN * dt;
    if (ship.energy <= 0) {
      ship.energy = 0;
      ship.shieldOn = false;
      ship.shieldSide = null;
    }
  } else if (ship.sawOn) {
    ship.energy = Math.max(0, ship.energy - C.SAW_DRAIN * dt);
  } else {
    ship.energy = Math.min(ship.maxEnergy, ship.energy + C.ENERGY_REGEN * dt);
  }

  if (ship.gunCooldown > 0) ship.gunCooldown--;
  if (ship.bombCooldown > 0) ship.bombCooldown--;
}

// Is a hit coming from point (fx, fy) inside the ship's shield arc?
export function shieldCovers(ship, fx, fy) {
  if (!ship.shieldOn || fx == null) return false;
  const facing = ship.angle + (ship.shieldSide === 'back' ? Math.PI : 0);
  const d = wrapAngle(Math.atan2(fy - ship.y, fx - ship.x) - facing);
  return Math.abs(d) <= C.SHIELD_ARC / 2;
}

// (fx, fy) is where the hit comes from; the shield only blocks hits from its side.
// Returns the damage actually taken (0 if the shield blocked it).
export function damageShip(world, ship, amount, sourceId, cause, fx, fy) {
  if (!ship.alive || amount <= 0) return 0;
  if (shieldCovers(ship, fx, fy)) {
    ship.stats.blocked += amount;
    world.events.push({ type: 'shieldHit', x: ship.x, y: ship.y, ship: ship.id });
    return 0;
  }
  ship.hp -= amount;
  ship.stats.damageTaken += amount;
  if (sourceId >= 0 && sourceId !== ship.id) {
    ship.lastHitBy = sourceId;
    ship.lastHitTick = world.tick;
    world.ships[sourceId].stats.damageDealt += amount;
  }
  world.events.push({ type: 'damage', x: ship.x, y: ship.y, ship: ship.id, amount, cause });
  return amount;
}

export function applyPig(ship, stat) {
  if (stat === 'energy') {
    ship.maxEnergy += C.PIG_BONUS;
    ship.energy += C.PIG_BONUS;
  } else if (stat === 'speed') {
    ship.maxSpeed += C.MAX_SPEED * C.PIG_SPEED_BONUS;
    ship.thrustAccel += C.THRUST_ACCEL * C.PIG_SPEED_BONUS;
  } else {
    stat = 'hp';
    ship.maxHp += C.PIG_BONUS;
    ship.hp += C.PIG_BONUS;
  }
  ship.upgrades[stat]++;
  ship.stats.pigs++;
  return stat;
}

export function clampToArena(obj, r) {
  obj.x = clamp(obj.x, r, C.ARENA_W - r);
  obj.y = clamp(obj.y, r, C.ARENA_H - r);
}
