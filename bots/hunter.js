// @name Hunter
// @color #ff5c5c
// Aggressive: grabs speed pigs, chases the closest enemy, leads its shots, blasts anyone
// who gets close with a shockwave, shields against bullets and shoots down trackers.
const loadout = ['gun', 'shockwave'];

// Fly toward (x, y) at up to `speed`, accounting for drift (steer to fix our velocity).
function steerTo(me, x, y, speed) {
  const dx = x - me.x, dy = y - me.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = Math.min(speed, d * 1.5);
  const sx = (dx / d) * want - me.vx, sy = (dy / d) * want - me.vy;
  const ang = Math.atan2(sy, sx);
  const aligned = Math.abs(angleDiff(me.angle, ang)) < 0.5;
  return { turn: turnToward(me, ang), thrust: aligned ? Math.min(1, Math.hypot(sx, sy) / 80) : 0 };
}

// If an asteroid sits on our flight path, return which way to turn away.
function avoidAsteroids(view, me) {
  const speed = Math.hypot(me.vx, me.vy);
  const look = 200 + speed * 0.9;
  const hx = Math.cos(me.angle), hy = Math.sin(me.angle);
  let worst = null;
  for (const a of view.asteroids) {
    const dx = a.x - me.x, dy = a.y - me.y;
    const ahead = dx * hx + dy * hy;
    if (ahead < 0 || ahead > look + a.radius) continue;
    const side = dx * -hy + dy * hx;
    if (Math.abs(side) > a.radius + 35) continue;
    const urgency = 1 - ahead / (look + a.radius);
    if (!worst || urgency > worst.urgency) worst = { urgency, side };
  }
  if (!worst) return null;
  return { turn: worst.side > 0 ? -1 : 1, brake: worst.urgency > 0.55 };
}

// Will this bullet pass close to us in the next `horizon` seconds?
function bulletThreat(b, me, horizon) {
  const px = b.x - me.x, py = b.y - me.y;
  const vx = b.vx - me.vx, vy = b.vy - me.vy;
  const v2 = vx * vx + vy * vy;
  if (v2 === 0) return false;
  const t = -(px * vx + py * vy) / v2;
  if (t < 0 || t > horizon) return false;
  return Math.hypot(px + vx * t, py + vy * t) < 30;
}

function think(view, memory) {
  const me = view.self;
  const K = view.constants;
  const out = { thrust: 0, turn: 0, fire: false, shockwave: false, shield: false, pigStat: 'speed', debug: [] };

  let target = null;
  for (const e of view.enemies) {
    if (!target || distance(me, e) < distance(me, target)) target = e;
  }
  if (target) memory.lastSeen = { x: target.x, y: target.y, tick: view.tick };

  // Raising the shield costs a big chunk of energy, so only do it for a real threat
  const danger = view.bullets.find((b) => !b.mine && bulletThreat(b, me, 0.3));
  if (danger && me.energy > K.SHIELD_MIN_ENERGY) out.shield = shieldSideFor(me, danger) || false;
  // A shot from the side can't be shielded: dash sideways out of its path instead
  if (danger && !out.shield && me.dashCooldown === 0 && me.energy > K.DASH_COST) {
    const path = Math.atan2(danger.vy - me.vy, danger.vx - me.vx);
    const away = [path + Math.PI / 2, path - Math.PI / 2];
    // Pick the side we're already on, so we move further from the bullet's line
    const dx = me.x - danger.x, dy = me.y - danger.y;
    out.dash = Math.cos(away[0]) * dx + Math.sin(away[0]) * dy > 0 ? away[0] : away[1];
  }

  if (target) {
    const d = distance(me, target);
    const aim = leadTarget(me, target, K.BULLET_SPEED) || target;
    const aimAngle = angleTo(me, aim);
    const err = Math.abs(angleDiff(me.angle, aimAngle));
    out.turn = turnToward(me, aimAngle);
    out.thrust = err < 0.6 ? (d > 600 ? 1 : d > 350 ? 0.4 : 0) : 0;
    // Far away and lined up: burn some energy to close in faster
    if (err < 0.3 && d > 900 && me.energy > 60) out.boost = true;

    // Brawl: with a shockwave charge ready, close in and blast them when in range
    const facing = Math.abs(angleDiff(me.angle, angleTo(me, target))) < 0.5;
    if (me.ammo.shockwave > 0 && d < 450) {
      if (facing && d > K.SHOCKWAVE_RADIUS * 0.6) out.thrust = 0.7;
      if (d < K.SHOCKWAVE_RADIUS * 0.85) out.shockwave = true;
    }
    // Dash to close the gap on a far-off, lined-up target (from far enough away that we
    // slow down before reaching them: crashing at dash speed hurts us as much as them)
    if (facing && d > 700 && d < 1100 && me.dashCooldown === 0 && me.energy > 70) out.dash = 'forward';
    const clear = lineOfSight(view, me, aim);
    const tolerance = 0.05 + 25 / d;
    out.fire = !out.shield && clear && err < tolerance && d < K.BULLET_RANGE * 0.85 &&
      me.energy > (target.shieldOn ? 70 : 12);

    out.debug.push({ type: 'line', x: me.x, y: me.y, x2: aim.x, y2: aim.y, color: clear ? '#ff5c5c' : '#555' });
    out.debug.push({ type: 'circle', x: aim.x, y: aim.y, r: 12, color: '#ff5c5c' });
  } else {
    let goal;
    if (view.pig) goal = view.pig;
    else if (memory.lastSeen && view.tick - memory.lastSeen.tick < 150) goal = memory.lastSeen;
    else {
      // Patrol a big loop around the pig zone
      const ang = view.tick / 400;
      goal = { x: view.pigZone.x + Math.cos(ang) * 1600, y: view.pigZone.y + Math.sin(ang) * 1600 };
    }
    const s = steerTo(me, goal.x, goal.y, view.pig ? me.maxSpeed * 1.5 : me.maxSpeed * 0.7);
    out.turn = s.turn;
    out.thrust = s.thrust;
    // Race for the pig before anyone else gets it
    if (view.pig && s.thrust > 0.5 && me.energy > 50 && distance(me, view.pig) > 600) out.boost = true;
    out.debug.push({ type: 'line', x: me.x, y: me.y, x2: goal.x, y2: goal.y, color: '#888' });
  }

  // A tracker chasing us: turn and shoot it down before it gets close
  const tracker = view.bombs.find((b) => b.kind === 'tracker' && b.chasingMe);
  if (tracker && distance(me, tracker) < 700) {
    const aimAngle = angleTo(me, leadTarget(me, tracker, K.BULLET_SPEED) || tracker);
    out.turn = turnToward(me, aimAngle);
    out.fire = Math.abs(angleDiff(me.angle, aimAngle)) < 0.08 && !out.shield;
    out.debug.push({ type: 'text', x: me.x, y: me.y - 40, text: 'tracker!', color: '#ff5c5c' });
  }

  const avoid = avoidAsteroids(view, me);
  if (avoid && !(target && distance(me, target) < 450)) {
    out.turn = avoid.turn;
    if (avoid.brake) out.thrust = 0;
    out.debug.push({ type: 'text', x: me.x, y: me.y - 40, text: 'dodging rock', color: '#fc6' });
  }
  return out;
}
