// @name Trapper
// @color #ff5c5c
// Camps the pig. Mines the middle (the pig circles it, so anyone going for the pig
// walks into the blast), then hangs back on the far side shooting. When an enemy is
// near a mine, it shoots the mine to set it off. Eats the pig itself when nobody's around.
// Mines blow up on their own after 20 s, so it keeps re-laying them while the pig matters.
const loadout = ['gun', 'mine'];

const CFG = {
  BLAST: 240,           // mine blast radius
  ARM_TIME: 1.0,        // mines arm after 1 s
  LAY_R: 330,           // drop anywhere this close to the middle (the pig's general area)
  SPACING: 250,         // keep mines this far apart so one blast doesn't chain the others
  MAX_MINES: 3,         // how many fresh mines we want around the pig
  FRESH_TICKS: 150,     // a mine with less fuse than this (5 s) is about to expire
  EVADE_R: 650,         // an enemy this close: run, don't fight
  EVADE_CLOSING_R: 950, // ...or this close and coming at us
  LAY_WINDOW: 450,      // start laying when the pig is out or due within 15 s
  STANDOFF: 750,        // wait this far from the middle, across from the enemy
  SAFE_PIG_DIST: 1100,  // eat the pig ourselves only if no enemy is closer than this
  FIRE_RESERVE: 20,
};

function think(view, memory) {
  const me = view.self;
  const K = view.constants;
  const center = { x: view.pigZone.x, y: view.pigZone.y };
  if (!memory.init) { memory.init = true; memory.spotAngle = 0; }
  const debug = [];

  const enemy = pickTarget(view, me);
  if (enemy) memory.last = { x: enemy.x, y: enemy.y, tick: view.tick };
  const known = memory.last && view.tick - memory.last.tick < 450 ? memory.last : null;
  const mineReady = (me.ammo.mine || 0) > 0 && (me.weaponCooldown.mine || 0) === 0;
  const pigMatters = view.pig || view.pigRespawnIn < CFG.LAY_WINDOW;

  const ownMines = view.bombs.filter((b) => b.own && b.kind === 'mine');
  const freshInZone = ownMines.filter((m) =>
    m.ticksUntilFuse > CFG.FRESH_TICKS && distance(m, center) < CFG.LAY_R + 60).length;
  const enemyAtPig = known && distance(known, center) < CFG.LAY_R + 500;
  const wantMine = pigMatters && mineReady && freshInZone < CFG.MAX_MINES;
  debug.push({ type: 'circle', x: center.x, y: center.y, r: CFG.LAY_R, color: '#9bdc5c' });

  let cmd, label;
  const danger = dangerousBomb(view, me);
  const tracker = view.bombs.find((b) => !b.own && b.kind === 'tracker' && b.chasingMe);
  const detonate = enemy ? mineShot(view, me) : null;
  const enemyDist = enemy ? distance(me, enemy) : Infinity;

  if (danger) {
    cmd = { turn: turnToward(me, safeHeading(view, me, angleTo(danger, me))), thrust: 1 };
    if (distance(me, danger) < CFG.BLAST) cmd.dash = angleTo(danger, me);
    label = 'mine!';
  } else if (detonate) {
    cmd = shootMine(view, me, detonate, debug);
    label = 'BOOM';
  } else if (tracker && distance(me, tracker) < 900) {
    cmd = shootTracker(view, me, tracker);
    label = 'tracker!';
  } else if (enemy && (enemyDist < CFG.EVADE_R ||
             (enemyDist < CFG.EVADE_CLOSING_R && closingSpeed(me, enemy) > 50))) {
    cmd = evade(view, me, enemy, ownMines, center, debug);
    label = 'evade';
  } else if (wantMine) {
    cmd = lay(view, me, center, ownMines, debug);
    label = 'laying';
  } else if (view.pig && enemyDist > CFG.SAFE_PIG_DIST && !(known && distance(known, center) < CFG.SAFE_PIG_DIST)) {
    const target = predict(view.pig, distance(me, view.pig) / Math.max(150, Math.hypot(me.vx, me.vy)));
    cmd = steerVelocity(me, safeHeading(view, me, angleTo(me, target)), me.maxSpeed);
    label = 'pig';
  } else if (enemy) {
    cmd = snipe(view, me, enemy);
    label = 'snipe';
  } else if (pigMatters) {
    cmd = holdStandoff(view, me, center, known, enemy);
    label = 'waiting';
  } else {
    cmd = patrol(view, me, memory, known);
    label = 'patrol';
  }

  // Leftover charge and someone tailgating us? Leave one behind
  if (enemy && !cmd.mine && mineReady && label !== 'laying') {
    const behind = Math.abs(angleDiff(me.angle, angleTo(me, enemy))) > 2.2;
    const t = closingSpeed(me, enemy) > 20 ? enemyDist / closingSpeed(me, enemy) : Infinity;
    if (behind && t > 0.8 && t < 3 && enemyDist < 900 &&
        !ownMines.some((m) => distance(m, me) < CFG.SPACING)) cmd.mine = true;
  }

  // Defence: shield bullets we can block, dash out of ones we can't
  const threat = incomingBullet(view, me);
  const side = threat ? shieldSideFor(me, threat) : null;
  cmd.shield = false;
  if (threat && side && (me.shieldOn || me.energy >= K.SHIELD_MIN_ENERGY)) {
    cmd.shield = side;
    cmd.fire = false;
  } else if (threat && !side && !cmd.dash && me.dashCooldown === 0 && me.energy >= K.DASH_COST + 10) {
    const path = Math.atan2(threat.vy - me.vy, threat.vx - me.vx);
    const a = path + Math.PI / 2;
    const dx = me.x - threat.x, dy = me.y - threat.y;
    cmd.dash = Math.cos(a) * dx + Math.sin(a) * dy > 0 ? a : a + Math.PI;
  }

  if (!known) memory.spotAngle += 0.002; // nobody seen: slowly rotate where the outer mines go
  debug.push({ type: 'text', x: me.x, y: me.y - 40, text: label, color: '#fff' });
  cmd.pigStat = 'hp'; // campers win on HP at the 3 minute mark
  cmd.debug = debug;
  return cmd;
}

// ---------------- behaviours ----------------

// Head for the emptiest part of the pig area at full speed, and drop a mine the moment
// we're inside it and far enough from our other mines
function lay(view, me, center, mines, debug) {
  let best = center, bestGap = -1;
  for (let i = 0; i <= 8; i++) {
    const p = i === 8 ? center : {
      x: center.x + Math.cos(i * Math.PI / 4) * 200, y: center.y + Math.sin(i * Math.PI / 4) * 200,
    };
    const gap = mines.reduce((g, m) => Math.min(g, distance(m, p)), 9999) - distance(me, p) * 0.2;
    if (gap > bestGap) { bestGap = gap; best = p; }
  }
  debug.push({ type: 'line', x: me.x, y: me.y, x2: best.x, y2: best.y, color: '#9bdc5c' });
  const cmd = steerVelocity(me, safeHeading(view, me, angleTo(me, best)), me.maxSpeed);
  const landing = { x: me.x + me.vx * 0.2, y: me.y + me.vy * 0.2 };
  if (distance(landing, center) < CFG.LAY_R && !mines.some((m) => distance(m, landing) < CFG.SPACING)) {
    cmd.mine = true;
  }
  return cmd;
}

// Wait across the middle from the enemy, facing the middle, ready to shoot
function holdStandoff(view, me, center, known, enemy) {
  const away = known ? angleTo(known, center) : angleTo(center, me);
  const spot = { x: center.x + Math.cos(away) * CFG.STANDOFF, y: center.y + Math.sin(away) * CFG.STANDOFF };
  if (distance(me, spot) > 150) return steerVelocity(me, safeHeading(view, me, angleTo(me, spot)), me.maxSpeed * 0.7);
  // In position: kill our drift, then face where they'll come from
  if (Math.hypot(me.vx, me.vy) > 40) return steerVelocity(me, me.angle, 0);
  return { turn: turnToward(me, angleTo(me, enemy || center)), thrust: 0 };
}

// Someone's close: don't fight, run. If we have an armed mine on the far side from
// them, run past it so they follow us over it; otherwise just get away (bait mines drop
// behind us automatically). The shield covers our back while we run.
function evade(view, me, enemy, mines, center, debug) {
  const K = view.constants;
  const away = angleTo(enemy, me);
  let best = null, bestD = Infinity;
  for (const m of mines) {
    if (!m.armed) continue;
    const d = distance(me, m);
    const ahead = Math.abs(angleDiff(away, angleTo(me, m))) < Math.PI / 2; // not back toward them
    // Only lead them over it if they're far enough behind that we'll be clear of the blast
    if (ahead && d > 140 && d < bestD && distance(me, enemy) > 380) { best = m; bestD = d; }
  }
  let heading;
  if (best) {
    // Pass ~110 px beside the mine: it only goes off for enemies
    const a = angleTo(me, best) + Math.PI / 2;
    const pass = { x: best.x + Math.cos(a) * 110, y: best.y + Math.sin(a) * 110 };
    debug.push({ type: 'line', x: me.x, y: me.y, x2: pass.x, y2: pass.y, color: '#f80' });
    heading = angleTo(me, pass);
  } else {
    // No mine to use: run away, leaning toward the middle so we don't get pinned on a wall
    const toMid = angleTo(me, center);
    const lean = distance(me, center) > 1500 ? 0.6 : 0.25;
    heading = away + clamp(angleDiff(away, toMid), -1, 1) * lean;
  }
  heading = safeHeading(view, me, heading);
  const cmd = steerVelocity(me, heading, me.maxSpeed);
  const d = distance(me, enemy);
  if (d < 350 && me.dashCooldown === 0 && me.energy >= K.DASH_COST + 20) cmd.dash = heading;
  return cmd;
}

// Far enough away to be safe: take shots, but never close in
function snipe(view, me, enemy) {
  const K = view.constants;
  const lead = leadTarget(me, enemy, K.BULLET_SPEED) || enemy;
  const aimAngle = angleTo(me, lead);
  const off = Math.abs(angleDiff(me.angle, aimAngle));
  return { turn: turnToward(me, aimAngle), thrust: 0, fire: off < 0.06 && canFire(view, me, enemy, lead) };
}

function shootMine(view, me, shot, debug) {
  const aimAngle = angleTo(me, shot.aim);
  debug.push({ type: 'line', x: me.x, y: me.y, x2: shot.bomb.x, y2: shot.bomb.y, color: '#f0f' });
  return {
    turn: turnToward(me, aimAngle),
    thrust: 0,
    fire: Math.abs(angleDiff(me.angle, aimAngle)) < 0.03 && me.gunCooldown === 0,
  };
}

function shootTracker(view, me, t) {
  const d = distance(me, t);
  if (d < 300) {
    const away = angleTo(t, me);
    const cmd = { turn: turnToward(me, safeHeading(view, me, away)), thrust: 1 };
    if (d < 200 && me.dashCooldown === 0) cmd.dash = away + Math.PI / 2;
    return cmd;
  }
  const lead = leadTarget(me, t, view.constants.BULLET_SPEED) || t;
  const aimAngle = angleTo(me, lead);
  return {
    turn: turnToward(me, aimAngle),
    thrust: 0,
    fire: Math.abs(angleDiff(me.angle, aimAngle)) < 0.05 && lineOfSight(view, me, t),
  };
}

// Nothing to do at the pig: go find someone
function patrol(view, me, memory, known) {
  let goal = known;
  if (!goal) {
    const c = view.pigZone, R = 1700;
    if (memory.patrol === undefined) memory.patrol = Math.round(angleTo(c, me) / (Math.PI / 4));
    goal = { x: c.x + Math.cos(memory.patrol * Math.PI / 4) * R, y: c.y + Math.sin(memory.patrol * Math.PI / 4) * R };
    if (distance(me, goal) < 350) memory.patrol++;
  }
  return steerVelocity(me, safeHeading(view, me, angleTo(me, goal)), me.maxSpeed * 0.8);
}

// ---------------- helpers ----------------

// Point the nose at whatever correction gets our velocity to `speed` along `heading`.
// (Plain "turn toward it and thrust" spirals around the target because of leftover drift.)
function steerVelocity(me, heading, speed) {
  const ex = Math.cos(heading) * speed - me.vx, ey = Math.sin(heading) * speed - me.vy;
  const burn = Math.atan2(ey, ex);
  const aligned = Math.abs(angleDiff(me.angle, burn)) < 0.6;
  return { turn: turnToward(me, burn), thrust: aligned ? 1 : 0.2 };
}

function pickTarget(view, me) {
  let best = null, bestD = Infinity;
  for (const e of view.enemies) {
    const d = distance(me, e);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// Worth shooting? In range, clear line, not into a shield facing us,
// not through one of our own mines, gun ready, energy kept back
function canFire(view, me, enemy, lead) {
  const K = view.constants;
  if (me.gunCooldown > 0 || me.energy < CFG.FIRE_RESERVE) return false;
  if (lead.time && lead.time * K.BULLET_SPEED > K.BULLET_RANGE * 0.9) return false;
  if (!lineOfSight(view, me, enemy)) return false;
  if (enemy.shieldOn && enemy.shieldSide === shieldSideFor(enemy, me)) return false;
  for (const b of view.bombs) {
    if (b.own && distance(me, b) < CFG.BLAST + 40 && nearLine(me, lead, b, 25)) return false;
  }
  return true;
}

function nearLine(a, b, p, r) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) < r;
}

// One of our mines we could shoot right now to catch an enemy in the blast
function mineShot(view, me) {
  for (const b of view.bombs) {
    if (!b.own || b.kind !== 'mine') continue;
    const myDist = distance(me, b);
    if (myDist < CFG.BLAST + 60 || myDist > 1100) continue;
    if (!lineOfSight(view, me, b)) continue;
    const lead = leadTarget(me, b, view.constants.BULLET_SPEED);
    if (!lead) continue;
    const boom = predict(b, lead.time);
    for (const e of view.enemies) {
      if (distance(predict(e, lead.time), boom) < CFG.BLAST - 50) return { bomb: b, aim: lead };
    }
  }
  return null;
}

// How fast the enemy is coming toward us (px/s; negative = moving away)
function closingSpeed(me, enemy) {
  const rx = enemy.x - me.x, ry = enemy.y - me.y;
  const d = Math.hypot(rx, ry) || 1;
  return -(rx * (enemy.vx - me.vx) + ry * (enemy.vy - me.vy)) / d;
}

// Steer around asteroids and walls
function safeHeading(view, me, heading) {
  const speed = Math.hypot(me.vx, me.vy);
  const look = 150 + speed * 0.8;
  const hit = raycast(view, me.x, me.y,
    me.x + Math.cos(heading) * look, me.y + Math.sin(heading) * look);
  if (hit) {
    const toRock = angleTo(me, hit.asteroid);
    const side = angleDiff(toRock, heading) >= 0 ? 1 : -1;
    heading = toRock + side * Math.PI / 2;
  }
  const m = 300, f = predict(me, 0.8);
  const W = view.arena.width, H = view.arena.height;
  if (f.x < m || f.x > W - m || f.y < m || f.y > H - m) {
    heading = angleTo(me, { x: W / 2, y: H / 2 });
  }
  return heading;
}

// Mines that could go off on us: any enemy mine close by, or one of ours that's
// about to fuse out or has an enemy right next to it
function dangerousBomb(view, me) {
  for (const b of view.bombs) {
    if (b.kind !== 'mine') continue;
    const d = distance(me, b);
    if (!b.own && d < CFG.BLAST + 60) return b;
    if (b.own && d < CFG.BLAST + 40) {
      if (b.ticksUntilFuse < 45) return b;
      if (b.armed && view.enemies.some((e) => distance(e, b) < 250)) return b;
    }
  }
  return null;
}

// An enemy bullet that will pass within 30 px of us in the next 0.25 s
function incomingBullet(view, me) {
  for (const b of view.bullets) {
    if (b.own) continue;
    const rx = b.x - me.x, ry = b.y - me.y;
    const rvx = b.vx - me.vx, rvy = b.vy - me.vy;
    const v2 = rvx * rvx + rvy * rvy;
    if (!v2) continue;
    const t = -(rx * rvx + ry * rvy) / v2;
    if (t < 0 || t > 0.25) continue;
    const cx = rx + rvx * t, cy = ry + rvy * t;
    if (cx * cx + cy * cy < 30 * 30) return b;
  }
  return null;
}