// @name Spinner
// @color #f7d154
// The simplest bot possible: sit still, spin, and shoot whenever an enemy is roughly ahead.
// A good punching bag for testing.
function think(view, memory) {
  const me = view.self;
  let fire = false;
  for (const enemy of view.enemies) {
    const off = Math.abs(angleDiff(me.angle, angleTo(me, enemy)));
    if (off < 0.12 && lineOfSight(view, me, enemy)) fire = true;
  }
  return { thrust: 0, turn: 0.35, fire, pigStat: 'hp' };
}
