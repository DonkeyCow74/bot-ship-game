# Ship AI Arena 🐷

Program a spaceship AI, then watch it battle your friends' bots among moving asteroids. Nobody flies by hand: whoever writes the smartest `think()` function wins.

- Every ship is identical and every bot gets the same `view` and helper functions. Strategy is the only edge.
- Each bot runs in its own sandboxed Web Worker with a 20 ms time limit per tick.
- Asteroids block line of sight. They break into smaller pieces after 3 hits.
- Each bot picks 2 of 4 weapons: gun, mines, homing trackers and a shockwave. Every ship also has a boost, a dash and a front-or-back shield.
- A pig spawns in the open middle of the map 10 s in. Eat it for +40 HP, +40 energy or +40% speed. A new one appears 30 s after each is eaten.
- The game includes live matches, replays, fast headless tournaments and share links for bots.

**How to write a bot:** [docs/BOT_API.md](docs/BOT_API.md), which is also the "How to build a bot" tab in the game.

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly from disk won't work. Browsers only load the game's modules from a web server.

## Put it on a website (e.g. ruybalid.com)

It's a plain static site: no build step, no server code and no database. Copy the folder to any directory on the web server, for example `ruybalid.com/ships/`. All paths are relative, so it works from any subfolder.

Only these files are needed on the server:

```
index.html  css/  src/  bots/  docs/
```

(`tests/`, `tools/` and `package.json` are only for development.)

Bots people write are saved in their own browser (localStorage). They share bots by link or by `.js` file, so the server never stores anything.

## Developing

```sh
npm test                                              # engine tests (Node 18+)
node tools/fight.js bots/hunter.js bots/sniper.js --rounds 20   # quick headless fights
```

| Path | What's there |
|---|---|
| `src/engine/` | Deterministic simulation (no DOM). All tunable numbers are in `constants.js` |
| `src/bots/` | Worker sandbox, time limits, helper functions given to bots |
| `src/render/` | Canvas drawing: ships, asteroids, the 8-bit pig, vision shadows, particles |
| `src/ui/` | Arena, Bot Lab, Tournament, sharing, storage |
| `bots/` | Sample bots: Hunter, Sniper, Spinner |
