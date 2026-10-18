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

  // Bombs (dropped behind the ship)
  BOMBS: 3,
  BOMB_COOLDOWN_TICKS: 30,
  BOMB_ARM_TICKS: 30,        // 1 second before it can trigger
  BOMB_FUSE_TICKS: 600,      // explodes by itself after 20 seconds
  BOMB_TRIGGER_RADIUS: 130,  // an enemy ship this close to an armed bomb sets it off
  BOMB_BLAST_RADIUS: 240,
  BOMB_DAMAGE: 45,           // at the center, falls off to half at the edge
  BOMB_RADIUS: 10,
  BOMB_DRAG: 1.5,
  BOMB_ENEMY_VISIBLE_RANGE: 600, // enemy bombs are stealthy: only seen this close

  // Shield (blocks 100% of damage, no firing while it's up)
  SHIELD_DRAIN: 25,          // energy per second
  SHIELD_MIN_ENERGY: 10,     // needed to switch it on

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
  PIG_RESPAWN_TICKS: 1800,   // 60 seconds after it is eaten
  PIG_BONUS: 25,             // +25 max HP or +25 max energy
  PIG_SPEED_BONUS: 0.25,     // +25% of base max speed and thrust
});

export const PIG_STATS = ['hp', 'energy', 'speed'];
export const MATCH_TICKS = C.MATCH_SECONDS * C.TICK_RATE;
