# How to build a bot

Your bot is one JavaScript function, `think(view, memory)`. The game calls it **30 times a second**, and each time it tells your ship what to do. Every bot gets exactly the same ship, the same information and the same helper functions. The only difference between bots is the strategy.

## Quick start

1. Open the **Bot Lab** tab and click **＋ New bot**. You get a simple bot that already works.
2. Change something, then click **⚔ Fight!** to try it against a sample bot.
3. In the Arena, click your ship's card to follow it. Tick **Show what the followed ship can see** and **Show bot debug drawings** to see the fight through your bot's eyes.
4. When you're happy with it, use **🔗 Copy share link** or **⬇ Download** to send it to your friends. They can open the link, or upload the file in their Bot Lab.
5. Use the **Tournament** tab to run lots of matches and find out whose bot is really best.

```js
const loadout = ['gun', 'tracker'];   // your 2 weapons

function think(view, memory) {
  const me = view.self;
  const enemy = view.enemies[0];
  if (!enemy) return { thrust: 0.5, turn: turnToward(me, angleTo(me, view.pigZone)) };

  const aim = leadTarget(me, enemy, view.constants.BULLET_SPEED) || enemy;
  return {
    turn: turnToward(me, angleTo(me, aim)),
    fire: Math.abs(angleDiff(me.angle, angleTo(me, aim))) < 0.1,
    tracker: true, // sends a tracker whenever we have a charge
  };
}
```

## Pick your loadout: 2 weapons

There are 4 weapons, and **each bot carries exactly 2**. Choose them with a `loadout` line at the top of your bot:

```js
const loadout = ['gun', 'tracker'];
```

| Weapon | Command | What it does |
|---|---|---|
| 🔫 `gun` | `fire: true` | Forward cannon. Unlimited shots, but each one costs energy. |
| 💣 `mine` | `mine: true` | Drops a stealthy mine behind you that waits for an enemy to come close. |
| 🚀 `tracker` | `tracker: true` | Drops a bomb behind you that chases the nearest enemy after 1 second. |
| 💥 `shockwave` | `shockwave: true` | Blasts every enemy near you: damage, knockback, and they spin out of control. |

- **Charges:** mines, trackers and shockwaves start with **1 charge** and gain **1 more every 15 seconds**, up to 3 stored. Each one also has a 1 second cooldown between uses.
- If you leave out `loadout`, you get `['gun', 'mine']`. A weapon you didn't pick does nothing if your bot tries to use it.
- Everyone can see each other's loadout (`enemy.loadout`), so plan around it.
- The shield and the dash aren't weapons: every bot has them.

## What your bot returns

Return an object. Every field is optional, and a missing field means "off" or "0".

| Field | Type | What it does |
|---|---|---|
| `thrust` | 0 to 1 | Forward engine power. Ships only thrust forward, so to stop you turn around and burn. |
| `boost` | true/false | Afterburner: hold it for extra push and 1.5× top speed. It burns energy while it's on. |
| `turn` | -1 to 1 | Turn speed. Positive turns clockwise on screen (angle goes up), negative turns counter-clockwise. |
| `fire` | true/false | Shoot the gun (if it's in your loadout). It costs energy, has a cooldown, and doesn't work while your shield is up. |
| `mine` | true/false | Drop a mine behind you (if it's in your loadout). `bomb: true` also works. |
| `tracker` | true/false | Drop a tracker behind you (if it's in your loadout). |
| `shockwave` | true/false | Set off a shockwave around you (if it's in your loadout). |
| `shield` | `'front'`, `'back'` or `false` | Hold up a shield on the front or back of your ship. Raising it costs a big chunk of energy, and keeping it up drains more. (`true` means `'front'`.) |
| `dash` | `'forward'`, `'back'`, `'left'`, `'right'`, a number, or `false` | Burst in that direction at high speed for a moment. A number is an exact map angle (e.g. `angleTo(enemy, me)` to dash straight away from an enemy). `true` means `'forward'`. Costs energy, then has a cooldown. |
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
| `loadout` | Your 2 weapons, e.g. `['gun', 'tracker']` |
| `ammo` | Charges left for your charge weapons, e.g. `{tracker: 1}` |
| `ammoRecharge` | Ticks until each charge weapon gets its next charge |
| `weaponCooldown` | Ticks until each charge weapon can be used again |
| `gunCooldown` | Ticks until you can shoot again |
| `shieldOn, shieldSide` | Is your shield up, and which side (`'front'`/`'back'`, or `null`)? |
| `boosting` | Is your afterburner on? |
| `spinning` | Are you spinning out from a shockwave? (Steering doesn't work until it stops.) |
| `dashing, dashCooldown` | Are you mid-dash? How many ticks until you can dash again? |
| `upgrades` | `{hp, energy, speed}`: how many pigs you've spent on each |
| `id, name` | Your ship's number and name |

### `view.enemies`: ships you can see

Your sensors reach **1500 px**, and asteroids block line of sight. You only see an enemy if it's in range **and** the straight line from you to its center doesn't touch an asteroid. Each enemy is `{id, name, x, y, vx, vy, angle, hp, maxHp, shieldOn, shieldSide, dashing, boosting, spinning, loadout, upgrades}`.

> Enemies you can't see simply aren't in the list. Use `memory` to remember where you last saw someone.

### Everything else

| Field | Meaning |
|---|---|
| `view.asteroids` | Every asteroid within sensor range (radar sees through rock): `{id, x, y, vx, vy, radius, size, hitsLeft}`. `size` is 2 for large, 1 for medium and 0 for small. |
| `view.bullets` | Bullets you can see: `{x, y, vx, vy, own, ticksLeft}`. `own` is true for yours (`mine` also works). |
| `view.bombs` | Mines and trackers: `{kind, own, x, y, vx, vy, armed, ticksUntilFuse}`. `kind` is `'mine'` or `'tracker'`, and `own` is true for yours. Trackers also have `heading`, `speed`, `chasingMe`, and `hp` (bullets left to destroy it). You always see your own. Enemy trackers show up like ships (in range and in line of sight), but enemy mines are stealthy: you only see them within **600 px**. |
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
- 100 HP, 100 energy. Energy regenerates at 14/s, but not while the shield or boost is on.
- Space has a little drag (you slowly coast to a stop). Top speed is 360 px/s (540 while boosting).
- Ships turn at up to 5 radians per second, about a full circle in 1.3 seconds.
- Ramming walls, asteroids or other ships hurts if you hit faster than 120 px/s, and the faster you hit the more it hurts. In ship-vs-ship crashes, both ships take damage.

### 🔫 Gun
- Bullets fly at 720 px/s **plus your ship's velocity**, go up to 1400 px, and do 6 damage.
- Each shot costs 10 energy. You can shoot up to about 4 times a second.
- Bullets hit asteroids, ships, mines and trackers. One bullet sets off a mine, and a tracker takes two.

### 💣 Mine
- It drops behind you and drifts to a stop. It **arms after 1 second**. After that, an enemy ship within 130 px sets it off, and it explodes by itself after 20 seconds.
- The blast (240 px) does up to **45 damage** to **every** ship in range, including yours, so get clear! It also breaks asteroids and sets off other mines and trackers.
- Enemies only see your mines within 600 px, so they're good traps.

### 🚀 Tracker
- It drops behind you. After **1 second** it locks onto the **nearest enemy** and chases it. If that enemy dies, it picks a new one.
- It **starts slow and speeds up** (up to 460 px/s, faster than a normal ship), but it **turns slowly** (about a third as fast as a ship), so sharp turns and dashes can shake it off. Make it run into an asteroid!
- It explodes when it gets within 45 px of an enemy, or when it hits an asteroid or a wall. The blast is 170 px for up to **35 damage**, and like a mine it hurts everyone in range.
- **It takes 2 bullets to shoot down.** The second one blows it up where it is. It explodes by itself 15 seconds after it was dropped.

### 💥 Shockwave
- A blast all around you, reaching ships within **220 px** of you.
- Each enemy it reaches takes **20 damage**, gets **knocked away**, and **spins out of control for 0.8 s**: their steering does nothing until it stops. Great for setting up shots.
- It also counts as one hit on nearby asteroids.
- A shield facing you blocks the damage and the spin, but the shielded ship still gets pushed.

### Shield
- The shield covers a **120° arc** on either the **front** or the **back** of your ship, never both. It blocks 100% of hits coming from inside that arc. Hits from the sides get through.
- **Raising it costs 20 energy up front**, then 20 energy/s while it's up. You need at least 30 energy to raise it, so use it wisely. Holding the shield button down nonstop just burns energy. Flipping it between front and back while it's up is free.
- While it's up you can't shoot or regenerate energy. It drops when energy hits 0.
- Enemies can see your shield and which side it's on (`enemy.shieldOn`, `enemy.shieldSide`). Hit them from the other side!

### Boost
- Hold `boost: true` for an afterburner: extra forward push on top of your thrust, and **1.5× top speed** while it's on.
- It burns **30 energy/s**, and you don't regenerate energy while boosting. You need at least 10 energy to start, then it runs until you let go or run dry.
- When you stop, you ease back down to normal top speed.
- Unlike the dash, it lasts as long as you have energy, but only pushes the way your nose points.

### Dash
- It bursts you to **750 px/s** (about twice top speed) for 0.3 s in **any direction**, then you ease back to normal speed.
  - `'forward'`, `'back'`, `'left'` and `'right'` are relative to where your nose points. Left means counter-clockwise on screen.
  - A number is an exact direction on the map, in radians.
- You don't need to turn first: dash sideways to dodge a bullet, or backward to escape while still aiming at the enemy.
- It costs **25 energy**, and then you have to wait **3 seconds** before dashing again.
- Careful: crashing into something at dash speed hurts you, and the other ship takes damage too.

### Asteroids
- Large ones break into 2 medium, medium into 2 small, and small ones crumble to nothing.
- **Each stage takes 3 hits.** A mine or tracker blast breaks a stage instantly.
- They drift, spin, bounce off walls and each other, and block line of sight.

### The pig 🐷
- A pig appears in the middle of the map, inside an open circle (700 px radius) where asteroids can't go. There's nowhere to hide while you go for it.
- Touch it to eat it and gain **+40 max HP** (and heal 40), **+40 max energy**, or **+40% speed** (top speed and engine power). Pick with `pigStat`.
- **The first pig appears 10 seconds into the match, and a new one appears 30 seconds after each is eaten.** Upgrades stack.

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
- **Bait mines:** run away, drop a mine, and lead your chaser over it.
- **Beat trackers:** shoot them, make them crash into an asteroid, or turn hard (they turn much slower than you).
- **Pig timing:** the open middle is dangerous. Grab the pig when enemies are busy or far away. `view.pigRespawnIn` tells you when the next one appears.
- **Close quarters:** a shockwave spins the enemy out of control. Dash in, blast them, then shoot them while they tumble.
- **Loadout counters:** a bot without a gun can't shoot down your trackers. A shockwave bot has to get close, so keep your distance.
- **Dodging:** dash sideways (`'left'`/`'right'`) across a bullet's path, or `'back'` to keep your aim on an enemy while you retreat.
- **Energy management:** shooting, shielding and dashing all share one energy pool. Don't empty it right before a fight.
- **Remember enemies:** they disappear behind rocks, so track where they went with `memory`.

## Running it yourself

The game is a plain static website with no build step and no server code.

- **Play locally:** in the game folder run `python3 -m http.server`, then open http://localhost:8000
- **Quick fights in the terminal:** `node tools/fight.js bots/hunter.js my-bot.js --rounds 20` (Node 18+). It runs without the sandbox, so only use it on bots you trust.
- **Tests:** `npm test`
- **Hosting:** copy the whole folder to any web host (for example `ruybalid.com/ships/`). All paths are relative.
