// @name Private Johnson
// @color #7dff6b
// Private Johnson v2
// Flies around the outline of the shape in the open middle of the map,
// stops, pauses, then fires straight up the middle at the tip. Then repeats.
// Turn on "Show bot debug drawings" to see the outline he's tracing.

const S = 1.3;            // overall size of the shape (fits inside the 700px pig zone)
const CRUISE = 130;       // px/s while tracing
const HIT_RADIUS = 55;    // how close counts as "reached" a waypoint
const SHOTS = 3;          // shots at the tip per cycle
const PAUSE_TICKS = 30;   // 1 second pause before shooting

function buildShape(ax, ay) {
  const path = [];
  const P = (x, y) => path.push({ x: ax + x * S, y: ay + y * S });
  const arc = (cx, cy, r, a0, a1) => {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 15));
    for (let i = 0; i <= n; i++) {
      const t = ((a0 + (a1 - a0) * i / n) * Math.PI) / 180;
      P(cx + r * Math.cos(t), cy + r * Math.sin(t));
    }
  };
  arc(90, 200, 80, 135, -112);    // right ball, then up the right side of the shaft
  arc(0, -230, 75, 37, -217);     // around the head (tip is the top of this arc)
  arc(-90, 200, 80, -68, -315);   // down the left side, around the left ball
  P(0, 285);                      // finish just below the base, lined up under the tip
  return { path, tip: { x: ax, y: ay + (-230 - 75) * S } };
}

// Steer toward a point at a given cruise speed, using only forward thrust.
// We aim the nose along (desired velocity - current velocity), so drift gets cancelled.
function steerTo(me, tx, ty, speed) {
  const dx = tx - me.x, dy = ty - me.y;
  const d = Math.hypot(dx, dy) || 1;
  const sx = (dx / d) * speed - me.vx;
  const sy = (dy / d) * speed - me.vy;
  const mag = Math.hypot(sx, sy);
  const a = mag < 6 ? Math.atan2(dy, dx) : Math.atan2(sy, sx);
  const err = Math.abs(angleDiff(me.angle, a));
  return {
    turn: turnToward(me, a),
    thrust: mag < 6 || err > 0.6 ? 0 : clamp(mag / 120, 0.15, 1),
  };
}

function think(view, memory) {
  const me = view.self;

  if (!memory.shape) {
    const z = view.pigZone;
    memory.shape = buildShape(z.x, z.y);
    memory.phase = 'trace';
    memory.i = 0;
    memory.shots = 0;
    memory.timer = 0;
  }
  const { path, tip } = memory.shape;

  // Debug: the outline, the tip, and a name tag
  const debug = [];
  for (let k = 0; k < path.length; k++) {
    const a = path[k], b = path[(k + 1) % path.length];
    debug.push({ type: 'line', x: a.x, y: a.y, x2: b.x, y2: b.y, color: '#ff9ec7' });
  }
  debug.push({ type: 'circle', x: tip.x, y: tip.y, r: 12, color: '#f33' });
  debug.push({ type: 'text', x: me.x, y: me.y - 45, text: 'Pvt. Johnson', color: '#fff' });

  let out = { thrust: 0, turn: 0, fire: false };
  const speed = Math.hypot(me.vx, me.vy);

  if (memory.phase === 'trace') {
    const wp = path[memory.i];
    if (distance(me, wp) < HIT_RADIUS) {
      memory.i++;
      if (memory.i >= path.length) { memory.phase = 'settle'; memory.i = 0; }
    }
    const target = path[Math.min(memory.i, path.length - 1)];
    out = steerTo(me, target.x, target.y, CRUISE);

  } else if (memory.phase === 'settle') {
    // come to a stop at the last point (slow down as we get close)
    const last = path[path.length - 1];
    const d = distance(me, last);
    out = steerTo(me, last.x, last.y, Math.min(CRUISE, d * 1.5));
    if (d < 40 && speed < 25) { memory.phase = 'pause'; memory.timer = 0; }

  } else if (memory.phase === 'pause' || memory.phase === 'aim') {
    // Bullets inherit our velocity, so nudge the aim point to cancel any drift
    const t = distance(me, tip) / ((view.constants && view.constants.BULLET_SPEED) || 720);
    const aimPt = { x: tip.x - me.vx * t, y: tip.y - me.vy * t };
    const a = angleTo(me, aimPt);
    out.turn = turnToward(me, a);

    // Red line from the ship to the tip so you can see exactly what he's aiming at
    debug.push({ type: 'line', x: me.x, y: me.y, x2: tip.x, y2: tip.y, color: '#f33' });
    debug.push({ type: 'text', x: tip.x + 40, y: tip.y, text: memory.phase === 'aim' ? 'FIRE' : 'lock', color: '#f33' });

    // Only ever shoot from below the base, roughly centered, so the shot goes UP at the tip
    const belowTip = me.y > tip.y + 300 && Math.abs(me.x - tip.x) < 120;
    if (!belowTip) {
      memory.phase = 'settle';
    } else if (memory.phase === 'pause') {
      if (++memory.timer >= PAUSE_TICKS) { memory.phase = 'aim'; memory.shots = 0; }
    } else {
      const aligned = Math.abs(angleDiff(me.angle, a)) < 0.03 && Math.sin(me.angle) < -0.9; // pointing up
      if (aligned && me.gunCooldown === 0 && me.energy >= 10 && !me.shieldOn) {
        out.fire = true;
        memory.shots++;
      }
      if (memory.shots >= SHOTS) { memory.phase = 'rest'; memory.timer = 0; }
    }

  } else if (memory.phase === 'rest') {
    // brief breather, then do it all again
    if (++memory.timer >= 60) { memory.phase = 'trace'; memory.i = 0; }
  }

  return { thrust: out.thrust, turn: out.turn, fire: out.fire, pigStat: 'speed', debug };
}