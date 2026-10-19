// @name Dive Bomber V2
// @color #4dd6b4
// 1. DIVE:     streak in at full speed toward where the enemy is about to be
// 2. DROP:     lay a mine on their path as we fly past (it arms after 1 s)
// 3. EGRESS:   keep burning (dash if needed) so we're clear of our own 240 px blast
// 4. SNIPE:    hang back at long range and shoot with lead
// 5. DETONATE: if an enemy is near one of our mines, shoot the mine to set it off
// Re-dives whenever a mine charge is ready (1 at the start, +1 every 15 s).
const loadout = ['gun', 'mine'];

const CFG = {
  PASS_OFFSET: 110,     // fly this far to the side of the enemy's future spot
  DROP_RADIUS: 170,     // drop when we're this close to that spot
  ARM_TIME: 1.0,        // mines arm after 1 s
  BLAST: 240,           // mine blast radius
  EGRESS_TICKS: 40,     // keep running at least this long after a drop
  SNIPE_MIN: 550,       // closer than this and closing: dash backward
  SNIPE_MAX: 1050,      // farther than this: close in
  MIN_DIVE_GAP: 120,    // at least 4 s between dives
  MIN_HP_TO_DIVE: 35,   // too hurt to dive? just snipe
  FIRE_RESERVE: 20,     // stop shooting below this much energy
  ENDGAME_TICKS: 600,   // last 20 s: if we lead on HP, stop diving and keep away
};

function think(view, memory) {
  const me = view.self;
  const K = view.constants;
  if (!memory.state) {
    memory.state = 'snipe';
    memory.lastDive = -9999;
    memory.side = 1;
    memory.seen = {};
  }
  const debug = [];

  for (const e of view.enemies) memory.seen[e.id] = { x: e.x, y: e.y, hp: e.hp, tick: view.tick };
  const enemy = pickTarget(view, me);
  if (enemy) memory.last = { x: enemy.x, y: enemy.y, tick: view.tick };
  const playSafe = view.ticksLeft < CFG.ENDGAME_TICKS && leadingOnHp(view, me, memory);
  const mineReady = (me.ammo.mine || 0) > 0 && (me.weaponCooldown.mine || 0) === 0;

  // ---- state transitions ----
  if (memory.state === 'snipe' && enemy && !playSafe && mineReady && me.hp >= CFG.MIN_HP_TO_DIVE &&
      view.tick - memory.lastDive > CFG.MIN_DIVE_GAP) {
    // A chaser coming straight at us? Lure it over a mine instead of diving past it
    memory.state = closingSpeed(me, enemy) > 120 && distance(me, enemy) < 1000 ? 'lure' : 'dive';
    memory.diveStart = view.tick;
    memory.side = -memory.side; // pass on the other side next time
  }
  if (memory.state === 'lure' && (!mineReady || !enemy || view.tick - memory.diveStart > 150)) {
    memory.state = 'snipe';
    memory.lastDive = view.tick - CFG.MIN_DIVE_GAP / 2;
  }
  if (memory.state === 'dive' && (playSafe || !mineReady || me.hp < CFG.MIN_HP_TO_DIVE || !enemy)) {
    memory.state = 'snipe';
  }
  if (memory.state === 'egress' && view.tick - memory.lastDive > CFG.EGRESS_TICKS &&
      !nearOwnMine(view, me, CFG.BLAST + 60)) {
    memory.state = 'snipe';
  }

  // ---- pick a behaviour ----
  let cmd, label = memory.state;
  const danger = dangerousBomb(view, me);
  const tracker = view.bombs.find((b) => !b.own && b.kind === 'tracker' && b.chasingMe);
  const detonate = enemy && memory.state === 'snipe' ? mineShot(view, me) : null;

  if (danger) {
    cmd = { turn: turnToward(me, safeHeading(view, me, angleTo(danger, me))), thrust: 1 };
    if (distance(me, danger) < CFG.BLAST) cmd.dash = angleTo(danger, me);
    debug.push({ type: 'circle', x: danger.x, y: danger.y, r: CFG.BLAST, color: '#f00' });
    label = 'mine!';
  } else if (memory.state === 'egress') {
    cmd = egress(view, me);
  } else if (tracker && distance(me, tracker) < 900) {
    cmd = shootTracker(view, me, tracker);
    label = 'tracker!';
  } else if (!enemy) {
    cmd = wander(view, me, memory);
    label = 'wander';
  } else if (detonate) {
    cmd = shootMine(view, me, detonate, debug);
    label = 'detonate';
  } else if (memory.state === 'dive') {
    cmd = dive(view, me, enemy, memory, debug);
  } else if (memory.state === 'lure') {
    cmd = { turn: turnToward(me, safeHeading(view, me, angleTo(enemy, me))), thrust: 1 };
  } else {
    cmd = snipe(view, me, enemy, memory, playSafe);
    if (playSafe) label = 'snipe (safe)';
  }

  // ---- bait mine: drop one on a chaser who'll reach it after it arms ----
  if (enemy && !cmd.mine && mineReady && memory.state !== 'dive') {
    const t = arrivalTime(me, enemy);
    const behind = Math.abs(angleDiff(me.angle, angleTo(me, enemy))) > 2.2;
    if (behind && t > CFG.ARM_TIME * 0.8 && t < 2.5 && distance(me, enemy) < 700) {
      cmd.mine = true;
      label = 'bait';
      if (memory.state === 'lure') { memory.state = 'egress'; memory.lastDive = view.tick; }
    }
  }

  // ---- defence overlay: shield bullets we can block, dash out of ones we can't ----
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

  debug.push({ type: 'text', x: me.x, y: me.y - 40, text: label, color: '#fff' });
  cmd.pigStat = 'speed'; // speed makes dives faster and escapes cleaner
  cmd.debug = debug;
  return cmd;
}

// ---------------- behaviours ----------------

function dive(view, me, enemy, memory, debug) {
  // Where the enemy will be once a mine dropped now has armed
  const future = predict(enemy, CFG.ARM_TIME + 0.2);
  // Aim just to the side of that spot so we pass them instead of ramming.
  // The side is fixed relative to the line we approach on, so the aim point doesn't swing.
  const approach = angleTo(me, future);
  const perp = approach + (Math.PI / 2) * memory.side;
  const aimPt = {
    x: future.x + Math.cos(perp) * CFG.PASS_OFFSET,
    y: future.y + Math.sin(perp) * CFG.PASS_OFFSET,
  };
  debug.push({ type: 'line', x: me.x, y: me.y, x2: aimPt.x, y2: aimPt.y, color: '#f80' });
  debug.push({ type: 'circle', x: future.x, y: future.y, r: CFG.DROP_RADIUS, color: '#f80' });

  const heading = safeHeading(view, me, angleTo(me, aimPt));
  const cmd = steerVelocity(me, heading, me.maxSpeed);

  // Free shots on the way in
  const lead = leadTarget(me, enemy, view.constants.BULLET_SPEED);
  cmd.fire = !!lead && Math.abs(angleDiff(me.angle, angleTo(me, lead))) < 0.08 &&
             canFire(view, me, enemy, lead);

  // Mines drift forward a little after the drop (they keep 30% of our speed), so drop a touch early
  const dist = distance(me, enemy);
  const dropSpot = predict({ x: me.x, y: me.y, vx: me.vx * 0.2, vy: me.vy * 0.2 }, 1);
  if (distance(dropSpot, future) < CFG.DROP_RADIUS || dist < 170) {
    cmd.mine = true;
    memory.state = 'egress';
    memory.lastDive = view.tick;
    return cmd;
  }

  // Overshot, or the dive is taking too long: give up this pass and try again soon
  const behind = Math.abs(angleDiff(me.angle, angleTo(me, enemy))) > Math.PI / 2;
  if ((behind && dist < 400) || view.tick - memory.diveStart > 240) {
    memory.state = 'snipe';
    memory.lastDive = view.tick - CFG.MIN_DIVE_GAP / 2;
  }
  return cmd;
}

function egress(view, me) {
  // Keep going; if we're still near our mine, head (and dash) directly away from it
  let heading = me.angle;
  const mine = nearOwnMine(view, me, CFG.BLAST + 80);
  const cmd = {};
  if (mine) {
    heading = angleTo(mine, me);
    if (mine.armed && distance(me, mine) < CFG.BLAST + 20) cmd.dash = heading;
  }
  cmd.turn = turnToward(me, safeHeading(view, me, heading));
  cmd.thrust = 1;
  return cmd;
}

function snipe(view, me, enemy, memory, playSafe) {
  const K = view.constants;
  const dist = distance(me, enemy);

  // Shockwave ships have to get close to hurt us: never let them
  if (enemy.loadout.includes('shockwave') && dist < 330) {
    const away = angleTo(enemy, me);
    const cmd = { turn: turnToward(me, safeHeading(view, me, away)), thrust: 1 };
    if (me.dashCooldown === 0 && me.energy >= K.DASH_COST) cmd.dash = away;
    return cmd;
  }
  // Protecting a lead at the end: just stay far away
  if (playSafe && dist < 1000) {
    return { turn: turnToward(me, safeHeading(view, me, angleTo(enemy, me))), thrust: 1 };
  }

  // Otherwise keep the nose on them and keep shooting
  const lead = leadTarget(me, enemy, K.BULLET_SPEED) || enemy;
  const aimAngle = angleTo(me, lead);
  const off = Math.abs(angleDiff(me.angle, aimAngle));
  const cmd = { turn: turnToward(me, aimAngle), thrust: 0 };
  cmd.fire = off < 0.06 && canFire(view, me, enemy, lead);
  if (dist > CFG.SNIPE_MAX && off < 0.5) cmd.thrust = 0.7;

  // Too close and still closing: dash backward, which keeps our aim on them
  const rx = enemy.x - me.x, ry = enemy.y - me.y;
  const closing = -(rx * (enemy.vx - me.vx) + ry * (enemy.vy - me.vy)) / (dist || 1);
  if (dist < CFG.SNIPE_MIN && closing > 60 && me.dashCooldown === 0 && me.energy >= K.DASH_COST + 15) {
    cmd.dash = 'back';
  }
  return cmd;
}

// Turn onto one of our own mines and shoot it while an enemy is in the blast
function shootMine(view, me, shot, debug) {
  const aimAngle = angleTo(me, shot.aim);
  debug.push({ type: 'line', x: me.x, y: me.y, x2: shot.bomb.x, y2: shot.bomb.y, color: '#f0f' });
  debug.push({ type: 'circle', x: shot.bomb.x, y: shot.bomb.y, r: CFG.BLAST, color: '#f0f' });
  return {
    turn: turnToward(me, aimAngle),
    thrust: 0,
    fire: Math.abs(angleDiff(me.angle, aimAngle)) < 0.03 && me.gunCooldown === 0,
  };
}

// An enemy tracker is chasing us: shoot it down if it's far enough away to be safe
function shootTracker(view, me, t) {
  const d = distance(me, t);
  if (d < 300) {
    // Too close to shoot safely: run, then dash sideways across its path
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

function wander(view, me, memory) {
  let goal;
  if (view.pig) goal = view.pig;
  else if (view.pigRespawnIn > 0 && view.pigRespawnIn < 90) goal = view.pigZone;
  else if (memory.last && view.tick - memory.last.tick < 150) goal = memory.last;
  else {
    // Nobody around: patrol a ring around the middle (ships spawn out there)
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

// Are we ahead of every enemy we've seen recently? (After 3 min, most HP wins.)
function leadingOnHp(view, me, memory) {
  let any = false;
  for (const id in memory.seen) {
    const s = memory.seen[id];
    if (view.tick - s.tick > 600) continue;
    any = true;
    if (s.hp >= me.hp) return false;
  }
  return any;
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

// Seconds until the enemy reaches our current spot (Infinity if they aren't closing)
function arrivalTime(me, enemy) {
  const rx = enemy.x - me.x, ry = enemy.y - me.y;
  const d = Math.hypot(rx, ry) || 1;
  const closing = -(rx * enemy.vx + ry * enemy.vy) / d;
  return closing > 20 ? d / closing : Infinity;
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

function nearOwnMine(view, me, radius) {
  for (const b of view.bombs) {
    if (b.own && b.kind === 'mine' && distance(me, b) < radius) return b;
  }
  return null;
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