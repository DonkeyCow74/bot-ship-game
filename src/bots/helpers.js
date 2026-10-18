// Helper functions every bot can call directly (e.g. `angleTo(view.self, enemy)`).
// They're copied into each bot's sandbox, so every bot gets exactly the same toolkit.
// Each function must only use its arguments, Math, and the other helpers by name.

/** Angle (radians) from point a to point b. */
export function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Distance between two {x, y} points. */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Wraps an angle into -PI..PI. */
export function normalizeAngle(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Smallest signed turn from angle `from` to angle `to` (-PI..PI). Positive = turn right (clockwise on screen). */
export function angleDiff(from, to) {
  return normalizeAngle(to - from);
}

/** Clamp v into lo..hi. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A `turn` value (-1..1) that rotates `self` toward `targetAngle`, easing off as it lines up. */
export function turnToward(self, targetAngle) {
  return clamp(angleDiff(self.angle, targetAngle) * 4, -1, 1);
}

/**
 * Where to aim so a bullet hits a moving target. Accounts for bullets inheriting the
 * shooter's velocity. Returns {x, y, time} (time in seconds) or null if it can't be hit.
 * Aim with: turnToward(self, angleTo(self, aim)).
 */
export function leadTarget(shooter, target, bulletSpeed) {
  const rx = target.x - shooter.x, ry = target.y - shooter.y;
  const rvx = (target.vx || 0) - (shooter.vx || 0), rvy = (target.vy || 0) - (shooter.vy || 0);
  const a = rvx * rvx + rvy * rvy - bulletSpeed * bulletSpeed;
  const b = 2 * (rx * rvx + ry * rvy);
  const c = rx * rx + ry * ry;
  let t;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) return null;
  return { x: shooter.x + rx + rvx * t, y: shooter.y + ry + rvy * t, time: t };
}

/**
 * First asteroid (from view.asteroids) that the line from (x1,y1) to (x2,y2) hits, or null.
 * Returns {asteroid, distance}. Same test the game uses for line of sight.
 */
export function raycast(view, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let best = null, bestT = Infinity;
  for (const ast of view.asteroids) {
    let t = len2 > 0 ? ((ast.x - x1) * dx + (ast.y - y1) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = x1 + dx * t - ast.x, py = y1 + dy * t - ast.y;
    if (px * px + py * py <= ast.radius * ast.radius && t < bestT) { bestT = t; best = ast; }
  }
  return best ? { asteroid: best, distance: Math.sqrt(len2) * bestT } : null;
}

/** True if no visible asteroid blocks the straight line between points a and b. */
export function lineOfSight(view, a, b) {
  return raycast(view, a.x, a.y, b.x, b.y) === null;
}

/** Where `obj` (with x, y, vx, vy) will be after `seconds`, assuming it keeps drifting. */
export function predict(obj, seconds) {
  return { x: obj.x + (obj.vx || 0) * seconds, y: obj.y + (obj.vy || 0) * seconds };
}
