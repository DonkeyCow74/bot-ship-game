// @name Spinner
// @color #f7d154
// The simplest bot possible: sit still, spin, shoot whenever an enemy is roughly ahead,
// and send a tracker after anyone it can see. A good punching bag for testing.
const loadout = ['gun', 'tracker'];

function think(view, memory) {
  const me = view.self;
  let fire = false;
  for (const enemy of view.enemies) {
    const off = Math.abs(angleDiff(me.angle, angleTo(me, enemy)));
    if (off < 0.12 && lineOfSight(view, me, enemy)) fire = true;
  }
  return { thrust: 0, turn: 0.35, fire, tracker: view.enemies.length > 0, pigStat: 'hp' };
}
