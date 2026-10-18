# How to build a bot

Your bot is one JavaScript function, `think(view, memory)`. The game calls it **30 times a second**, and each time it tells your ship what to do. Every bot gets exactly the same ship, the same information and the same helper functions. The only difference between bots is the strategy.

## Quick start

1. Open the **Bot Lab** tab and click **＋ New bot**. You get a simple bot that already works.
2. Change something, then click **⚔ Fight!** to try it against a sample bot.
3. In the Arena, click your ship's card to follow it. Tick **Show what the followed ship can see** and **Show bot debug drawings** to see the fight through your bot's eyes.
4. When you're happy with it, use **🔗 Copy share link** or **⬇ Download** to send it to your friends. They can open the link, or upload the file in their Bot Lab.
5. Use the **Tournament** tab to run lots of matches and find out whose bot is really best.

```js
function think(view, memory) {
  const me = view.self;
  const enemy = view.enemies[0];
  if (!enemy) return { thrust: 0.5, turn: turnToward(me, angleTo(me, view.pigZone)) };

  const aim = leadTarget(me, enemy, view.constants.BULLET_SPEED) || enemy;
  return {
    turn: turnToward(me, angleTo(me, aim)),
    fire: Math.abs(angleDiff(me.angle, angleTo(me, aim))) < 0.1,
  };
}
```

## What your bot returns

Return an object. Every field is optional, and a missing field means "off" or "0".

| Field | Type | What it does |
|---|---|---|
| `thrust` | 0 to 1 | Forward engine power. Ships only thrust forward, so to stop you turn around and burn. |
| `turn` | -1 to 1 | Turn speed. Positive turns clockwise on screen (angle goes up), negative turns counter-clockwise. |
| `fire` | true/false | Shoot the forward cannon. It costs energy, has a cooldown, and doesn't work while your shield is up. |
| `bomb` | true/false | Drop a bomb behind you (3 per match). |
| `shield` | `'front'`, `'back'` or `false` | Hold up a shield on the front or back of your ship. Raising it costs a big chunk of energy, and keeping it up drains more. (`true` means `'front'`.) |
| `saw` | true/false | Spin the saw blade on your nose. It shreds ships and asteroids it touches and drains energy while it spins. |
| `dash` | true/false | Burst forward at high speed for a moment. Costs energy, then has a cooldown. |
| `pigStat` | `'hp'`, `'energy'` or `'speed'` | Which upgrade you get if you eat the pig this tick. Defaults to `'hp'`. |
| `debug` | array | Shapes drawn on screen so you can see what your bot is thinking (see below). |

Anything invalid gets fixed or ignored: numbers are clamped and junk is dropped. You can't break the game, only your own bot.

## What your bot sees: `view`

Coordinates are in pixels. `x` goes right and `y` goes **down**. Angles are radians, where `0` points right and `Math.PI / 2` points down. The arena is 6000 × 6000.

### `view.self`: your ship (always fully known)

| Field | Meaning |
|---|---|
| `x, y, vx, vy` | Position and velocity (px/s) |
| `angle` | The direction the nose points (radians) |
| `hp, maxHp` | Health (starts at 100) |
| `energy, maxEnergy` | Energy for shooting and shields (starts at 100, regenerates) |
| `maxSpeed, thrustAccel` | Your current top speed and engine power (pig upgrades raise these) |
| `bombs` | Bombs left |
| `gunCooldown, bombCooldown` | Ticks until you can shoot or bomb again |
| `shieldOn, shieldSide` | Is your shield up, and which side (`'front'`/`'back'`, or `null`)? |
| `sawOn` | Is your saw spinning? |
| `dashing, dashCooldown` | Are you mid-dash? How many ticks until you can dash again? |
| `upgrades` | `{hp, energy, speed}`: how many pigs you've spent on each |
| `id, name` | Your ship's number and name |

### `view.enemies`: ships you can see

Your sensors reach **1500 px**, and asteroids block line of sight. You only see an enemy if it's in range **and** the straight line from you to its center doesn't touch an asteroid. Each enemy is `{id, name, x, y, vx, vy, angle, hp, maxHp, shieldOn, shieldSide, sawOn, dashing, upgrades}`.

> Enemies you can't see simply aren't in the list. Use `memory` to remember where you last saw someone.

### Everything else

| Field | Meaning |
|---|---|
| `view.asteroids` | Every asteroid within sensor range (radar sees through rock): `{id, x, y, vx, vy, radius, size, hitsLeft}`. `size` is 2 for large, 1 for medium and 0 for small. |
| `view.bullets` | Bullets you can see: `{x, y, vx, vy, mine, ticksLeft}` |
| `view.bombs` | Your own bombs, plus enemy bombs within **600 px** and in line of sight (bombs are stealthy): `{x, y, vx, vy, mine, armed, ticksUntilFuse}` |
| `view.pig` | `{x, y, vx, vy}` when a pig is out, otherwise `null`. Everyone can always see the pig. |
| `view.pigRespawnIn` | Ticks until the next pig (0 if one is out right now) |
| `view.pigZone` | `{x, y, radius}`: the open circle in the middle with no asteroids |
| `view.arena` | `{width, height}` |
| `view.tick` / `view.ticksLeft` | The current tick, and how many are left (30 ticks = 1 second, matches last 3 minutes) |
| `view.shipsAlive` | How many ships are still flying, including you |
| `view.constants` | Every game number (bullet speed, damage, ranges…). Use these instead of typing numbers in. |

## `memory`

`memory` starts as an empty object `{}` and stays the same object for the whole match, so you can store things in it:

```js
if (!memory.lastSeen) memory.lastSeen = {};
for (const e of view.enemies) memory.lastSeen[e.id] = { x: e.x, y: e.y, tick: view.tick };
```

## Helper functions

Every bot can call these directly:

| Helper | What it does |
|---|---|
| `angleTo(a, b)` | Angle from point `a` to point `b` |
| `distance(a, b)` | Distance between two points |
| `angleDiff(from, to)` | Smallest signed turn between two angles (-π to π) |
| `normalizeAngle(a)` | Wraps an angle into -π to π |
| `turnToward(self, angle)` | A `turn` value that rotates you toward `angle` and eases off as you line up |
| `leadTarget(shooter, target, bulletSpeed)` | The point to aim at so a bullet hits a moving target: `{x, y, time}` or `null` |
| `raycast(view, x1, y1, x2, y2)` | The first visible asteroid blocking that line: `{asteroid, distance}` or `null` |
| `lineOfSight(view, a, b)` | `true` if no visible asteroid blocks the line from `a` to `b` |
| `shieldSideFor(self, point)` | `'front'` or `'back'`: whichever shield side would block a hit coming from `point`. Returns `null` if it's coming from the side, where neither shield reaches |
| `predict(obj, seconds)` | Where something will be if it keeps drifting |
| `clamp(v, lo, hi)` | Keeps a number between `lo` and `hi` |

`Math.random()` works, but it's seeded, so a match with the same seed plays out the same way every time. That's what makes replays work.

## Debug drawings

Return a `debug` array to draw on the map (up to 200 shapes per tick). Turn on **Show bot debug drawings** in the Arena to see them.

```js
debug: [
  { type: 'line', x: me.x, y: me.y, x2: aim.x, y2: aim.y, color: '#ff0' },
  { type: 'circle', x: spot.x, y: spot.y, r: 30, color: '#0ff' },
  { type: 'text', x: me.x, y: me.y - 40, text: 'hunting', color: '#fff' },
]
```

`console.log()` works too, and prints to the **Bot console** in the Arena (up to 5 lines per tick).

## The rules

### Ships
- 100 HP, 100 energy. Energy regenerates at 14/s, but not while the shield is up.
- Space has a little drag (you slowly coast to a stop). Top speed is 360 px/s.
- Ramming walls, asteroids or other ships hurts if you hit faster than 120 px/s, and the faster you hit the more it hurts. In ship-vs-ship crashes, both ships take damage.

### Gun
- Bullets fly at 720 px/s **plus your ship's velocity**, go up to 1400 px, and do 6 damage.
- Each shot costs 10 energy. You can shoot up to about 4 times a second.
- Bullets hit asteroids, ships and bombs. Shooting a bomb sets it off.

### Bombs
- 3 per match. They drop behind you and drift slowly.
- A bomb **arms after 1 second**. After that, an enemy ship within 130 px sets it off, and it explodes by itself after 20 seconds.
- The blast (240 px) does up to 45 damage to **every** ship in range, including yours, so get clear! It also breaks asteroids and sets off other bombs.

### Shield
- The shield covers a **120° arc** on either the **front** or the **back** of your ship, never both. It blocks 100% of hits coming from inside that arc. Hits from the sides get through.
- **Raising it costs 20 energy up front**, then 20 energy/s while it's up. You need at least 30 energy to raise it, so use it wisely. Holding the shield button down nonstop just burns energy. Flipping it between front and back while it's up is free.
- While it's up you can't shoot or regenerate energy. It drops when energy hits 0.
- Enemies can see your shield and which side it's on (`enemy.shieldOn`, `enemy.shieldSide`). Hit them from the other side!

### Saw
- A spinning blade just past your nose. Its reach is tiny, about one ship-width past your nose, so you have to get right up close.
- It does **45 damage per second** to any ship touching the blade. Grinding an asteroid for 0.35 s counts as one hit.
- It drains **15 energy/s** while spinning, and you don't regenerate energy meanwhile. It stops when energy runs out.
- You can't use it with your shield up, and a shield facing the blade blocks it.

### Dash
- It bursts you forward to **750 px/s** (about twice top speed) for 0.3 s, then you ease back down to normal speed.
- It costs **25 energy**, and then you have to wait **3 seconds** before dashing again.
- It only goes the way your nose points, so turn first. Good for dodging, closing in, or escaping.
- Careful: crashing into something at dash speed hurts you, and the other ship takes damage too.

### Asteroids
- Large ones break into 2 medium, medium into 2 small, and small ones crumble to nothing.
- **Each stage takes 3 hits.** A bomb blast breaks a stage instantly.
- They drift, spin, bounce off walls and each other, and block line of sight.

### The pig 🐷
- A pig appears in the middle of the map at the start, inside an open circle (700 px radius) where asteroids can't go. There's nowhere to hide while you go for it.
- Touch it to eat it and gain **+40 max HP** (and heal 40), **+40 max energy**, or **+40% speed** (top speed and engine power). Pick with `pigStat`.
- **A new pig appears 60 seconds after the last one was eaten.** Upgrades stack.

### Winning
- The last ship flying wins.
- After 3 minutes, the ship with the most HP wins. A tie is a draw.
- Kills go to whoever damaged the victim within the last 5 seconds (so knocking someone into a rock counts).

## Fair play

- Each bot runs in its own sandbox (a Web Worker). It can't see the page, the real game state, other bots or the internet. **The only thing it ever gets is its own `view`.**
- **Time limit:** if `think()` takes longer than 20 ms, your ship gets no input that tick. If it doesn't answer for 3 seconds (say, an infinite loop), it's shut down and your ship drifts helplessly.
- If your code crashes, that tick counts as "do nothing" and the error shows up in the Bot console.

## Strategy ideas

- **Dodge:** check `view.bullets` for enemy shots heading your way and sidestep them, or raise the shield on the side the shot is coming from (`shieldSideFor(me, bullet)`) just before it hits.
- **Use cover:** put an asteroid between you and the enemy, and they can't see (or aim at) you.
- **Bait bombs:** run away, drop a bomb, and lead your chaser over it.
- **Pig timing:** the open middle is dangerous. Grab the pig when enemies are busy or far away. `view.pigRespawnIn` tells you when the next one appears.
- **Close quarters:** the saw out-damages the gun up close, but you have to stay right on top of your target. Dash in, saw, dash out.
- **Energy management:** shooting, shielding, sawing and dashing all share one energy pool. Don't empty it right before a fight.
- **Remember enemies:** they disappear behind rocks, so track where they went with `memory`.

## Running it yourself

The game is a plain static website with no build step and no server code.

- **Play locally:** in the game folder run `python3 -m http.server`, then open http://localhost:8000
- **Quick fights in the terminal:** `node tools/fight.js bots/hunter.js my-bot.js --rounds 20` (Node 18+). It runs without the sandbox, so only use it on bots you trust.
- **Tests:** `npm test`
- **Hosting:** copy the whole folder to any web host (for example `ruybalid.com/ships/`). All paths are relative.
