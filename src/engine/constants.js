// Every tunable number in the game lives here. Bots receive a copy as view.constants,
// so nobody has to hard-code (or guess) ship stats.
export const C = Object.freeze({
  TICK_RATE: 30,
  DT: 1 / 30,
  MATCH_SECONDS: 180,

  ARENA_W: 6000,
  ARENA_H: 6000,

  // Ship
  SHIP_RADIUS: 18,
  SHIP_HP: 100,
  SHIP_ENERGY: 100,
  ENERGY_REGEN: 14,          // per second (paused while the shield is up)
  THRUST_ACCEL: 320,         // px/s^2 at full thrust
  MAX_SPEED: 360,            // px/s
  TURN_RATE: 3.6,            // rad/s at full turn
  DRAG: 0.15,                // fraction of velocity lost per second
  SPAWN_RADIUS: 2300,        // ships start on a circle this far from the center

  // Gun (bullets inherit the ship's velocity)
  BULLET_SPEED: 720,
  BULLET_RANGE: 1400,
  BULLET_DAMAGE: 6,
  BULLET_COST: 10,           // energy per shot
  FIRE_COOLDOWN_TICKS: 8,
  BULLET_RADIUS: 3,

  // Weapons: each bot picks 2 of WEAPONS for its loadout. The gun runs on energy; the
  // others use charges: you start with AMMO_START and get one more every 15 s (up to AMMO_MAX).
  AMMO_START: 1,
  AMMO_MAX: 3,
  AMMO_RECHARGE_TICKS: 450,  // 15 seconds
  WEAPON_COOLDOWN_TICKS: 30, // 1 second between uses of the same charge weapon

  // Mine: dropped behind you, sits still and waits
  MINE_ARM_TICKS: 30,        // 1 second before it can trigger
  MINE_FUSE_TICKS: 600,      // explodes by itself after 20 seconds
  MINE_TRIGGER_RADIUS: 130,  // an enemy ship this close to an armed mine sets it off
  MINE_BLAST_RADIUS: 240,
  MINE_DAMAGE: 45,           // at the center, falls off to half at the edge
  MINE_DRAG: 1.5,
  MINE_ENEMY_VISIBLE_RANGE: 600, // enemy mines are stealthy: only seen this close
  BOMB_RADIUS: 10,           // size of mines and trackers (what bullets have to hit)

  // Tracker: dropped behind you; after 1 s it chases the nearest enemy, speeding up as it
  // goes but turning slowly, so it can be out-maneuvered. Shoot it to blow it up early.
  TRACKER_ARM_TICKS: 30,
  TRACKER_ACCEL: 160,        // px/s^2: starts slow, speeds up
  TRACKER_MAX_SPEED: 460,
  TRACKER_TURN_RATE: 1.6,    // rad/s (ships turn at 3.6)
  TRACKER_TRIGGER_RADIUS: 45,
  TRACKER_BLAST_RADIUS: 170,
  TRACKER_DAMAGE: 35,        // at the center, falls off to half at the edge
  TRACKER_FUSE_TICKS: 450,   // explodes by itself 15 s after being dropped

  // Shockwave: a blast all around you. Damages, knocks back and spins enemies near you.
  SHOCKWAVE_RADIUS: 220,     // reaches ships whose center is this close
  SHOCKWAVE_DAMAGE: 20,
  SHOCKWAVE_KNOCKBACK: 520,  // px/s added, straight away from you
  SHOCKWAVE_SPIN_TICKS: 24,  // 0.8 s of spinning out of control
  SHOCKWAVE_SPIN_RATE: 12,   // rad/s while spinning

  // Shield: a 120° arc on the front OR back of the ship. Blocks 100% of damage coming
  // from that side. No firing while it's up.
  SHIELD_ACTIVATE_COST: 20,  // energy paid up front every time you raise it
  SHIELD_MIN_ENERGY: 30,     // need this much to raise it (so it lasts at least a moment)
  SHIELD_DRAIN: 20,          // energy per second while it's up
  SHIELD_ARC: (Math.PI * 2) / 3,

  // Dash: a quick burst in any direction
  DASH_COST: 25,             // energy
  DASH_SPEED: 750,           // px/s in the dash direction for the burst
  DASH_TICKS: 9,             // how long the burst lasts (0.3 s)
  DASH_COOLDOWN_TICKS: 90,   // 3 seconds between dashes

  // Sensors
  SENSOR_RANGE: 1500,

  // Asteroids: index 0 = small, 1 = medium, 2 = large
  ASTEROID_RADII: [26, 50, 90],
  ASTEROID_HITS: 3,          // hits needed to break each stage
  ASTEROID_LARGE_COUNT: 22,
  ASTEROID_MEDIUM_COUNT: 12,
  ASTEROID_MIN_SPEED: 15,
  ASTEROID_MAX_SPEED: 55,

  // Ramming things (walls, asteroids, ships)
  COLLISION_DAMAGE_THRESHOLD: 120,// impact speed below this is free
  COLLISION_DAMAGE_FACTOR: 0.04,  // damage per px/s above the threshold

  // The pig
  PIG_ZONE_RADIUS: 700,      // open space around the center: no asteroids allowed
  PIG_RADIUS: 22,
  PIG_ORBIT_RADIUS: 140,
  PIG_ORBIT_SPEED: 0.35,     // rad/s
  PIG_FIRST_SPAWN_TICKS: 300, // the first pig shows up 10 seconds in
  PIG_RESPAWN_TICKS: 900,    // then a new one 30 seconds after each is eaten
  PIG_BONUS: 40,             // +40 max HP (and heals 40) or +40 max energy
  PIG_SPEED_BONUS: 0.4,      // +40% of base max speed and thrust
});

export const PIG_STATS = ['hp', 'energy', 'speed'];
export const WEAPONS = ['gun', 'mine', 'tracker', 'shockwave'];
export const CHARGE_WEAPONS = ['mine', 'tracker', 'shockwave'];
export const DEFAULT_LOADOUT = ['gun', 'mine'];

// Whatever a bot declares as `loadout`, returns 2 legal weapons (+ a warning if we had to fix it).
export function normalizeLoadout(list) {
  if (list === undefined || list === null) {
    return { loadout: DEFAULT_LOADOUT, warning: `No loadout declared, using ${DEFAULT_LOADOUT.join(' + ')}. Add e.g.: const loadout = ['gun', 'tracker'];` };
  }
  if (!Array.isArray(list)) return { loadout: DEFAULT_LOADOUT, warning: 'loadout must be an array like [\'gun\', \'mine\'].' };
  const picks = [...new Set(list.filter((w) => WEAPONS.includes(w)))];
  const bad = list.filter((w) => !WEAPONS.includes(w));
  let warning = null;
  if (bad.length) warning = `Unknown weapon(s) ${bad.join(', ')}. Choose from: ${WEAPONS.join(', ')}.`;
  if (!picks.length) return { loadout: DEFAULT_LOADOUT, warning: warning || 'Empty loadout, using the default.' };
  if (picks.length > 2) warning = `Only 2 weapons allowed; using ${picks.slice(0, 2).join(' + ')}.`;
  return { loadout: picks.slice(0, 2), warning };
}

// "+40 HP", "+40% SPEED"... for on-screen messages
export function pigBonusLabel(stat) {
  return stat === 'speed' ? `+${Math.round(C.PIG_SPEED_BONUS * 100)}% speed` : `+${C.PIG_BONUS} ${stat === 'hp' ? 'HP' : stat}`;
}
export const MATCH_TICKS = C.MATCH_SECONDS * C.TICK_RATE;
