// @name Sniper
// @color #5cc8ff
// Careful: keeps its distance, only takes well-aimed shots, hides behind asteroids
// when hurt, and only goes for the pig (HP upgrade) when nobody is around.

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

function think(view, memory) {
  const me = view.self;
  const K = view.constants;
  const out = { thrust: 0, turn: 0, fire: false, bomb: false, shield: false, pigStat: 'hp', debug: [] };
  const hurt = me.hp < me.maxHp * 0.4;

  let target = null;
  for (const e of view.enemies) {
    if (!target || e.hp < target.hp) target = e; // pick on the weakest
  }

  // Shield (on the side the bullet comes from) if one is about to hit. Keep it up
  // once it's raised, since raising it again costs another chunk of energy.
  for (const b of view.bullets) {
    if (b.mine) continue;
    const px = b.x - me.x, py = b.y - me.y, vx = b.vx - me.vx, vy = b.vy - me.vy;
    const t = -(px * vx + py * vy) / (vx * vx + vy * vy || 1);
    if (t > 0 && t < 0.3 && Math.hypot(px + vx * t, py + vy * t) < 32) {
      if (me.shieldOn || me.energy > K.SHIELD_MIN_ENERGY) out.shield = shieldSideFor(me, b) || false;
    }
  }

  if (target) {
    const d = distance(me, target);
    const aim = leadTarget(me, target, K.BULLET_SPEED) || target;
    const aimAngle = angleTo(me, aim);
    out.turn = turnToward(me, aimAngle);

    if (hurt) {
      const spot = hidingSpot(view, me, target);
      if (spot) {
        const s = steerTo(me, spot.x, spot.y, me.maxSpeed);
        out.turn = s.turn;
        out.thrust = s.thrust;
        out.debug.push({ type: 'circle', x: spot.x, y: spot.y, r: 20, color: '#5cc8ff' });
      }
    } else {
      // Hold position at ~1000 px: back off or creep in by thrusting along our facing only when it helps
      const facingTarget = Math.abs(angleDiff(me.angle, angleTo(me, target))) < 0.4;
      if (d > 1150 && facingTarget) out.thrust = 0.6;
      // Leave a bomb behind if they charge us while we're backing away fast
      const awayX = (me.x - target.x) / d, awayY = (me.y - target.y) / d;
      const retreating = me.vx * awayX + me.vy * awayY > 200;
      if (retreating && d < 300 && me.bombs > 0) out.bomb = true;
    }

    const err = Math.abs(angleDiff(me.angle, aimAngle));
    // Don't waste shots into their shield, but a shield facing the other way is fair game
    const blocked = target.shieldOn && shieldSideFor(target, me) === target.shieldSide;
    out.fire = !out.shield && !blocked && err < 0.03 + 12 / d &&
      lineOfSight(view, me, aim) && d < K.BULLET_RANGE * 0.9 && me.energy > 20;
    // Someone right on top of us: saw them away, or dash backward out of reach
    if (d < 80 && err < 0.5) out.saw = true;
    else if (d < 250 && me.dashCooldown === 0 && me.energy > 40) out.dash = 'back';
    out.debug.push({ type: 'line', x: me.x, y: me.y, x2: aim.x, y2: aim.y, color: '#5cc8ff' });
    out.debug.push({ type: 'text', x: me.x, y: me.y - 40, text: hurt ? 'hiding' : 'sniping', color: '#5cc8ff' });
  } else {
    let goal;
    if (view.pig) goal = view.pig;
    else {
      const ang = -view.tick / 500 + 1.5;
      goal = { x: view.pigZone.x + Math.cos(ang) * 1300, y: view.pigZone.y + Math.sin(ang) * 1300 };
    }
    const s = steerTo(me, goal.x, goal.y, me.maxSpeed * 0.8);
    out.turn = s.turn;
    out.thrust = s.thrust;
  }

  // Don't fly into rocks
  const hx = Math.cos(me.angle), hy = Math.sin(me.angle);
  for (const a of view.asteroids) {
    const dx = a.x - me.x, dy = a.y - me.y;
    const ahead = dx * hx + dy * hy;
    const side = dx * -hy + dy * hx;
    if (ahead > 0 && ahead < 220 + a.radius && Math.abs(side) < a.radius + 30 && Math.hypot(me.vx, me.vy) > 60) {
      out.turn = side > 0 ? -1 : 1;
      out.thrust = 0;
      break;
    }
  }
  return out;
}
