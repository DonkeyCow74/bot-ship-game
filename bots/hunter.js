// @name Hunter
// @color #ff5c5c
// Aggressive: grabs speed pigs, chases the closest enemy, leads its shots,
// shields against incoming bullets and drops bombs on anyone tailing it.

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
  const out = { thrust: 0, turn: 0, fire: false, bomb: false, shield: false, pigStat: 'speed', debug: [] };

  let target = null;
  for (const e of view.enemies) {
    if (!target || distance(me, e) < distance(me, target)) target = e;
  }
  if (target) memory.lastSeen = { x: target.x, y: target.y, tick: view.tick };

  const danger = view.bullets.some((b) => !b.mine && bulletThreat(b, me, 0.35));
  if (danger && me.energy > 25) out.shield = true;

  if (target) {
    const d = distance(me, target);
    const aim = leadTarget(me, target, K.BULLET_SPEED) || target;
    const aimAngle = angleTo(me, aim);
    const err = Math.abs(angleDiff(me.angle, aimAngle));
    out.turn = turnToward(me, aimAngle);
    out.thrust = err < 0.6 ? (d > 600 ? 1 : d > 350 ? 0.4 : 0) : 0;
    const clear = lineOfSight(view, me, aim);
    const tolerance = 0.05 + 25 / d;
    out.fire = !out.shield && clear && err < tolerance && d < K.BULLET_RANGE * 0.85 &&
      me.energy > (target.shieldOn ? 70 : 12);

    // Bomb anyone tailing us, but only while we're fast enough to escape our own blast
    const behind = Math.abs(angleDiff(me.angle + Math.PI, angleTo(me, target))) < 0.7;
    const fleeing = Math.hypot(me.vx, me.vy) > 220;
    if (behind && fleeing && d < 320 && me.bombs > 0) out.bomb = true;

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
    const s = steerTo(me, goal.x, goal.y, view.pig ? me.maxSpeed : me.maxSpeed * 0.7);
    out.turn = s.turn;
    out.thrust = s.thrust;
    out.debug.push({ type: 'line', x: me.x, y: me.y, x2: goal.x, y2: goal.y, color: '#888' });
  }

  const avoid = avoidAsteroids(view, me);
  if (avoid && !(target && distance(me, target) < 450)) {
    out.turn = avoid.turn;
    if (avoid.brake) out.thrust = 0;
    out.debug.push({ type: 'text', x: me.x, y: me.y - 40, text: 'dodging rock', color: '#fc6' });
  }
  return out;
}
