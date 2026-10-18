// @name Viper
// @color #7dff6a
// Patient counter-puncher. Every tick it test-flies a few dozen one-second flight plans
// and picks the one that dodges the bullets already flying (and the shots the enemy would
// take with a straight-line lead), stays clear of shockwaves and rocks, and still lets it
// shoot back. It tracks the enemy's energy and charges, lays mines in a chaser's path,
// blocks shockwaves with its shield and eats HP pigs.
const loadout = ['gun', 'mine'];

const P = Object.assign({
  horizon: 40,        // ticks per test flight
  pVirtual: 1.0,      // how much we fear shots that haven't been fired yet
  shotValue: 5,       // HP-equivalent value of one of our shots that can't be shielded
  shieldedShot: 1,    // ...and of one they'll probably shield
  farBand: 900,       // keep at least this far while they still have energy to shoot
  nearBand: 450,      // closest we like to be otherwise
  swBand: 250,        // never closer than this while they have a shockwave charge
  bandWeight: 1.5,
  mineMin: 420, mineMax: 1000, mineTail: 0.8, mineClosing: 0,
  ownMineClear: 280,
  accelAim: true,
  pigValue: 25,
  brawlDist: 0, brawlSw: 230, brawlLo: 250,
});

// ---------------------------------------------------------------- enemy bookkeeping

function updateEnemyModels(view, memory) {
  const K = view.constants;
  const dt = K.DT;
  const models = memory.models;
  const fresh = Math.round((K.BULLET_RANGE / K.BULLET_SPEED) * K.TICK_RATE) - 1;
  for (const id in models) models[id].visible = false;
  for (const e of view.enemies) {
    let m = models[e.id];
    if (!m) {
      // Assume no charges were used before we first saw them
      const t = view.tick, R = K.AMMO_RECHARGE_TICKS;
      m = models[e.id] = {
        energy: 100, shieldWas: false, dashWas: false, lastShot: -99, ax: 0, ay: 0, vx: e.vx, vy: e.vy,
        sw: Math.min(K.AMMO_MAX, K.AMMO_START + Math.floor(t / R)), swTimer: R - (t % R),
      };
    }
    // Acceleration estimate (smoothed), ignoring sudden jolts like dashes and collisions
    if (m.seenTick === view.tick - 1) {
      const ax = (e.vx - m.vx) / dt, ay = (e.vy - m.vy) / dt;
      if (Math.hypot(ax, ay) < 900) { m.ax = m.ax * 0.6 + ax * 0.4; m.ay = m.ay * 0.6 + ay * 0.4; }
      else { m.ax = 0; m.ay = 0; }
    } else { m.ax = 0; m.ay = 0; }
    m.vx = e.vx; m.vy = e.vy;
    m.visible = true;
    m.seenTick = view.tick;
    m.maxE = 100 + 40 * e.upgrades.energy;
    if (e.shieldOn) m.energy -= K.SHIELD_DRAIN * dt + (m.shieldWas ? 0 : K.SHIELD_ACTIVATE_COST);
    else m.energy += K.ENERGY_REGEN * dt;
    if (e.dashing && !m.dashWas) m.energy -= K.DASH_COST;
    m.shieldWas = e.shieldOn; m.dashWas = e.dashing;
  }
  // Fresh enemy bullets: charge them to the nearest visible enemy
  for (const b of view.bullets) {
    if (b.own || b.ticksLeft !== fresh) continue;
    let best = null, bd = 90;
    for (const e of view.enemies) {
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { models[best.id].energy -= K.BULLET_COST; models[best.id].lastShot = view.tick; }
  }
  for (const id in models) {
    const m = models[id];
    if (!m.visible) m.energy += K.ENERGY_REGEN * dt;
    m.energy = clamp(m.energy, 0, m.maxE || 100);
    // Shockwave charges: same recharge rule the engine uses
    if (m.sw >= K.AMMO_MAX) m.swTimer = K.AMMO_RECHARGE_TICKS;
    else if (--m.swTimer <= 0) { m.sw++; m.swTimer = K.AMMO_RECHARGE_TICKS; }
  }
}

// ---------------------------------------------------------------- navigation helpers

// Closest two moving points get during one tick: r = relative position at the start of the
// tick, (rvx, rvy) = relative velocity.
function stepMinDist(rx, ry, rvx, rvy, dt) {
  const v2 = rvx * rvx + rvy * rvy;
  const s = v2 > 0 ? clamp(-(rx * rvx + ry * rvy) / v2, 0, dt) : 0;
  return Math.hypot(rx + rvx * s, ry + rvy * s);
}


// Earliest time (s) at which relative motion brings a point within radius R, or Infinity.
function hitTime(px, py, ux, uy, R) {
  const c = px * px + py * py - R * R;
  const b = 2 * (px * ux + py * uy);
  if (c <= 0) return b < 0 ? 0 : Infinity;
  const a = ux * ux + uy * uy;
  if (a < 1e-6 || b >= 0) return Infinity;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

function obstacleTime(view, me, vx, vy, enemy) {
  const K = view.constants;
  let t = Infinity;
  for (const a of view.asteroids) {
    const tt = hitTime(me.x - a.x, me.y - a.y, vx - a.vx, vy - a.vy, a.radius + K.SHIP_RADIUS + 22);
    if (tt < t) t = tt;
  }
  for (const b of view.bombs) {
    if (b.kind !== 'mine') continue;
    let R;
    if (!b.own) R = K.MINE_TRIGGER_RADIUS + K.SHIP_RADIUS + 25;
    else if (enemy && Math.hypot(enemy.x - b.x, enemy.y - b.y) < 700) R = P.ownMineClear;
    else continue;
    const tt = hitTime(me.x - b.x, me.y - b.y, vx, vy, R);
    if (tt < t) t = tt;
  }
  const m = 80;
  if (vx < 0) t = Math.min(t, (me.x - m) / -vx);
  if (vx > 0) t = Math.min(t, (view.arena.width - m - me.x) / vx);
  if (vy < 0) t = Math.min(t, (me.y - m) / -vy);
  if (vy > 0) t = Math.min(t, (view.arena.height - m - me.y) / vy);
  return Math.max(0, t);
}

// A safe velocity close to the one we want.
function safeVelocity(view, me, wx, wy, enemy) {
  const want = Math.hypot(wx, wy);
  const speed = Math.max(150, want);
  const base = Math.atan2(wy, wx);
  const H = 1.5;
  let best = null;
  for (let i = 0; i < 25; i++) {
    const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
    const th = base + off;
    const vx = Math.cos(th) * speed, vy = Math.sin(th) * speed;
    const t = obstacleTime(view, me, vx, vy, enemy);
    const cost = Math.abs(off) * 0.8 + (t < H ? (H - t) * 6 : 0);
    if (!best || cost < best.cost) best = { vx, vy, cost, off };
  }
  if (want < 150) {
    const k = want / speed;
    best.vx *= k; best.vy *= k;
  }
  return best;
}

function steerVel(me, vx, vy) {
  const dx = vx - me.vx, dy = vy - me.vy;
  const dv = Math.hypot(dx, dy);
  if (dv < 15) return { turn: 0, thrust: 0 };
  const ang = Math.atan2(dy, dx);
  const err = Math.abs(angleDiff(me.angle, ang));
  return { turn: turnToward(me, ang), thrust: err < 0.6 ? Math.min(1, dv / 60) : 0 };
}


// Would a mine dropped right now get shot (by a bullet already flying, or one they could
// fire at us soon) while we're still close to it?
function mineIsSafe(view, me, foe, m) {
  const K = view.constants;
  const back = K.SHIP_RADIUS + K.BOMB_RADIUS + 6;
  const mx0 = me.x - Math.cos(me.angle) * back, my0 = me.y - Math.sin(me.angle) * back;
  const N = 36, dt = K.DT, drag = 1 - K.MINE_DRAG * dt;
  const path = [];
  let mx = mx0, my = my0, mvx = me.vx * 0.3, mvy = me.vy * 0.3;
  path.push({ x: mx, y: my, vx: mvx, vy: mvy });
  for (let i = 0; i < N; i++) { mvx *= drag; mvy *= drag; mx += mvx * dt; my += mvy * dt; path.push({ x: mx, y: my, vx: mvx, vy: mvy }); }
  const R = K.BOMB_RADIUS + K.BULLET_RADIUS + 8;
  for (const b of view.bullets) {
    if (b.own) continue;
    for (let i = 0; i < Math.min(N, b.ticksLeft); i++) {
      const t = i * dt, p = path[i];
      if (stepMinDist(b.x + b.vx * t - p.x, b.y + b.vy * t - p.y, b.vx - p.vx, b.vy - p.vy, dt) < R) return false;
    }
  }
  if (!foe || !foe.loadout.includes('gun')) return true;
  const nextShot = Math.max(0, (m.lastShot + K.FIRE_COOLDOWN_TICKS) - view.tick);
  for (let k = nextShot; k < N; k += 2) {
    if (m.energy + K.ENERGY_REGEN * dt * k < K.BULLET_COST + 2) continue;
    const tk = k * dt;
    const sx = foe.x + foe.vx * tk, sy = foe.y + foe.vy * tk;
    const us = { x: me.x + me.vx * tk, y: me.y + me.vy * tk, vx: me.vx, vy: me.vy };
    const aim = leadTarget({ x: sx, y: sy, vx: foe.vx, vy: foe.vy }, us, K.BULLET_SPEED);
    if (!aim) continue;
    const ang = Math.atan2(aim.y - sy, aim.x - sx);
    if (Math.abs(angleDiff(foe.angle, ang)) > K.TURN_RATE * tk + 0.1) continue;
    const bvx = foe.vx + Math.cos(ang) * K.BULLET_SPEED, bvy = foe.vy + Math.sin(ang) * K.BULLET_SPEED;
    for (let i = k; i < N; i++) {
      const t = (i - k) * dt, p = path[i];
      if (stepMinDist(sx + bvx * t - p.x, sy + bvy * t - p.y, bvx - p.vx, bvy - p.vy, dt) < R + 6) return false;
    }
  }
  return true;
}


// Where to point the gun: like leadTarget, but assumes the target keeps accelerating the
// way it has been (with drag and its top speed), which matters for ships burning at us.
function aimPoint(me, e, m, K) {
  const maxV = K.MAX_SPEED * (1 + K.PIG_SPEED_BONUS * (e.upgrades ? e.upgrades.speed : 0));
  let ax = m ? m.ax : 0, ay = m ? m.ay : 0;
  const al = Math.hypot(ax, ay), cap = K.THRUST_ACCEL * 1.5;
  if (al > cap) { ax *= cap / al; ay *= cap / al; }
  let t = distance(me, e) / K.BULLET_SPEED;
  let px = e.x, py = e.y;
  for (let it = 0; it < 4; it++) {
    const n = Math.max(1, Math.round(t * 30));
    const h = t / n;
    let x = e.x, y = e.y, vx = e.vx, vy = e.vy;
    for (let i = 0; i < n; i++) {
      vx = (vx + ax * h) * (1 - K.DRAG * h); vy = (vy + ay * h) * (1 - K.DRAG * h);
      const sp = Math.hypot(vx, vy);
      if (sp > maxV) { vx *= maxV / sp; vy *= maxV / sp; }
      x += vx * h; y += vy * h;
    }
    px = x; py = y;
    const rx = px - me.x - me.vx * t, ry = py - me.y - me.vy * t;
    t = Math.hypot(rx, ry) / K.BULLET_SPEED;
  }
  return { x: px - me.vx * t, y: py - me.vy * t, time: t };
}

// ---------------------------------------------------------------- the planner

// Test-flies one plan. plan.heading: fly that way; plan.aim: keep the nose on the target
// (plan.thrust says whether to burn). Returns a cost (lower is better).
function scorePlan(ctx, plan) {
  const { view, me, K, foe, m, bullets } = ctx;
  const N = P.horizon, dt = K.DT;
  const drag = 1 - K.DRAG * dt;
  const HIT = K.SHIP_RADIUS + K.BULLET_RADIUS + 6;
  let x = me.x, y = me.y, vx = me.vx, vy = me.vy, a = me.angle;
  let energy = me.energy, gunCd = me.gunCooldown;
  let cost = 0, shots = 0;
  const traj = [];
  const dead = new Array(bullets.length).fill(false);
  let fe = m ? m.energy : 0; // their energy, for "can they shield / shoot"
  let rockHit = false;
  let gotPig = false;

  for (let i = 0; i < N; i++) {
    const t = (i + 1) * dt;
    // Where the enemy will be (straight-line guess)
    const fx = foe ? foe.x + foe.vx * t : 0, fy = foe ? foe.y + foe.vy * t : 0;
    let want = plan.heading;
    let lead = null;
    if (foe) {
      lead = leadTarget({ x, y, vx, vy }, { x: fx, y: fy, vx: foe.vx, vy: foe.vy }, K.BULLET_SPEED);
      if (plan.aim) want = lead ? Math.atan2(lead.y - y, lead.x - x) : Math.atan2(fy - y, fx - x);
    }
    let burn = 0;
    if (want !== null && want !== undefined) {
      a += clamp(angleDiff(a, want) * 4, -1, 1) * K.TURN_RATE * dt;
      if (Math.abs(angleDiff(a, want)) < 0.6) burn = plan.thrust;
    }
    if (burn > 0) {
      vx += Math.cos(a) * me.thrustAccel * burn * dt;
      vy += Math.sin(a) * me.thrustAccel * burn * dt;
    }
    vx *= drag; vy *= drag;
    const sp = Math.hypot(vx, vy);
    if (sp > me.maxSpeed) { const k = Math.max(me.maxSpeed / sp, 0.9); vx *= k; vy *= k; }
    const px0 = x, py0 = y;
    x += vx * dt; y += vy * dt;
    traj.push({ x, y, vx, vy, a, px: px0, py: py0 });

    // Bullets already flying
    for (let j = 0; j < bullets.length; j++) {
      const b = bullets[j];
      if (dead[j] || i >= b.ticksLeft) continue;
      if (stepMinDist(b.x + b.vx * i * dt - px0, b.y + b.vy * i * dt - py0, b.vx - vx, b.vy - vy, dt) < HIT) {
        dead[j] = true;
        cost += K.BULLET_DAMAGE * (1.15 - 0.3 * i / N);
      }
    }
    // Rocks and walls (checked every other tick)
    if (!rockHit && (i & 1)) {
      if (x < 50 || y < 50 || x > view.arena.width - 50 || y > view.arena.height - 50) rockHit = true;
      else {
        for (const r of view.asteroids) {
          if (Math.hypot(x - (r.x + r.vx * t), y - (r.y + r.vy * t)) < r.radius + K.SHIP_RADIUS + 10) { rockHit = true; break; }
        }
      }
      if (rockHit) cost += Math.max(0, sp - K.COLLISION_DAMAGE_THRESHOLD) * K.COLLISION_DAMAGE_FACTOR * 2 + 4 * (1.2 - i / N);
    }

    // Eating the pig on the way is worth a lot (and keeps it from them)
    if (ctx.pig && !gotPig) {
      const ph = ctx.pig.phase + K.PIG_ORBIT_SPEED * t;
      const gx = ctx.pig.cx + Math.cos(ph) * K.PIG_ORBIT_RADIUS, gy = ctx.pig.cy + Math.sin(ph) * K.PIG_ORBIT_RADIUS;
      if (Math.hypot(x - gx, y - gy) < K.SHIP_RADIUS + K.PIG_RADIUS - 4) { gotPig = true; cost -= P.pigValue * (1 - 0.3 * i / N); }
    }
    if (!foe) continue;
    const d = Math.hypot(fx - x, fy - y);
    for (const mb of ctx.mineBlasts) {
      if (mb.tick !== i) continue;
      const dm = Math.hypot(x - mb.x, y - mb.y) - K.SHIP_RADIUS - 20; // a little slack
      if (dm < K.MINE_BLAST_RADIUS) cost += K.MINE_DAMAGE * (1 - 0.5 * Math.max(0, dm) / K.MINE_BLAST_RADIUS);
    }
    fe = Math.min(m.maxE || 100, fe + K.ENERGY_REGEN * dt);
    // Distance preferences
    const lo = ctx.lo, hi = ctx.hi;
    if (d < lo) cost += ((lo - d) / 100) * P.bandWeight * dt * 3;
    else if (d > hi) cost += ((d - hi) / 300) * P.bandWeight * dt;
    if (ctx.swThreat && d < K.SHOCKWAVE_RADIUS * 0.85 + 30) cost += (energy >= K.SHIELD_MIN_ENERGY ? 0.3 : 2.5);
    // Our shots
    gunCd = Math.max(0, gunCd - 1);
    energy = Math.min(me.maxEnergy, energy + K.ENERGY_REGEN * dt);
    if (ctx.canShoot && lead && gunCd === 0 && energy >= K.BULLET_COST + ctx.reserve) {
      const err = Math.abs(angleDiff(a, Math.atan2(lead.y - y, lead.x - x)));
      if (err < 0.02 + 18 / d && d < K.BULLET_RANGE * 0.85) {
        const pHit = clamp(1.25 - d / 900, 0.25, 0.9);
        const shieldable = fe >= K.SHIELD_MIN_ENERGY;
        cost -= pHit * (shieldable ? P.shieldedShot : P.shotValue) * (1 - 0.4 * i / N);
        if (shieldable) fe -= K.SHIELD_ACTIVATE_COST;
        energy -= K.BULLET_COST;
        gunCd = K.FIRE_COOLDOWN_TICKS;
        shots++;
      }
    }
  }

  // Shots they would take at us with a straight-line lead, if they can
  if (foe && ctx.foeGun) {
    let he = m.energy;
    let nextShot = Math.max(0, (m.lastShot + K.FIRE_COOLDOWN_TICKS) - view.tick);
    for (let k = nextShot; k < N - 8; k += 7) {
      const hev = he + K.ENERGY_REGEN * dt * k;
      if (hev < K.BULLET_COST + 2) continue;
      const tk = k * dt;
      const sx = foe.x + foe.vx * tk, sy = foe.y + foe.vy * tk;
      const us = k === 0 ? me : traj[k - 1];
      const aim = leadTarget({ x: sx, y: sy, vx: foe.vx, vy: foe.vy }, us, K.BULLET_SPEED);
      if (!aim) continue;
      const ang = Math.atan2(aim.y - sy, aim.x - sx);
      // They can't fire if they can't turn their nose there in time
      if (Math.abs(angleDiff(foe.angle, ang)) > K.TURN_RATE * tk + 0.1) continue;
      he -= K.BULLET_COST;
      const bvx = foe.vx + Math.cos(ang) * K.BULLET_SPEED, bvy = foe.vy + Math.sin(ang) * K.BULLET_SPEED;
      for (let i = k; i < N; i++) {
        const p = traj[i];
        const t = (i - k) * dt;
        if (stepMinDist(sx + bvx * t - p.px, sy + bvy * t - p.py, bvx - p.vx, bvy - p.vy, dt) < HIT) {
          cost += K.BULLET_DAMAGE * P.pVirtual * (1 - 0.3 * k / N);
          break;
        }
      }
    }
  }

  const end = traj[N - 1];
  if (ctx.goal) cost += Math.hypot(end.vx - ctx.goal.vx, end.vy - ctx.goal.vy) / 300;
  return { cost, shots };
}


// When and where our own mines are about to go off (the enemy flying into one, or a
// bullet hitting it), so the planner can keep us out of the blast.
function predictMineBlasts(view, foe, bullets) {
  const K = view.constants;
  const out = [];
  const N = P.horizon;
  for (const b of view.bombs) {
    if (!b.own || b.kind !== 'mine') continue;
    let tick = -1;
    if (b.armed || b.ticksUntilFuse < N) {
      for (let i = 0; i < N; i++) {
        const t = (i + 1) * K.DT;
        const armed = b.armed || (K.MINE_FUSE_TICKS - b.ticksUntilFuse) + i + 1 >= K.MINE_ARM_TICKS;
        if (i + 1 >= b.ticksUntilFuse) { tick = i; break; }
        if (armed && foe && Math.hypot(foe.x + foe.vx * t - b.x, foe.y + foe.vy * t - b.y) <= K.MINE_TRIGGER_RADIUS + K.SHIP_RADIUS + 15) { tick = i; break; }
      }
    } else if (foe) {
      for (let i = 0; i < N; i++) {
        const t = (i + 1) * K.DT;
        if ((K.MINE_FUSE_TICKS - b.ticksUntilFuse) + i + 1 < K.MINE_ARM_TICKS) continue;
        if (Math.hypot(foe.x + foe.vx * t - b.x, foe.y + foe.vy * t - b.y) <= K.MINE_TRIGGER_RADIUS + K.SHIP_RADIUS + 15) { tick = i; break; }
      }
    }
    for (const bl of bullets) {
      for (let i = 0; i < Math.min(N, bl.ticksLeft); i++) {
        if (tick >= 0 && i >= tick) break;
        const t = i * K.DT;
        if (stepMinDist(bl.x + bl.vx * t - b.x, bl.y + bl.vy * t - b.y, bl.vx - b.vx, bl.vy - b.vy, K.DT) < K.BOMB_RADIUS + K.BULLET_RADIUS + 2) { tick = i; break; }
      }
    }
    if (tick >= 0) out.push({ x: b.x, y: b.y, tick });
  }
  return out;
}

function pigInfo(view) {
  if (!view.pig) return null;
  const cx = view.pigZone.x, cy = view.pigZone.y;
  return { cx, cy, phase: Math.atan2(view.pig.y - cy, view.pig.x - cx) };
}

function choosePlan(ctx) {
  const plans = [{ heading: null, thrust: 0 }];
  for (let i = 0; i < 16; i++) plans.push({ heading: (i / 16) * Math.PI * 2, thrust: 1 });
  if (ctx.foe) {
    plans.push({ aim: true, thrust: 0 });
    plans.push({ aim: true, thrust: 1 });
  }
  let best = null;
  for (const p of plans) {
    const s = scorePlan(ctx, p);
    if (!best || s.cost < best.cost) best = { plan: p, cost: s.cost, shots: s.shots };
  }
  return best;
}

// ---------------------------------------------------------------- main

function think(view, memory) {
  const me = view.self;
  const K = view.constants;
  const out = { thrust: 0, turn: 0, fire: false, mine: false, shield: false, dash: false, pigStat: 'hp', debug: [] };
  if (!memory.models) memory.models = {};
  updateEnemyModels(view, memory);

  // Did a shockwave just hit us? (spinning, or a sudden shove while shielded)
  const jolt = memory.lastV ? Math.hypot(me.vx - memory.lastV.vx, me.vy - memory.lastV.vy) : 0;
  if ((me.spinning && !memory.wasSpinning) || (jolt > 350 && !me.dashing)) {
    let best = null, bd = 300;
    for (const e of view.enemies) {
      const d = distance(me, e);
      if (d < bd && e.loadout.includes('shockwave')) { bd = d; best = e; }
    }
    if (best) memory.models[best.id].sw = Math.max(0, memory.models[best.id].sw - 1);
  }
  memory.wasSpinning = me.spinning;
  memory.lastV = { vx: me.vx, vy: me.vy };

  let target = null;
  for (const e of view.enemies) if (!target || distance(me, e) < distance(me, target)) target = e;
  if (target) memory.last = { x: target.x, y: target.y, vx: target.vx, vy: target.vy, tick: view.tick, id: target.id };

  const bullets = view.bullets.filter((b) => !b.own && lineOfSight(view, b, me));
  let label = 'roam';

  if (target) {
    const m = memory.models[target.id];
    const d = distance(me, target);
    const away = angleTo(target, me);
    const foeGun = target.loadout.includes('gun');
    const swThreat = target.loadout.includes('shockwave') && m.sw > 0;
    const aim = P.accelAim ? aimPoint(me, target, m, K) : leadTarget(me, target, K.BULLET_SPEED) || target;
    const aimAngle = angleTo(me, aim);
    const aimErr = Math.abs(angleDiff(me.angle, aimAngle));
    const clear = lineOfSight(view, me, aim);
    const blocked = target.shieldOn && shieldSideFor(target, me) === target.shieldSide;
    const loaded = foeGun && m.energy >= 35;
    const ctx = {
      view, me, K, foe: target, m, bullets, foeGun, swThreat,
      // Already close? Then running is hopeless: just don't get any closer than needed
      lo: d < P.brawlDist ? (swThreat ? P.brawlSw : P.brawlLo)
        : swThreat ? Math.max(P.swBand, loaded ? P.farBand : P.nearBand) : loaded ? P.farBand : P.nearBand,
      hi: loaded ? 1200 : 750,
      canShoot: clear && !blocked,
      pig: pigInfo(view),
      mineBlasts: predictMineBlasts(view, target, bullets),
      reserve: swThreat && d < 700 ? 20 : 0,
      goal: null,
    };
    const best = choosePlan(ctx);
    const plan = best.plan;
    if (plan.aim) {
      out.turn = turnToward(me, aimAngle);
      out.thrust = plan.thrust && aimErr < 0.6 ? plan.thrust : 0;
    } else if (plan.heading !== null) {
      out.turn = turnToward(me, plan.heading);
      out.thrust = Math.abs(angleDiff(me.angle, plan.heading)) < 0.6 ? 1 : 0;
    }
    label = plan.aim ? (plan.thrust ? 'aim+' : 'aim') : plan.heading === null ? 'coast' : 'fly';

    // Shoot whenever we're lined up and it's worth it
    const tol = 0.02 + 18 / d;
    const reserve = ctx.reserve;
    if (clear && !blocked && aimErr < tol && d < K.BULLET_RANGE * 0.85 &&
      (me.energy >= K.BULLET_COST + reserve || target.hp <= K.BULLET_DAMAGE)) out.fire = true;

    // Mines in a chaser's path, when they can't shoot it right under our tail
    const tail = Math.abs(angleDiff(me.angle + Math.PI, angleTo(me, target)));
    const closing = -((target.vx - me.vx) * (target.x - me.x) + (target.vy - me.vy) * (target.y - me.y)) / (d || 1);
    if (me.ammo.mine > 0 && tail < P.mineTail && d > P.mineMin && d < P.mineMax && closing > P.mineClosing && mineIsSafe(view, me, target, m)) out.mine = true;

    // Shockwave incoming: shield toward them right before they get in range
    if (swThreat) {
      const nx = target.x + target.vx * K.DT * 2 - me.x - me.vx * K.DT * 2;
      const ny = target.y + target.vy * K.DT * 2 - me.y - me.vy * K.DT * 2;
      if (Math.hypot(nx, ny) < K.SHOCKWAVE_RADIUS * 0.85 + 25) {
        const side = shieldSideFor(me, target);
        if (side && (me.shieldOn || me.energy >= K.SHIELD_MIN_ENERGY)) out.shield = side;
        else if (me.dashCooldown === 0 && me.energy >= K.DASH_COST) out.dash = away;
      }
    }
    out.debug.push({ type: 'text', x: me.x, y: me.y - 46, text: `${label} e~${m.energy.toFixed(0)} sw${m.sw} c${best.cost.toFixed(1)}`, color: '#7dff6a' });
  } else {
    let want;
    if (view.pig) {
      const lead = predict(view.pig, Math.min(1.5, distance(me, view.pig) / 400));
      const dx = lead.x - me.x, dy = lead.y - me.y, dd = Math.hypot(dx, dy) || 1;
      const sp = Math.min(me.maxSpeed, dd * 1.5);
      want = { vx: (dx / dd) * sp, vy: (dy / dd) * sp };
      label = 'pig';
    } else {
      const g = view.pigZone;
      const dx = g.x - me.x, dy = g.y - me.y, dd = Math.hypot(dx, dy) || 1;
      const sp = dd > 400 ? me.maxSpeed * 0.8 : dd * 0.5;
      want = { vx: (dx / dd) * sp, vy: (dy / dd) * sp };
    }
    const safe = safeVelocity(view, me, want.vx, want.vy, null);
    if (bullets.length) {
      const best = choosePlan({ view, me, K, foe: null, m: null, bullets, goal: safe });
      if (best.plan.heading !== null) {
        out.turn = turnToward(me, best.plan.heading);
        out.thrust = Math.abs(angleDiff(me.angle, best.plan.heading)) < 0.6 ? 1 : 0;
      }
    } else {
      const s = steerVel(me, safe.vx, safe.vy);
      out.turn = s.turn; out.thrust = s.thrust;
    }
    out.debug.push({ type: 'text', x: me.x, y: me.y - 46, text: label, color: '#7dff6a' });
  }

  // Trackers chasing us: shoot them
  const tracker = view.bombs.find((b) => b.kind === 'tracker' && !b.own && b.chasingMe && b.armed);
  if (tracker && distance(me, tracker) < 800) {
    const ta = angleTo(me, leadTarget(me, tracker, K.BULLET_SPEED) || tracker);
    out.turn = turnToward(me, ta);
    out.fire = Math.abs(angleDiff(me.angle, ta)) < 0.08;
  }
  if (out.shield) out.fire = false;
  return out;
}
