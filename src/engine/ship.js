import { C, CHARGE_WEAPONS, normalizeLoadout } from './constants.js';
import { clamp, wrapAngle } from './vec.js';

export function createShip(id, entry, x, y, angle) {
  const { loadout } = normalizeLoadout(entry.loadout);
  const charges = loadout.filter((w) => CHARGE_WEAPONS.includes(w));
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
    loadout,                   // the 2 weapons this ship carries
    ammo: Object.fromEntries(charges.map((w) => [w, C.AMMO_START])),
    ammoRecharge: Object.fromEntries(charges.map((w) => [w, C.AMMO_RECHARGE_TICKS])),
    weaponCooldown: Object.fromEntries(charges.map((w) => [w, 0])),
    gunCooldown: 0,
    shieldOn: false,
    shieldSide: null,          // 'front' | 'back' while the shield is up
    spinTicks: 0,              // > 0 while spinning out from a shockwave
    boosting: false,
    spinDir: 1,
    dashTicks: 0,              // > 0 while dashing
    dashCooldown: 0,
    dashAngle: 0,              // direction of the last dash
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

// Applies a sanitized command: turning, shield, thrust, dash, energy, ammo. Weapons are
// handled by their own modules.
export function controlShip(ship, cmd) {
  const dt = C.DT;
  if (ship.spinTicks > 0) {
    // Knocked into a spin by a shockwave: steering doesn't work until it wears off
    ship.spinTicks--;
    ship.angle = wrapAngle(ship.angle + ship.spinDir * C.SHOCKWAVE_SPIN_RATE * dt);
  } else {
    ship.angle = wrapAngle(ship.angle + cmd.turn * C.TURN_RATE * dt);
  }

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

  const cos = Math.cos(ship.angle), sin = Math.sin(ship.angle);
  if (cmd.thrust > 0) {
    const a = ship.thrustAccel * cmd.thrust * dt;
    ship.vx += cos * a;
    ship.vy += sin * a;
  }
  ship.boosting = cmd.boost && ship.energy >= (ship.boosting ? 0.001 : C.BOOST_MIN_ENERGY);
  if (ship.boosting) {
    ship.vx += cos * C.BOOST_ACCEL * dt;
    ship.vy += sin * C.BOOST_ACCEL * dt;
  }

  // Dash: bring our speed in the dash direction up to DASH_SPEED (other drift is kept)
  if (ship.dashTicks > 0) ship.dashTicks--;
  if (ship.dashCooldown > 0) ship.dashCooldown--;
  if (cmd.dash !== false && ship.dashCooldown <= 0 && ship.energy >= C.DASH_COST) {
    const dir = dashAngle(ship, cmd.dash);
    const dx = Math.cos(dir), dy = Math.sin(dir);
    ship.energy -= C.DASH_COST;
    ship.dashTicks = C.DASH_TICKS;
    ship.dashCooldown = C.DASH_COOLDOWN_TICKS;
    ship.dashAngle = dir;
    const along = ship.vx * dx + ship.vy * dy;
    if (along < C.DASH_SPEED) {
      ship.vx += dx * (C.DASH_SPEED - along);
      ship.vy += dy * (C.DASH_SPEED - along);
    }
  }

  const drag = 1 - C.DRAG * dt;
  ship.vx *= drag;
  ship.vy *= drag;
  const speed = Math.hypot(ship.vx, ship.vy);
  const top = ship.boosting ? ship.maxSpeed * C.BOOST_SPEED_MULT : ship.maxSpeed;
  const limit = ship.dashTicks > 0 ? Math.max(C.DASH_SPEED, top) : top;
  if (speed > limit) {
    // After a dash or boost, ease back down to normal top speed instead of stopping dead
    const k = ship.dashTicks > 0 ? limit / speed : Math.max(limit / speed, 0.9);
    ship.vx *= k;
    ship.vy *= k;
  }

  // Shield and boost burn energy; otherwise it regenerates
  if (ship.shieldOn) ship.energy -= C.SHIELD_DRAIN * dt;
  if (ship.boosting) ship.energy -= C.BOOST_DRAIN * dt;
  if (ship.energy <= 0) {
    ship.energy = 0;
    ship.shieldOn = false;
    ship.shieldSide = null;
  }
  if (!ship.shieldOn && !ship.boosting) {
    ship.energy = Math.min(ship.maxEnergy, ship.energy + C.ENERGY_REGEN * dt);
  }

  if (ship.gunCooldown > 0) ship.gunCooldown--;
  for (const w in ship.ammo) {
    if (ship.weaponCooldown[w] > 0) ship.weaponCooldown[w]--;
    // A new charge every 15 s, while below the max
    if (ship.ammo[w] >= C.AMMO_MAX) {
      ship.ammoRecharge[w] = C.AMMO_RECHARGE_TICKS;
    } else if (--ship.ammoRecharge[w] <= 0) {
      ship.ammo[w]++;
      ship.ammoRecharge[w] = C.AMMO_RECHARGE_TICKS;
    }
  }
}

// Spends one charge of a charge weapon if it's in the loadout, loaded and off cooldown.
export function useCharge(ship, weapon) {
  if (!(weapon in ship.ammo) || ship.ammo[weapon] <= 0 || ship.weaponCooldown[weapon] > 0) return false;
  ship.ammo[weapon]--;
  ship.weaponCooldown[weapon] = C.WEAPON_COOLDOWN_TICKS;
  return true;
}

// 'forward' | 'back' | 'left' | 'right' are relative to the nose; a number is a map angle.
// (Left = counter-clockwise on screen, right = clockwise.)
export function dashAngle(ship, dash) {
  if (typeof dash === 'number') return dash;
  return ship.angle + ({ back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[dash] || 0);
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
