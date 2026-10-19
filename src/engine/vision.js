import { C } from './constants.js';
import { segmentHitsCircle } from './vec.js';

// A clear line of sight means no asteroid touches the straight line between the points.
export function hasLineOfSight(world, x1, y1, x2, y2) {
  for (const a of world.asteroids) {
    if (a.dead) continue;
    if (segmentHitsCircle(x1, y1, x2, y2, a.x, a.y, a.r)) return false;
  }
  return true;
}

const CONSTANTS = { ...C };
const r1 = (v) => Math.round(v * 10) / 10;

// The ONLY information a bot gets. Everything here is plain data (no references into
// the real world), so bots can't peek at or change hidden state.
export function getView(world, shipId) {
  const me = world.ships[shipId];
  const range = C.SENSOR_RANGE;
  const inRange = (x, y, extra = 0) => Math.hypot(x - me.x, y - me.y) <= range + extra;
  const canSee = (x, y) => hasLineOfSight(world, me.x, me.y, x, y);

  const enemies = [];
  for (const s of world.ships) {
    if (s.id === me.id || !s.alive) continue;
    if (!inRange(s.x, s.y, C.SHIP_RADIUS) || !canSee(s.x, s.y)) continue;
    enemies.push({
      id: s.id, name: s.name,
      x: r1(s.x), y: r1(s.y), vx: r1(s.vx), vy: r1(s.vy), angle: s.angle,
      hp: r1(s.hp), maxHp: s.maxHp, shieldOn: s.shieldOn, shieldSide: s.shieldSide,
      dashing: s.dashTicks > 0, spinning: s.spinTicks > 0, boosting: s.boosting,
      loadout: [...s.loadout],
      upgrades: { ...s.upgrades },
    });
  }

  const asteroids = [];
  for (const a of world.asteroids) {
    if (a.dead || !inRange(a.x, a.y, a.r)) continue;
    asteroids.push({
      id: a.id, x: r1(a.x), y: r1(a.y), vx: r1(a.vx), vy: r1(a.vy),
      radius: a.r, size: a.size, hitsLeft: a.hitsLeft,
    });
  }

  const bullets = [];
  for (const b of world.bullets) {
    if (b.dead || !inRange(b.x, b.y)) continue;
    const mine = b.owner === me.id;
    if (!mine && !canSee(b.x, b.y)) continue;
    bullets.push({ x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy), mine, own: mine, ticksLeft: b.life });
  }

  const bombs = [];
  for (const b of world.bombs) {
    if (b.dead) continue;
    const own = b.owner === me.id;
    if (!own) {
      // Enemy mines are stealthy (only seen up close); trackers show up like anything else
      const d = Math.hypot(b.x - me.x, b.y - me.y);
      const range = b.kind === 'mine' ? C.MINE_ENEMY_VISIBLE_RANGE : C.SENSOR_RANGE;
      if (d > range || !canSee(b.x, b.y)) continue;
    }
    const view = {
      kind: b.kind, own,
      x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy),
      armed: world.tick >= b.armAt, ticksUntilFuse: b.fuseAt - world.tick,
    };
    if (b.kind === 'tracker') {
      view.heading = b.heading;
      view.speed = r1(b.speed);
      view.chasingMe = b.target === me.id;
      view.hp = b.hp;
    }
    bombs.push(view);
  }

  const pig = world.pig;
  return {
    tick: world.tick,
    ticksLeft: world.maxTicks - world.tick,
    self: {
      id: me.id, name: me.name,
      x: r1(me.x), y: r1(me.y), vx: r1(me.vx), vy: r1(me.vy), angle: me.angle,
      hp: r1(me.hp), maxHp: me.maxHp,
      energy: r1(me.energy), maxEnergy: me.maxEnergy,
      maxSpeed: me.maxSpeed, thrustAccel: me.thrustAccel,
      loadout: [...me.loadout],
      ammo: { ...me.ammo },                   // charges left for mine/tracker/shockwave
      ammoRecharge: { ...me.ammoRecharge },   // ticks until the next charge
      weaponCooldown: { ...me.weaponCooldown },
      gunCooldown: me.gunCooldown,
      shieldOn: me.shieldOn, shieldSide: me.shieldSide,
      dashing: me.dashTicks > 0, dashCooldown: me.dashCooldown, spinning: me.spinTicks > 0, boosting: me.boosting,
      upgrades: { ...me.upgrades },
    },
    enemies,
    asteroids,
    bullets,
    bombs,
    pig: pig ? { x: r1(pig.x), y: r1(pig.y), vx: r1(pig.vx), vy: r1(pig.vy) } : null,
    pigRespawnIn: pig ? 0 : Math.max(0, world.pigRespawnAt - world.tick),
    pigZone: { x: C.ARENA_W / 2, y: C.ARENA_H / 2, radius: C.PIG_ZONE_RADIUS },
    arena: { width: C.ARENA_W, height: C.ARENA_H },
    shipsAlive: world.ships.filter((s) => s.alive).length,
    constants: CONSTANTS,
  };
}
