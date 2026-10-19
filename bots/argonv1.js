// @name ArgonV1
// @color #ff9f43
// ============================================================================
// GEMINIPROBOT v2.0 — Ship AI Arena Tournament Bot
// Loadout: ['gun', 'tracker'] (Point-defense + long-range pressure + kiting)
// ============================================================================
const loadout = ['gun', 'tracker'];

function think(view, memory) {
  const me = view.self;
  const c = view.constants || {};
  const BULLET_SPEED = c.BULLET_SPEED || 720;
  const BULLET_RANGE = c.BULLET_RANGE || 1400;
  const DT = 1 / 30;
  const debug = [];

  // --------------------------------------------------------------------------
  // 0. INITIALIZE & UPDATE MEMORY (Enemy Tracking + Velocity Smoothing)
  // --------------------------------------------------------------------------
  if (!memory.enemies) memory.enemies = {};
  if (!memory.shieldHoldUntil) memory.shieldHoldUntil = 0;

  for (const e of view.enemies) {
    const prev = memory.enemies[e.id];
    // Exponential moving average of velocity to defeat zig-zag dodging bots
    const svx = prev ? 0.65 * e.vx + 0.35 * prev.svx : e.vx;
    const svy = prev ? 0.65 * e.vy + 0.35 * prev.svy : e.vy;
    memory.enemies[e.id] = {
      id: e.id,
      x: e.x,
      y: e.y,
      vx: e.vx,
      vy: e.vy,
      svx: svx,
      svy: svy,
      angle: e.angle,
      hp: e.hp,
      maxHp: e.maxHp,
      loadout: e.loadout || [],
      tick: view.tick
    };
  }

  // Clean up stale memory entries (> 8 seconds old)
  for (const id in memory.enemies) {
    if (view.tick - memory.enemies[id].tick > 240) {
      delete memory.enemies[id];
    }
  }

  // Helper to safely read weapon ammo and cooldowns
  const hasWeapon = (w) => Array.isArray(me.loadout) ? me.loadout.includes(w) : loadout.includes(w);
  const getAmmo = (w) => (me.ammo && typeof me.ammo[w] === 'number') ? me.ammo[w] : 0;
  const getWeaponCD = (w) => {
    if (typeof me.weaponCooldown === 'number') return me.weaponCooldown;
    if (me.weaponCooldown && typeof me.weaponCooldown[w] === 'number') return me.weaponCooldown[w];
    return 0;
  };

  // --------------------------------------------------------------------------
  // 1. DYNAMIC PIG UPGRADE STRATEGY
  // --------------------------------------------------------------------------
  // - Heal/Tank if low HP or in the final 40s (tiebreaker is highest HP)
  // - 1st upgrade: 'speed' (504 px/s outruns 460 px/s enemy trackers!)
  // - 2nd upgrade: 'energy' (fuel for dash + shield + gun volleys)
  let pigStat = 'speed';
  if (me.hp <= 65 || view.ticksLeft < 1200) {
    pigStat = 'hp';
  } else if (me.upgrades.speed >= 1 && me.upgrades.energy < 1) {
    pigStat = 'energy';
  } else if (me.upgrades.speed >= 2) {
    pigStat = 'hp';
  }

  // --------------------------------------------------------------------------
  // 2. THREAT ANALYSIS (Exact Closest-Point-of-Approach Physics)
  // --------------------------------------------------------------------------
  let shield = false;
  let dash = false;
  let urgentEvadeVec = { x: 0, y: 0 };
  let imminentDamage = 0;
  let threatPoint = null;

  // 2A. Analyze Mines & Trackers
  let trackerToSnipe = null;
  let bestTrackerDist = Infinity;

  for (const b of view.bombs) {
    const isOwn = b.own || b.mine;
    const d = distance(me, b);

    // Relative velocity CPA check for bombs
    const rvx = (b.vx || 0) - me.vx;
    const rvy = (b.vy || 0) - me.vy;
    const rSpeedSq = rvx * rvx + rvy * rvy;
    const rx = me.x - b.x;
    const ry = me.y - b.y;
    const tCpa = rSpeedSq > 1 ? clamp((rx * rvx + ry * rvy) / rSpeedSq, 0, 1.5) : 0;
    const cpaDist = Math.hypot(rx - rvx * tCpa, ry - rvy * tCpa);

    const blastRadius = b.kind === 'tracker' ? 170 : 240;
    const dangerRadius = blastRadius + 75;

    // All bombs hurt us when they explode (even our own if armed/detonating)
    if (!isOwn || b.armed || b.ticksUntilFuse < 45) {
      if (d < dangerRadius || cpaDist < blastRadius) {
        const awayAngle = angleTo(b, me);
        const weight = clamp((dangerRadius - d) / dangerRadius, 0.3, 1.5) * 3.0;
        urgentEvadeVec.x += Math.cos(awayAngle) * weight;
        urgentEvadeVec.y += Math.sin(awayAngle) * weight;
        debug.push({ type: 'circle', x: b.x, y: b.y, r: blastRadius, color: '#ff3333' });
      }
    }

    if (!isOwn) {
      // Imminent blast check -> Emergency Dash or Shield!
      const triggerDist = b.kind === 'tracker' ? 175 : 210;
      if (d < triggerDist || (b.kind === 'tracker' && cpaDist < 90 && tCpa < 0.25)) {
        if (!me.dashing && me.dashCooldown === 0 && me.energy >= 25) {
          dash = angleTo(b, me); // Dash straight out of blast radius
        } else {
          imminentDamage += b.kind === 'tracker' ? 35 : 45;
          threatPoint = b;
        }
      }

      // Can we snipe this enemy tracker before it reaches us?
      if (
        b.kind === 'tracker' &&
        d > 185 &&
        d < 950 &&
        d < bestTrackerDist &&
        lineOfSight(view, me, b)
      ) {
        bestTrackerDist = d;
        trackerToSnipe = b;
      }
    }
  }

  // 2B. Analyze Incoming Enemy Bullets
  let bulletHitsSoon = 0;
  let dodgeBulletVec = { x: 0, y: 0 };

  for (const b of view.bullets) {
    if (b.own || b.mine) continue;

    const rx = me.x - b.x;
    const ry = me.y - b.y;
    const rvx = b.vx - me.vx;
    const rvy = b.vy - me.vy;
    const rSpeedSq = rvx * rvx + rvy * rvy;
    if (rSpeedSq < 1) continue;

    const maxTime = (b.ticksLeft || 30) * DT;
    const tCpa = clamp((rx * rvx + ry * rvy) / rSpeedSq, 0, Math.min(maxTime, 1.0));
    const missX = rx - rvx * tCpa;
    const missY = ry - rvy * tCpa;
    const cpaDist = Math.hypot(missX, missY);

    // Ship hitbox + safety margin (~38 px)
    if (cpaDist < 42 && tCpa > 0) {
      // Push perpendicular to bullet velocity toward the side we're already on
      const bulletAngle = Math.atan2(b.vy, b.vx);
      const cross = rvx * ry - rvy * rx;
      const perpAngle = bulletAngle + (cross >= 0 ? Math.PI / 2 : -Math.PI / 2);
      const urgency = clamp(1.0 - tCpa, 0.2, 1.0) * 2.2;
      dodgeBulletVec.x += Math.cos(perpAngle) * urgency;
      dodgeBulletVec.y += Math.sin(perpAngle) * urgency;

      debug.push({ type: 'circle', x: b.x, y: b.y, r: 10, color: '#ffaa00' });

      // Only count as imminent impact if arriving within 5 ticks (0.17s)
      if (tCpa <= 0.18 && cpaDist < 34) {
        bulletHitsSoon++;
        imminentDamage += 6;
        if (!threatPoint) threatPoint = b;
      }
    }
  }

  // 2C. Analyze Enemy Shockwave Threats
  for (const e of view.enemies) {
    const d = distance(me, e);
    const enemyHasShockwave = Array.isArray(e.loadout) && e.loadout.includes('shockwave');
    if (enemyHasShockwave && d < 255) {
      const away = angleTo(e, me);
      urgentEvadeVec.x += Math.cos(away) * 2.5;
      urgentEvadeVec.y += Math.sin(away) * 2.5;

      if (d < 225) {
        if (!me.dashing && me.dashCooldown === 0 && me.energy >= 25 && !dash) {
          dash = away;
        } else {
          imminentDamage += 20;
          if (!threatPoint) threatPoint = e;
        }
      }
    }
  }

  // 2D. Smart Shield Controller (With Hysteresis to Save the 20-Energy Activation Cost)
  if (threatPoint) {
    const neededSide = shieldSideFor(me, threatPoint);
    if (neededSide) {
      if (me.shieldOn) {
        // Shield is already up: flipping front/back is FREE, holding costs very little
        shield = neededSide;
        memory.shieldHoldUntil = view.tick + 6;
      } else {
        // Raising shield costs 20 energy upfront. Raise for bombs/shockwaves,
        // multi-bullet volleys, or single bullets when HP < 75 or energy is high.
        const worthRaising =
          imminentDamage >= 12 ||
          (imminentDamage >= 6 && (me.hp < 75 || me.energy > 68 || me.spinning));
        if (worthRaising && me.energy >= 30) {
          shield = neededSide;
          memory.shieldHoldUntil = view.tick + 8;
        } else if (bulletHitsSoon > 0 && !dash && !me.dashing && me.dashCooldown === 0 && me.energy >= 45) {
          // Sidestep bullet with dash so we can keep firing our gun
          dash = Math.atan2(dodgeBulletVec.y, dodgeBulletVec.x);
        }
      }
    }
  } else if (me.shieldOn && view.tick < memory.shieldHoldUntil && me.energy > 25) {
    // Brief hysteresis so we don't drop and re-raise shield between two consecutive shots
    shield = me.shieldSide || 'front';
  }

  // --------------------------------------------------------------------------
  // 3. TARGET SELECTION & MEMORY TRACKING
  // --------------------------------------------------------------------------
  let targetEnemy = null;
  let bestTargetScore = -Infinity;

  for (const e of view.enemies) {
    const d = distance(me, e);
    // Score enemies: prefer closer, lower HP, spinning (helpless), and unshielded
    let score = 1500 - d;
    score += (1 - e.hp / (e.maxHp || 100)) * 350;
    if (e.spinning) score += 300;
    if (e.shieldOn && shieldSideFor(e, me) === e.shieldSide) score -= 250;

    if (score > bestTargetScore) {
      bestTargetScore = score;
      targetEnemy = e;
    }
  }

  // Also check if we can detonate an enemy bomb right next to an enemy ship!
  let bombTrapTarget = null;
  if (!trackerToSnipe && targetEnemy) {
    for (const b of view.bombs) {
      const blastR = b.kind === 'tracker' ? 170 : 240;
      if (
        distance(b, targetEnemy) < blastR - 15 &&
        distance(me, b) > blastR + 40 &&
        distance(me, b) < 1100 &&
        lineOfSight(view, me, b)
      ) {
        bombTrapTarget = b;
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. OFFENSIVE WEAPONS (Gun, Tracker, Mine, Shockwave)
  // --------------------------------------------------------------------------
  let fire = false;
  let useTracker = false;
  let useMine = false;
  let useShockwave = false;
  let aimPoint = null;
  let canDamageTarget = false;

  // Priority 1: Snipe incoming enemy tracker or bomb trap
  const priorityBomb = trackerToSnipe || bombTrapTarget;
  if (priorityBomb && hasWeapon('gun')) {
    const bombLead = leadTarget(me, priorityBomb, BULLET_SPEED) || priorityBomb;
    aimPoint = bombLead;
    canDamageTarget = true;
    const aimAngle = angleTo(me, aimPoint);
    if (
      !shield &&
      me.gunCooldown === 0 &&
      me.energy >= 12 &&
      Math.abs(angleDiff(me.angle, aimAngle)) < 0.14
    ) {
      fire = true;
    }
    debug.push({ type: 'line', x: me.x, y: me.y, x2: aimPoint.x, y2: aimPoint.y, color: '#ff00ff' });
  }
  // Priority 2: Engage target enemy with Gun
  else if (targetEnemy && hasWeapon('gun')) {
    const memE = memory.enemies[targetEnemy.id];
    // Construct a velocity-smoothed target for anti-juke lead calculation
    const smoothedTarget = memE && !targetEnemy.dashing && !targetEnemy.spinning
      ? { x: targetEnemy.x, y: targetEnemy.y, vx: memE.svx, vy: memE.svy }
      : targetEnemy;

    const lead = leadTarget(me, smoothedTarget, BULLET_SPEED);
    if (lead && lead.time * BULLET_SPEED < BULLET_RANGE * 0.94) {
      aimPoint = lead;
      const aimAngle = angleTo(me, aimPoint);

      // Check if an asteroid blocks the actual bullet flight path to the intercept point
      const rayHit = raycast(view, me.x, me.y, aimPoint.x, aimPoint.y);
      const pathClear = !rayHit || rayHit.distance > distance(me, aimPoint) - 15;

      // Check if enemy's active 120° shield will block our shot
      const enemyShieldBlocks =
        targetEnemy.shieldOn &&
        !targetEnemy.spinning &&
        shieldSideFor(targetEnemy, me) === targetEnemy.shieldSide;

      canDamageTarget = pathClear && !enemyShieldBlocks;

      // Dynamic angular tolerance based on distance (enemy ship radius ~24px)
      const distToAim = Math.max(distance(me, aimPoint), 80);
      const hitTolerance = clamp(Math.atan2(22, distToAim), 0.05, 0.18);

      // Energy conservation: keep 25 energy in reserve unless going for a kill shot
      const minGunEnergy = targetEnemy.hp <= 18 || targetEnemy.spinning ? 10 : 28;

      if (
        canDamageTarget &&
        !shield &&
        me.gunCooldown === 0 &&
        me.energy >= minGunEnergy &&
        Math.abs(angleDiff(me.angle, aimAngle)) < hitTolerance
      ) {
        fire = true;
      }

      debug.push({
        type: 'line',
        x: me.x,
        y: me.y,
        x2: aimPoint.x,
        y2: aimPoint.y,
        color: enemyShieldBlocks ? '#888888' : '#00ff66'
      });
    }
  }

  // Secondary Weapon: Tracker Deployment
  if (hasWeapon('tracker') && getAmmo('tracker') > 0 && getWeaponCD('tracker') === 0) {
    // Check that dropping a tracker behind us won't immediately slam into an asteroid
    const backX = me.x - Math.cos(me.angle) * 90;
    const backY = me.y - Math.sin(me.angle) * 90;
    const backBlocked = raycast(view, me.x, me.y, backX, backY);

    if (!backBlocked) {
      const distToEnemy = targetEnemy ? distance(me, targetEnemy) : Infinity;
      const ammoCount = getAmmo('tracker');
      // Fire if enemy is in engagement range, OR if sitting on max (3) charges with any enemy known
      if (
        (targetEnemy && distToEnemy < 1350 && distToEnemy > 180) ||
        (ammoCount >= 3 && Object.keys(memory.enemies).length > 0)
      ) {
        useTracker = true;
      }
    }
  }

  // Optional Weapon Support: Shockwave (if user changes loadout)
  if (hasWeapon('shockwave') && getAmmo('shockwave') > 0 && getWeaponCD('shockwave') === 0) {
    for (const e of view.enemies) {
      const d = distance(me, e);
      const blockedByEnemyShield = e.shieldOn && shieldSideFor(e, me) === e.shieldSide;
      if (d <= 215 && (!blockedByEnemyShield || d < 120)) {
        useShockwave = true;
        break;
      }
    }
  }

  // Optional Weapon Support: Mine (if user changes loadout)
  if (hasWeapon('mine') && getAmmo('mine') > 0 && getWeaponCD('mine') === 0) {
    if (targetEnemy) {
      const d = distance(me, targetEnemy);
      const angleToE = angleTo(me, targetEnemy);
      const isBehindUs = Math.abs(angleDiff(me.angle, angleToE)) > Math.PI * 0.6;
      if (d < 480 && isBehindUs) {
        useMine = true;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. STRATEGIC GOAL & VELOCITY-SPACE NAVIGATION
  // --------------------------------------------------------------------------
  const center = view.pigZone || { x: view.arena.width / 2, y: view.arena.height / 2, radius: 700 };
  let goalPos = { x: center.x, y: center.y };
  let stateText = 'PATROL';

  // Decide high-level movement target
  const pigSoon = !view.pig && view.pigRespawnIn > 0 && view.pigRespawnIn < 210; // < 7s to spawn

  if (view.pig) {
    goalPos = { x: view.pig.x + (view.pig.vx || 0) * 0.3, y: view.pig.y + (view.pig.vy || 0) * 0.3 };
    stateText = '🐷 CLAIM PIG';

    // Dash onto the pig if we are close, have clear LOS, and want to secure it immediately
    const pigDist = distance(me, view.pig);
    if (
      !dash &&
      !me.dashing &&
      me.dashCooldown === 0 &&
      me.energy >= 45 &&
      pigDist < 310 &&
      pigDist > 60 &&
      !raycast(view, me.x, me.y, view.pig.x, view.pig.y)
    ) {
      dash = angleTo(me, view.pig);
    }
  } else if (pigSoon && (!targetEnemy || me.hp <= 65 || distance(me, center) < 1200)) {
    // Stage near center right before the 60s pig respawn
    goalPos = { x: center.x, y: center.y };
    stateText = '🐷 STAGE FOR PIG';
  } else if (targetEnemy) {
    const d = distance(me, targetEnemy);
    const enemyHasShockwave = Array.isArray(targetEnemy.loadout) && targetEnemy.loadout.includes('shockwave');

    // Maintain a wider standoff against shockwave bots or when low on energy
    let desiredRange = enemyHasShockwave ? 540 : 440;
    if (me.energy < 30 && !targetEnemy.spinning) desiredRange = 640;
    if (targetEnemy.spinning || targetEnemy.hp <= 18) desiredRange = 280; // Push in for the finish

    // Orbit toward the enemy's UNSHIELDED flank/rear instead of sitting in front of their gun!
    const angleFromEnemyToMe = angleTo(targetEnemy, me);
    const sideSign = angleDiff(targetEnemy.angle, angleFromEnemyToMe) >= 0 ? 1 : -1;
    let orbitOffset = sideSign * 0.55; // Strafe around them
    if (targetEnemy.shieldOn) {
      // Explicitly rotate away from whichever side their shield is covering
      const shieldCenterAngle =
        targetEnemy.shieldSide === 'back'
          ? normalizeAngle(targetEnemy.angle + Math.PI)
          : targetEnemy.angle;
      const diffFromShield = angleDiff(shieldCenterAngle, angleFromEnemyToMe);
      orbitOffset = (diffFromShield >= 0 ? 1 : -1) * 0.85;
    }

    const targetOrbitAngle = angleFromEnemyToMe + orbitOffset;
    goalPos = {
      x: targetEnemy.x + Math.cos(targetOrbitAngle) * desiredRange,
      y: targetEnemy.y + Math.sin(targetOrbitAngle) * desiredRange
    };
    stateText = d < desiredRange - 80 ? 'KITE' : d > desiredRange + 120 ? 'PURSUE' : 'FLANK';
  } else {
    // No visible enemies: hunt freshest enemy in memory, or orbit the central pigZone
    let freshest = null;
    for (const id in memory.enemies) {
      const m = memory.enemies[id];
      if (!freshest || m.tick > freshest.tick) freshest = m;
    }
    if (freshest && view.tick - freshest.tick < 150) {
      const dtSeen = (view.tick - freshest.tick) * DT;
      goalPos = {
        x: clamp(freshest.x + freshest.vx * dtSeen, 500, view.arena.width - 500),
        y: clamp(freshest.y + freshest.vy * dtSeen, 500, view.arena.height - 500)
      };
      stateText = 'HUNT MEMORY';
    } else {
      // Smoothly orbit the edge of the open center pigZone (radius ~550)
      const curAngle = angleTo(center, me);
      const orbitAngle = curAngle + 0.6;
      goalPos = {
        x: center.x + Math.cos(orbitAngle) * 520,
        y: center.y + Math.sin(orbitAngle) * 520
      };
    }
  }

  // --------------------------------------------------------------------------
  // 6. ASTEROID, WALL & RAMMING AVOIDANCE (Delta-V Vector Control)
  // --------------------------------------------------------------------------
  const maxSpd = me.maxSpeed || 360;
  const toGoalAngle = angleTo(me, goalPos);
  const toGoalDist = distance(me, goalPos);
  const desiredSpeed = clamp(toGoalDist * 1.4, 80, maxSpd);

  // Start with desired velocity toward goalPos
  let desVx = Math.cos(toGoalAngle) * desiredSpeed;
  let desVy = Math.sin(toGoalAngle) * desiredSpeed;

  // Add bullet & bomb evasion vectors
  desVx += (urgentEvadeVec.x + dodgeBulletVec.x) * maxSpd * 0.85;
  desVy += (urgentEvadeVec.y + dodgeBulletVec.y) * maxSpd * 0.85;

  // Repulsion from Asteroids (predictive time-to-collision + static buffer)
  let collisionEmergency = false;
  let emergencyEscapeAngle = 0;

  for (const a of view.asteroids) {
    const d = distance(me, a);
    const safeRadius = (a.radius || 45) + 95;
    if (d < safeRadius + 260) {
      // Check future distance in 0.45s based on relative velocity
      const futRx = (me.x + me.vx * 0.45) - (a.x + (a.vx || 0) * 0.45);
      const futRy = (me.y + me.vy * 0.45) - (a.y + (a.vy || 0) * 0.45);
      const futDist = Math.hypot(futRx, futRy);

      if (futDist < safeRadius || d < safeRadius) {
        const pushAngle = Math.atan2(futRy, futRx);
        const severity = clamp((safeRadius - Math.min(d, futDist)) / safeRadius, 0.2, 2.0);
        desVx += Math.cos(pushAngle) * maxSpd * severity * 1.8;
        desVy += Math.sin(pushAngle) * maxSpd * severity * 1.8;

        // Check if we are about to slam into the rock faster than 120 px/s
        const relVx = me.vx - (a.vx || 0);
        const relVy = me.vy - (a.vy || 0);
        const closingSpeed = -(relVx * (me.x - a.x) + relVy * (me.y - a.y)) / Math.max(d, 1);
        if (d < (a.radius || 45) + 65 && closingSpeed > 110) {
          collisionEmergency = true;
          emergencyEscapeAngle = pushAngle;
        }
      }
    }
  }

  // Prevent Ship-vs-Ship Ramming Damage (> 120 px/s hurts both ships)
  for (const e of view.enemies) {
    const d = distance(me, e);
    if (d < 160) {
      const away = angleTo(e, me);
      const push = clamp((160 - d) / 160, 0.3, 1.5);
      desVx += Math.cos(away) * maxSpd * push * 1.6;
      desVy += Math.sin(away) * maxSpd * push * 1.6;
    }
  }

  // Smooth Arena Wall Repulsion (6000 x 6000 boundaries)
  const wallMargin = 480;
  if (me.x < wallMargin) {
    desVx += ((wallMargin - me.x) / wallMargin) * maxSpd * 2.2;
  } else if (me.x > view.arena.width - wallMargin) {
    desVx -= ((me.x - (view.arena.width - wallMargin)) / wallMargin) * maxSpd * 2.2;
  }
  if (me.y < wallMargin) {
    desVy += ((wallMargin - me.y) / wallMargin) * maxSpd * 2.2;
  } else if (me.y > view.arena.height - wallMargin) {
    desVy -= ((me.y - (view.arena.height - wallMargin)) / wallMargin) * maxSpd * 2.2;
  }

  // Clamp desired velocity magnitude to maxSpeed
  const desMag = Math.hypot(desVx, desVy);
  if (desMag > maxSpd) {
    desVx = (desVx / desMag) * maxSpd;
    desVy = (desVy / desMag) * maxSpd;
  }

  // Compute Newtonian Delta-V vector (the thrust vector needed to change current velocity to desired velocity)
  const dvx = desVx - me.vx;
  const dvy = desVy - me.vy;
  const dvMag = Math.hypot(dvx, dvy);
  const thrustAngle = Math.atan2(dvy, dvx);

  // If we're about to crash into an asteroid at >120 px/s, use Dash if available
  if (collisionEmergency && !dash && !me.dashing && me.dashCooldown === 0 && me.energy >= 25) {
    dash = emergencyEscapeAngle;
  }

  // --------------------------------------------------------------------------
  // 7. ARBITRATE NOSE ANGLE (Aiming vs. Newtonian Thrusting)
  // --------------------------------------------------------------------------
  let desiredNoseAngle = thrustAngle;
  let thrust = 0;

  const urgentThreat =
    collisionEmergency ||
    Math.hypot(urgentEvadeVec.x, urgentEvadeVec.y) > 1.2 ||
    me.x < 240 ||
    me.x > view.arena.width - 240 ||
    me.y < 240 ||
    me.y > view.arena.height - 240;

  if (urgentThreat) {
    // Survival override: point nose along escape Delta-V vector and burn hard
    desiredNoseAngle = thrustAngle;
    const align = Math.cos(angleDiff(me.angle, desiredNoseAngle));
    thrust = align > 0.25 ? clamp(align, 0, 1) : 0;
    stateText = '⚠️ EVADE';
  } else if (aimPoint && canDamageTarget && me.energy >= 14) {
    // Combat lock: point nose at the gun lead point so we can land shots
    desiredNoseAngle = angleTo(me, aimPoint);

    // Since engines only push forward along me.angle, project our desired Delta-V
    // onto our nose vector. Only thrust forward if doing so helps our desired motion!
    const forwardProjection = (dvx * Math.cos(me.angle) + dvy * Math.sin(me.angle)) / Math.max(maxSpd, 1);
    if (forwardProjection > 0.1) {
      thrust = clamp(forwardProjection * 1.4, 0, 1);
    } else {
      thrust = 0; // Coast backward/sideways while shooting!
      // If an enemy is rushing us too closely while we aim at them, dash backward while keeping aim!
      if (
        targetEnemy &&
        distance(me, targetEnemy) < 260 &&
        !dash &&
        !me.dashing &&
        me.dashCooldown === 0 &&
        me.energy >= 50
      ) {
        dash = angleTo(targetEnemy, me);
      }
    }
  } else {
    // No immediate shot (enemy shielded, out of range, or gun/energy recharging):
    // Use Newtonian Delta-V steering to accelerate cleanly toward goalPos
    desiredNoseAngle = thrustAngle;
    const align = Math.cos(angleDiff(me.angle, desiredNoseAngle));
    if (dvMag > 25 && align > 0.2) {
      thrust = clamp((dvMag / 180) * align, 0, 1);
    }
  }

  // Debug overlays
  debug.push({ type: 'circle', x: goalPos.x, y: goalPos.y, r: 22, color: '#00ffff' });
  debug.push({
    type: 'line',
    x: me.x,
    y: me.y,
    x2: me.x + dvx * 0.4,
    y2: me.y + dvy * 0.4,
    color: '#00ffff'
  });
  debug.push({ type: 'text', x: me.x, y: me.y - 42, text: stateText, color: '#ffffff' });

  return {
    thrust: clamp(thrust, 0, 1),
    turn: turnToward(me, desiredNoseAngle),
    fire: fire,
    tracker: useTracker,
    mine: useMine,
    shockwave: useShockwave,
    shield: shield,
    dash: dash,
    pigStat: pigStat,
    debug: debug
  };
}