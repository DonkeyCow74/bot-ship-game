// @name ArgonV2
// @color #ff6bcb
// ============================================================================
// GEMINIPROBOT v3.0 — Ship AI Arena Tournament Bot
// Fixes: Proactive 30+ Energy Shield Reserve, Blindspot Rotation, Anti-Stalemate Strafing
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
  // 0. MEMORY INITIALIZATION & VELOCITY SMOOTHING
  // --------------------------------------------------------------------------
  if (!memory.enemies) memory.enemies = {};
  if (!memory.shieldHoldUntil) memory.shieldHoldUntil = 0;
  if (!memory.strafeDir) memory.strafeDir = 1;
  if (!memory.nextStrafeFlip) memory.nextStrafeFlip = 90;
  if (!memory.strafeBurstUntil) memory.strafeBurstUntil = 0;

  // Periodically flip orbit direction so our path is unpredictable
  if (view.tick >= memory.nextStrafeFlip) {
    memory.strafeDir *= -1;
    memory.nextStrafeFlip = view.tick + 90 + Math.floor(Math.random() * 60);
  }

  for (const e of view.enemies) {
    const prev = memory.enemies[e.id];
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

  for (const id in memory.enemies) {
    if (view.tick - memory.enemies[id].tick > 240) {
      delete memory.enemies[id];
    }
  }

  const hasWeapon = (w) => (Array.isArray(me.loadout) ? me.loadout.includes(w) : loadout.includes(w));
  const getAmmo = (w) => (me.ammo && typeof me.ammo[w] === 'number' ? me.ammo[w] : 0);
  const getWeaponCD = (w) => {
    if (typeof me.weaponCooldown === 'number') return me.weaponCooldown;
    if (me.weaponCooldown && typeof me.weaponCooldown[w] === 'number') return me.weaponCooldown[w];
    return 0;
  };

  // Helper: Pick best shield side AND the nose angle needed to align that 120° arc
  function getBestShieldAlignment(threatPos) {
    const directSide = shieldSideFor(me, threatPos);
    const angleToThreat = angleTo(me, threatPos);
    if (directSide) {
      return { side: directSide, alignAngle: null };
    }
    // Threat is in the 60° side blindspot! Pick whichever arc (front or back) is closer
    // and return the nose angle needed to rotate the shield over the threat.
    const diffFront = Math.abs(angleDiff(me.angle, angleToThreat));
    if (diffFront <= Math.PI / 2) {
      return { side: 'front', alignAngle: angleToThreat };
    } else {
      return { side: 'back', alignAngle: normalizeAngle(angleToThreat + Math.PI) };
    }
  }

  // --------------------------------------------------------------------------
  // 1. DYNAMIC PIG UPGRADE STRATEGY
  // --------------------------------------------------------------------------
  let pigStat = 'speed';
  if (me.hp <= 70 || view.ticksLeft < 1200) {
    pigStat = 'hp';
  } else if (me.upgrades.speed >= 1 && me.upgrades.energy < 1) {
    pigStat = 'energy';
  } else if (me.upgrades.speed >= 2) {
    pigStat = 'hp';
  }

  // --------------------------------------------------------------------------
  // 2. THREAT ANALYSIS & PROACTIVE SHIELD / DASH CONTROLLER
  // --------------------------------------------------------------------------
  let shield = false;
  let shieldTurnOverride = null;
  let dash = false;
  let urgentEvadeVec = { x: 0, y: 0 };
  let dodgeBulletVec = { x: 0, y: 0 };

  let immediateShieldThreat = null;
  let earliestThreatTime = Infinity;
  let bulletStreamIncoming = false;

  // 2A. Evaluate Mines & Trackers
  let trackerToSnipe = null;
  let bestTrackerDist = Infinity;

  for (const b of view.bombs) {
    const isOwn = b.own || b.mine;
    const d = distance(me, b);

    const rvx = (b.vx || 0) - me.vx;
    const rvy = (b.vy || 0) - me.vy;
    const rSpeedSq = rvx * rvx + rvy * rvy;
    const rx = me.x - b.x;
    const ry = me.y - b.y;
    const tCpa = rSpeedSq > 1 ? clamp((rx * rvx + ry * rvy) / rSpeedSq, 0, 1.5) : 0;
    const cpaDist = Math.hypot(rx - rvx * tCpa, ry - rvy * tCpa);

    const blastRadius = b.kind === 'tracker' ? 170 : 240;
    const dangerRadius = blastRadius + 85;

    if (!isOwn || b.armed || b.ticksUntilFuse < 45) {
      if (d < dangerRadius || cpaDist < blastRadius) {
        const awayAngle = angleTo(b, me);
        const weight = clamp((dangerRadius - d) / dangerRadius, 0.4, 2.0) * 3.2;
        urgentEvadeVec.x += Math.cos(awayAngle) * weight;
        urgentEvadeVec.y += Math.sin(awayAngle) * weight;
        debug.push({ type: 'circle', x: b.x, y: b.y, r: blastRadius, color: '#ff3333' });
      }
    }

    if (!isOwn) {
      const triggerDist = b.kind === 'tracker' ? 210 : 245;
      if (d < triggerDist || (b.kind === 'tracker' && cpaDist < 120 && tCpa < 0.35)) {
        if (!me.dashing && me.dashCooldown === 0 && me.energy >= 25) {
          dash = angleTo(b, me);
        } else {
          immediateShieldThreat = b;
          earliestThreatTime = 0;
        }
      }

      if (
        b.kind === 'tracker' &&
        d > 180 &&
        d < 950 &&
        d < bestTrackerDist &&
        lineOfSight(view, me, b)
      ) {
        bestTrackerDist = d;
        trackerToSnipe = b;
      }
    }
  }

  // 2B. Evaluate Incoming Enemy Bullets (WiderHitbox + Stream Detection)
  for (const b of view.bullets) {
    if (b.own || b.mine) continue;

    const rx = me.x - b.x;
    const ry = me.y - b.y;
    const rvx = b.vx - me.vx;
    const rvy = b.vy - me.vy;
    const rSpeedSq = rvx * rvx + rvy * rvy;
    if (rSpeedSq < 1) continue;

    const maxTime = (b.ticksLeft || 30) * DT;
    const tCpa = clamp((rx * rvx + ry * rvy) / rSpeedSq, 0, Math.min(maxTime, 1.2));
    const missX = rx - rvx * tCpa;
    const missY = ry - rvy * tCpa;
    const cpaDist = Math.hypot(missX, missY);

    // Detect bullets passing within 56px of ship center
    if (cpaDist < 56 && tCpa > 0) {
      const bulletAngle = Math.atan2(b.vy, b.vx);
      const cross = rvx * ry - rvy * rx;
      const perpAngle = bulletAngle + (cross >= 0 ? Math.PI / 2 : -Math.PI / 2);
      const urgency = clamp(1.1 - tCpa, 0.25, 1.2) * 2.5;
      dodgeBulletVec.x += Math.cos(perpAngle) * urgency;
      dodgeBulletVec.y += Math.sin(perpAngle) * urgency;

      debug.push({ type: 'circle', x: b.x, y: b.y, r: 12, color: '#ffaa00' });

      // Keep shield held if another bullet in a stream is within 0.45s
      if (tCpa <= 0.45 && cpaDist < 52) {
        bulletStreamIncoming = true;
      }

      // Raise shield when impact is within 0.32s (~9-10 ticks) and within 46px
      if (tCpa <= 0.32 && cpaDist < 46) {
        if (tCpa < earliestThreatTime) {
          earliestThreatTime = tCpa;
          immediateShieldThreat = b;
        }
      }
    }
  }

  // 2C. Evaluate Enemy Shockwave Threats (220px blast radius)
  for (const e of view.enemies) {
    const d = distance(me, e);
    const enemyHasShockwave = Array.isArray(e.loadout) && e.loadout.includes('shockwave');
    if (enemyHasShockwave && d < 265) {
      const away = angleTo(e, me);
      urgentEvadeVec.x += Math.cos(away) * 2.8;
      urgentEvadeVec.y += Math.sin(away) * 2.8;

      if (d < 240) {
        if (!me.dashing && me.dashCooldown === 0 && me.energy >= 25 && !dash) {
          dash = away;
        } else if (!immediateShieldThreat) {
          immediateShieldThreat = e;
          earliestThreatTime = 0;
        }
      }
    }
  }

  // 2D. Execute Shield & Blindspot Rotation
  if (immediateShieldThreat && !dash) {
    const align = getBestShieldAlignment(immediateShieldThreat);
    if (me.shieldOn || me.energy >= 30) {
      shield = align.side;
      if (align.alignAngle !== null) {
        shieldTurnOverride = align.alignAngle;
      }
      memory.shieldHoldUntil = view.tick + 6;
    } else if (!me.dashing && me.dashCooldown === 0 && me.energy >= 25) {
      // If between 25 and 29 energy (can't raise shield, but can dash!), dash sideways!
      const threatAngle = angleTo(immediateShieldThreat, me);
      dash = threatAngle + (memory.strafeDir * Math.PI) / 2;
    }
  } else if (
    me.shieldOn &&
    (view.tick < memory.shieldHoldUntil || bulletStreamIncoming) &&
    me.energy > 18
  ) {
    // Hold shield through multi-bullet bursts so we don't pay the 20-energy startup fee twice
    shield = me.shieldSide || 'front';
  }

  // --------------------------------------------------------------------------
  // 3. TARGET ACQUISITION
  // --------------------------------------------------------------------------
  let targetEnemy = null;
  let bestTargetScore = -Infinity;

  for (const e of view.enemies) {
    const d = distance(me, e);
    let score = 1500 - d;
    score += (1 - e.hp / (e.maxHp || 100)) * 350;
    if (e.spinning) score += 320;
    if (e.shieldOn && shieldSideFor(e, me) === e.shieldSide) score -= 260;

    if (score > bestTargetScore) {
      bestTargetScore = score;
      targetEnemy = e;
    }
  }

  // Opportunistic bomb detonation next to an enemy
  let bombTrapTarget = null;
  if (!trackerToSnipe && targetEnemy) {
    for (const b of view.bombs) {
      const blastR = b.kind === 'tracker' ? 170 : 240;
      if (
        distance(b, targetEnemy) < blastR - 15 &&
        distance(me, b) > blastR + 45 &&
        distance(me, b) < 1100 &&
        lineOfSight(view, me, b)
      ) {
        bombTrapTarget = b;
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. WEAPON SYSTEMS (With Strict 30+ Energy Reserve for Shielding)
  // --------------------------------------------------------------------------
  let fire = false;
  let useTracker = false;
  let useMine = false;
  let useShockwave = false;
  let aimPoint = null;
  let canDamageTarget = false;
  let wantToAimNow = false;

  const priorityBomb = trackerToSnipe || bombTrapTarget;

  if (priorityBomb && hasWeapon('gun')) {
    const bombLead = leadTarget(me, priorityBomb, BULLET_SPEED) || priorityBomb;
    aimPoint = bombLead;
    canDamageTarget = true;
    wantToAimNow = !shield && me.gunCooldown <= 3 && me.energy >= 15;
    const aimAngle = angleTo(me, aimPoint);
    if (
      !shield &&
      me.gunCooldown === 0 &&
      me.energy >= 15 &&
      Math.abs(angleDiff(me.angle, aimAngle)) < 0.15
    ) {
      fire = true;
    }
    debug.push({ type: 'line', x: me.x, y: me.y, x2: aimPoint.x, y2: aimPoint.y, color: '#ff00ff' });
  } else if (targetEnemy && hasWeapon('gun')) {
    const memE = memory.enemies[targetEnemy.id];
    const smoothedTarget =
      memE && !targetEnemy.dashing && !targetEnemy.spinning
        ? { x: targetEnemy.x, y: targetEnemy.y, vx: memE.svx, vy: memE.svy }
        : targetEnemy;

    const lead = leadTarget(me, smoothedTarget, BULLET_SPEED);
    if (lead && lead.time * BULLET_SPEED < BULLET_RANGE * 0.94) {
      aimPoint = lead;
      const aimAngle = angleTo(me, aimPoint);

      const rayHit = raycast(view, me.x, me.y, aimPoint.x, aimPoint.y);
      const pathClear = !rayHit || rayHit.distance > distance(me, aimPoint) - 15;

      const enemyShieldBlocks =
        targetEnemy.shieldOn &&
        !targetEnemy.spinning &&
        shieldSideFor(targetEnemy, me) === targetEnemy.shieldSide;

      canDamageTarget = pathClear && !enemyShieldBlocks;

      const distToAim = Math.max(distance(me, aimPoint), 80);
      const hitTolerance = clamp(Math.atan2(24, distToAim), 0.06, 0.18);

      // CRITICAL FIX: Keep 40 energy before firing so we have >=30 energy left AFTER the 10-energy shot!
      // Only dip below 40 if enemy is 1-2 shots from death or spinning out of control.
      const minGunEnergy = targetEnemy.hp <= 12 || targetEnemy.spinning ? 12 : 40;

      // Only snap nose to aim when gun is nearly off cooldown AND we have energy to shoot
      wantToAimNow = canDamageTarget && !shield && me.gunCooldown <= 4 && me.energy >= minGunEnergy;

      if (
        wantToAimNow &&
        me.gunCooldown === 0 &&
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

  // Secondary Weapon: Tracker
  if (hasWeapon('tracker') && getAmmo('tracker') > 0 && getWeaponCD('tracker') === 0) {
    const backX = me.x - Math.cos(me.angle) * 90;
    const backY = me.y - Math.sin(me.angle) * 90;
    const backBlocked = raycast(view, me.x, me.y, backX, backY);
    if (!backBlocked) {
      const distToEnemy = targetEnemy ? distance(me, targetEnemy) : Infinity;
      const ammoCount = getAmmo('tracker');
      if (
        (targetEnemy && distToEnemy < 1350 && distToEnemy > 170) ||
        (ammoCount >= 3 && Object.keys(memory.enemies).length > 0)
      ) {
        useTracker = true;
      }
    }
  }

  // Optional Weapon Support: Shockwave & Mine
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

  if (hasWeapon('mine') && getAmmo('mine') > 0 && getWeaponCD('mine') === 0 && targetEnemy) {
    const d = distance(me, targetEnemy);
    const angleToE = angleTo(me, targetEnemy);
    if (d < 480 && Math.abs(angleDiff(me.angle, angleToE)) > Math.PI * 0.6) {
      useMine = true;
    }
  }

  // --------------------------------------------------------------------------
  // 5. CONTINUOUS STRAFE & ORBIT VELOCITY (Fixes Standing-Still Stalemate)
  // --------------------------------------------------------------------------
  const maxSpd = me.maxSpeed || 360;
  const mySpeed = Math.hypot(me.vx, me.vy);
  const center = view.pigZone || { x: view.arena.width / 2, y: view.arena.height / 2, radius: 700 };

  let desVx = 0;
  let desVy = 0;
  let stateText = 'PATROL';

  const pigSoon = !view.pig && view.pigRespawnIn > 0 && view.pigRespawnIn < 210;

  if (view.pig) {
    const pigGoal = {
      x: view.pig.x + (view.pig.vx || 0) * 0.3,
      y: view.pig.y + (view.pig.vy || 0) * 0.3
    };
    const ang = angleTo(me, pigGoal);
    desVx = Math.cos(ang) * maxSpd;
    desVy = Math.sin(ang) * maxSpd;
    stateText = '🐷 CLAIM PIG';

    const pigDist = distance(me, view.pig);
    if (
      !dash &&
      !me.dashing &&
      me.dashCooldown === 0 &&
      me.energy >= 55 &&
      pigDist < 320 &&
      pigDist > 60 &&
      !raycast(view, me.x, me.y, view.pig.x, view.pig.y)
    ) {
      dash = angleTo(me, view.pig);
    }
  } else if (pigSoon && (!targetEnemy || me.hp <= 70 || distance(me, center) < 1200)) {
    const ang = angleTo(me, center);
    const spd = clamp(distance(me, center) * 1.2, 160, maxSpd);
    desVx = Math.cos(ang) * spd;
    desVy = Math.sin(ang) * spd;
    stateText = '🐷 STAGE PIG';
  } else if (targetEnemy) {
    const d = distance(me, targetEnemy);
    const enemyHasShockwave =
      Array.isArray(targetEnemy.loadout) && targetEnemy.loadout.includes('shockwave');

    let desiredRange = enemyHasShockwave ? 520 : 430;
    if (me.energy < 38 && !targetEnemy.spinning) desiredRange = 600;
    if (targetEnemy.spinning || targetEnemy.hp <= 18) desiredRange = 260;

    const angleToE = angleTo(me, targetEnemy);

    // If enemy has shield up, force strafe direction toward their UNSHIELDED side
    if (targetEnemy.shieldOn) {
      const angleFromEnemyToMe = angleTo(targetEnemy, me);
      const shieldCenter =
        targetEnemy.shieldSide === 'back'
          ? normalizeAngle(targetEnemy.angle + Math.PI)
          : targetEnemy.angle;
      const diff = angleDiff(shieldCenter, angleFromEnemyToMe);
      memory.strafeDir = diff >= 0 ? 1 : -1;
    }

    // Combine Radial speed (distance control) + Tangential speed (constant lateral strafing!)
    const radialError = d - desiredRange;
    const radialSpd = clamp(radialError * 1.6, -maxSpd * 0.9, maxSpd * 0.9);
    const tangentSpd = memory.strafeDir * maxSpd * 0.85;

    const tangentAngle = angleToE + (Math.PI / 2);
    desVx = Math.cos(angleToE) * radialSpd + Math.cos(tangentAngle) * tangentSpd;
    desVy = Math.sin(angleToE) * radialSpd + Math.sin(tangentAngle) * tangentSpd;

    // ANTI-STALEMATE TRIGGER: If our ship slows down below 145 px/s in combat,
    // force a 12-tick Strafe Burst so we never sit stationary trading shots!
    if (mySpeed < 145 && view.tick >= memory.strafeBurstUntil) {
      memory.strafeBurstUntil = view.tick + 12;
      // If we have abundant energy, use a sideways/diagonal dash to instantly break stalemate
      if (!dash && !me.dashing && me.dashCooldown === 0 && me.energy >= 65 && d < 650) {
        dash = Math.atan2(desVy, desVx);
      }
    }

    stateText = view.tick < memory.strafeBurstUntil ? '⚡ STRAFE' : 'ENGAGE';
  } else {
    // Hunt last seen enemy in memory or orbit center
    let freshest = null;
    for (const id in memory.enemies) {
      const m = memory.enemies[id];
      if (!freshest || m.tick > freshest.tick) freshest = m;
    }
    if (freshest && view.tick - freshest.tick < 150) {
      const dtSeen = (view.tick - freshest.tick) * DT;
      const huntPos = {
        x: clamp(freshest.x + freshest.vx * dtSeen, 500, view.arena.width - 500),
        y: clamp(freshest.y + freshest.vy * dtSeen, 500, view.arena.height - 500)
      };
      const ang = angleTo(me, huntPos);
      desVx = Math.cos(ang) * maxSpd;
      desVy = Math.sin(ang) * maxSpd;
      stateText = 'HUNT MEMORY';
    } else {
      const curAngle = angleTo(center, me);
      const orbitGoal = {
        x: center.x + Math.cos(curAngle + 0.65) * 520,
        y: center.y + Math.sin(curAngle + 0.65) * 520
      };
      const ang = angleTo(me, orbitGoal);
      desVx = Math.cos(ang) * (maxSpd * 0.85);
      desVy = Math.sin(ang) * (maxSpd * 0.85);
    }
  }

  // --------------------------------------------------------------------------
  // 6. ASTEROID, WALL & RAMMING REPULSION
  // --------------------------------------------------------------------------
  desVx += (urgentEvadeVec.x + dodgeBulletVec.x) * maxSpd * 0.9;
  desVy += (urgentEvadeVec.y + dodgeBulletVec.y) * maxSpd * 0.9;

  let collisionEmergency = false;
  let emergencyEscapeAngle = 0;

  for (const a of view.asteroids) {
    const d = distance(me, a);
    const safeRadius = (a.radius || 45) + 95;
    if (d < safeRadius + 260) {
      const futRx = me.x + me.vx * 0.45 - (a.x + (a.vx || 0) * 0.45);
      const futRy = me.y + me.vy * 0.45 - (a.y + (a.vy || 0) * 0.45);
      const futDist = Math.hypot(futRx, futRy);

      if (futDist < safeRadius || d < safeRadius) {
        const pushAngle = Math.atan2(futRy, futRx);
        const severity = clamp((safeRadius - Math.min(d, futDist)) / safeRadius, 0.25, 2.2);
        desVx += Math.cos(pushAngle) * maxSpd * severity * 1.9;
        desVy += Math.sin(pushAngle) * maxSpd * severity * 1.9;

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

  for (const e of view.enemies) {
    const d = distance(me, e);
    if (d < 165) {
      const away = angleTo(e, me);
      const push = clamp((165 - d) / 165, 0.35, 1.6);
      desVx += Math.cos(away) * maxSpd * push * 1.7;
      desVy += Math.sin(away) * maxSpd * push * 1.7;
    }
  }

  const wallMargin = 480;
  if (me.x < wallMargin) {
    desVx += ((wallMargin - me.x) / wallMargin) * maxSpd * 2.4;
    memory.strafeDir = 1;
  } else if (me.x > view.arena.width - wallMargin) {
    desVx -= ((me.x - (view.arena.width - wallMargin)) / wallMargin) * maxSpd * 2.4;
    memory.strafeDir = -1;
  }
  if (me.y < wallMargin) {
    desVy += ((wallMargin - me.y) / wallMargin) * maxSpd * 2.4;
  } else if (me.y > view.arena.height - wallMargin) {
    desVy -= ((me.y - (view.arena.height - wallMargin)) / wallMargin) * maxSpd * 2.4;
  }

  const desMag = Math.hypot(desVx, desVy);
  if (desMag > maxSpd) {
    desVx = (desVx / desMag) * maxSpd;
    desVy = (desVy / desMag) * maxSpd;
  }

  const dvx = desVx - me.vx;
  const dvy = desVy - me.vy;
  const dvMag = Math.hypot(dvx, dvy);
  const thrustAngle = Math.atan2(dvy, dvx);

  if (collisionEmergency && !dash && !me.dashing && me.dashCooldown === 0 && me.energy >= 25) {
    dash = emergencyEscapeAngle;
  }

  // --------------------------------------------------------------------------
  // 7. NOSE ANGLE & THRUST ARBITRATION (Strafe-and-Snap-Shot Rhythm)
  // --------------------------------------------------------------------------
  let desiredNoseAngle = thrustAngle;
  let thrust = 0;

  const urgentWallOrRock =
    collisionEmergency ||
    Math.hypot(urgentEvadeVec.x, urgentEvadeVec.y) > 1.2 ||
    me.x < 250 ||
    me.x > view.arena.width - 250 ||
    me.y < 250 ||
    me.y > view.arena.height - 250;

  const inStrafeBurst =
    view.tick < memory.strafeBurstUntil &&
    (!targetEnemy || (targetEnemy.hp > 12 && !targetEnemy.spinning));

  const tooCloseKite =
    targetEnemy &&
    distance(me, targetEnemy) < 275 &&
    targetEnemy.hp > 18 &&
    !targetEnemy.spinning;

  if (shieldTurnOverride !== null) {
    // Priority 1: Rotate shield arc over a side-approaching bullet/bomb
    desiredNoseAngle = shieldTurnOverride;
    const align = Math.cos(angleDiff(me.angle, thrustAngle));
    thrust = align > 0.2 ? clamp(align, 0, 1) : 0.3;
    stateText = '🛡️ SHIELD ALIGN';
  } else if (urgentWallOrRock || tooCloseKite || inStrafeBurst) {
    // Priority 2: Evasion, kiting, or anti-stalemate strafe boost
    desiredNoseAngle = thrustAngle;
    const align = Math.cos(angleDiff(me.angle, desiredNoseAngle));
    thrust = align > 0.15 ? clamp(align * 1.2, 0.3, 1) : 0;
  } else if (aimPoint && wantToAimNow) {
    // Priority 3: Snap-Aim Window (Gun is ready, energy >= 40, and we already have velocity!)
    desiredNoseAngle = angleTo(me, aimPoint);

    // Keep moving! If thrusting forward helps our desired velocity OR if we are at safe range
    // and moving somewhat slow, apply forward thrust so we spiral rather than stopping dead.
    const forwardProj = (dvx * Math.cos(me.angle) + dvy * Math.sin(me.angle)) / Math.max(maxSpd, 1);
    if (forwardProj > 0.05) {
      thrust = clamp(forwardProj * 1.5, 0.25, 1);
    } else if (targetEnemy && distance(me, targetEnemy) > 340 && mySpeed < 210) {
      thrust = 0.5;
    } else {
      thrust = 0;
    }
  } else {
    // Priority 4: Between shots (gunCooldown > 4) or recharging energy -> Thrust along strafe vector!
    desiredNoseAngle = thrustAngle;
    const align = Math.cos(angleDiff(me.angle, desiredNoseAngle));
    if (dvMag > 20 && align > 0.15) {
      thrust = clamp((dvMag / 150) * align, 0.25, 1);
    }
  }

  debug.push({
    type: 'line',
    x: me.x,
    y: me.y,
    x2: me.x + desVx * 0.4,
    y2: me.y + desVy * 0.4,
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