// @name Sniper
// @color #5cc8ff
// Careful: shoots from range, sends trackers to keep enemies busy (they have to stop and
// shoot them down), dashes away from anyone who gets too close, and runs for cover behind
// an asteroid when badly hurt.
const loadout = ['gun', 'tracker'];

// Tuning knobs. In testing vs Hunter, standing and shooting a charging enemy beat running
// from it, so by default Sniper only runs when hurt. Raise RUN_AT to make it kite.
const CFG = {
  RUN_AT: 0,        // start running when they get this close
  SHOOT_AT: 600,    // ...and turn back to shoot once this far, or once we're drifting away fast
  RUN_SPEED: 330,   // "drifting away fast"
};

function steerTo(me, x, y, speed) {
  const dx = x - me.x, dy = y - me.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = Math.min(speed, d * 1.5);
  const sx = (dx / d) * want - me.vx, sy = (dy / d) * want - me.vy;
  const ang = Math.atan2(sy, sx);
  const aligned = Math.abs(angleDiff(me.angle, ang)) < 0.5;
  return { turn: turnToward(me, ang), thrust: aligned ? Math.min(1, Math.hypot(sx, sy) / 80) : 0 };
}

// The spot on the far side of an asteroid, away from the enemy.
function hidingSpot(view, me, enemy) {
  let best = null, bestD = Infinity;
  for (const a of view.asteroids) {
    if (a.size === 0) continue; // too small to hide behind
    const dx = a.x - enemy.x, dy = a.y - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    const spot = { x: a.x + (dx / d) * (a.radius + 45), y: a.y + (dy / d) * (a.radius + 45) };
    const travel = distance(me, spot);
    if (travel < bestD) { bestD = travel; best = spot; }
  }
  return best;
}

// Will this bullet pass close to us in the next `horizon` seconds?
function bulletThreat(b, me, horizon) {
  const px = b.x - me.x, py = b.y - me.y, vx = b.vx - me.vx, vy = b.vy - me.vy;
  const t = -(px * vx + py * vy) / (vx * vx + vy * vy || 1);
  return t > 0 && t < horizon && Math.hypot(px + vx * t, py + vy * t) < 32;
}

function think(view, memory) {
  const me = view.self;
  const K = view.constants;
  const out = { thrust: 0, turn: 0, fire: false, tracker: false, shield: false, pigStat: 'hp', debug: [] };
  const hurt = me.hp < me.maxHp * 0.35;

  let target = null;
  for (const e of view.enemies) {
    if (!target || distance(me, e) < distance(me, target)) target = e;
  }
  if (target) memory.lastSeen = { x: target.x, y: target.y, tick: view.tick };

  if (target) {
    const d = distance(me, target);
    const away = angleTo(target, me);                       // direction straight away from them
    const awaySpeed = me.vx * Math.cos(away) + me.vy * Math.sin(away);
    const closing = ((target.vx - me.vx) * (me.x - target.x) + (target.vy - me.vy) * (me.y - target.y)) / d;
    const brawler = target.loadout.includes('shockwave');
    const danger = brawler ? K.SHOCKWAVE_RADIUS + 120 : 300;

    // Kiting. Ships only thrust forward, so: turn away and burn to build speed ("run"),
    // then flip around and shoot while coasting backward ("shoot"). Space has little
    // drag, so we keep drifting away while we aim.
    if (!memory.mode) memory.mode = 'shoot';
    if (memory.mode === 'shoot' && (d < CFG.RUN_AT || (hurt && d < 900)) && awaySpeed < 200) memory.mode = 'run';
    if (memory.mode === 'run' && (awaySpeed > CFG.RUN_SPEED || d > CFG.SHOOT_AT)) memory.mode = 'shoot';

    if (memory.mode === 'run') {
      // Hide behind a rock if we're hurt, otherwise just get away
      const spot = hurt ? hidingSpot(view, me, target) : null;
      const goal = spot || { x: me.x + Math.cos(away) * 500, y: me.y + Math.sin(away) * 500 };
      const s = steerTo(me, goal.x, goal.y, me.maxSpeed * 1.5);
      out.turn = s.turn;
      out.thrust = s.thrust > 0 ? 1 : 0;
      out.boost = s.thrust > 0 && d < CFG.RUN_AT && me.energy > 25;
      if (spot) out.debug.push({ type: 'circle', x: spot.x, y: spot.y, r: 20, color: '#5cc8ff' });
    } else {
      const aim = leadTarget(me, target, K.BULLET_SPEED) || target;
      const aimAngle = angleTo(me, aim);
      const err = Math.abs(angleDiff(me.angle, aimAngle));
      out.turn = turnToward(me, aimAngle);
      // Creep in if they're out of range
      if (d > K.BULLET_RANGE * 0.8 && err < 0.4) out.thrust = 0.6;
      // Don't waste shots into their shield, but a shield facing the other way is fair game
      const blocked = target.shieldOn && shieldSideFor(target, me) === target.shieldSide;
      out.fire = !blocked && err < 0.04 + 18 / d && lineOfSight(view, me, aim) &&
        d < K.BULLET_RANGE * 0.9 && me.energy > 15;
      out.debug.push({ type: 'line', x: me.x, y: me.y, x2: aim.x, y2: aim.y, color: '#5cc8ff' });
    }
    // Send a tracker after them from a safe distance: it keeps them busy (they have to
    // turn and shoot it twice) while we shoot them
    if (me.ammo.tracker > 0 && d > 450) out.tracker = true;

    // A shockwave bot closing in: shield toward it (blocks the damage and the spin);
    // if we can't, dash straight away
    const canShield = me.shieldOn || me.energy > K.SHIELD_MIN_ENERGY;
    if (brawler && d < K.SHOCKWAVE_RADIUS + 60 && canShield) out.shield = shieldSideFor(me, target) || false;
    else if (d < danger && me.dashCooldown === 0 && me.energy > K.DASH_COST) out.dash = away;
    out.debug.push({ type: 'text', x: me.x, y: me.y - 40, text: memory.mode, color: '#5cc8ff' });
  } else {
    memory.mode = 'shoot';
    let goal;
    if (view.pig) goal = view.pig;
    else if (memory.lastSeen && view.tick - memory.lastSeen.tick < 90) goal = memory.lastSeen;
    else {
      const ang = -view.tick / 500 + 1.5;
      goal = { x: view.pigZone.x + Math.cos(ang) * 1300, y: view.pigZone.y + Math.sin(ang) * 1300 };
    }
    const s = steerTo(me, goal.x, goal.y, me.maxSpeed * 0.8);
    out.turn = s.turn;
    out.thrust = s.thrust;
  }

  // Bullets about to hit: shield the side they come from, or dash sideways if we can't
  const threat = view.bullets.find((b) => !b.own && bulletThreat(b, me, 0.3));
  if (threat && !out.shield) {
    const side = shieldSideFor(me, threat);
    if (side && (me.shieldOn || me.energy > K.SHIELD_MIN_ENERGY + 15)) out.shield = side;
    else if (out.dash === undefined && me.dashCooldown === 0 && me.energy > K.DASH_COST) {
      const path = Math.atan2(threat.vy - me.vy, threat.vx - me.vx);
      const dx = me.x - threat.x, dy = me.y - threat.y;
      out.dash = Math.cos(path + Math.PI / 2) * dx + Math.sin(path + Math.PI / 2) * dy > 0 ? path + Math.PI / 2 : path - Math.PI / 2;
    }
  }
  if (out.shield) out.fire = false;

  // Don't fly into rocks
  const hx = Math.cos(me.angle), hy = Math.sin(me.angle);
  for (const a of view.asteroids) {
    const dx = a.x - me.x, dy = a.y - me.y;
    const ahead = dx * hx + dy * hy;
    const side = dx * -hy + dy * hx;
    if (ahead > 0 && ahead < 220 + a.radius && Math.abs(side) < a.radius + 30 && Math.hypot(me.vx, me.vy) > 60 && out.thrust > 0) {
      out.turn = side > 0 ? -1 : 1;
      out.thrust = 0;
      out.boost = false;
      break;
    }
  }
  return out;
}
