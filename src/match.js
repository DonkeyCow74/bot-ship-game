// A match = a world + one sandboxed bot per ship. Also records everything needed for a replay.
import { createWorld, getView, step, sanitizeCommand, encodeCommand, decodeCommand } from './engine/sim.js';
import { BotRunner } from './bots/botRunner.js';

export const REPLAY_VERSION = 4; // 2: directional shield, 3: saw + dash, 4: saw strike + dash direction

export class LiveMatch {
  // entries: [{name, color, code}]
  constructor(seed, entries) {
    this.seed = seed >>> 0;
    this.entries = entries.map((e) => ({ name: e.name, color: e.color, code: e.code }));
    this.world = createWorld(this.seed, this.entries);
    this.runners = this.entries.map((e, i) => new BotRunner({
      name: e.name,
      code: e.code,
      seed: (this.seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0,
    }));
    this.debug = this.entries.map(() => null);
    this.commands = []; // per tick: [encoded cmd per ship]
    this.isReplay = false;
  }

  async init() {
    await Promise.all(this.runners.map((r) => r.init()));
  }

  async step() {
    const w = this.world;
    if (w.over) return;
    const tick = w.tick;
    const raw = await Promise.all(w.ships.map((s, i) =>
      s.alive ? this.runners[i].request(getView(w, i), tick) : null));
    if (this.disposed) return;
    const cmds = raw.map((c, i) => {
      this.debug[i] = c?.debug || null;
      return sanitizeCommand(c);
    });
    this.commands.push(cmds.map(encodeCommand));
    step(w, cmds);
    if (w.over) this.stopBots();
  }

  stopBots() {
    for (const r of this.runners) r.terminate();
  }

  dispose() {
    this.disposed = true;
    this.stopBots();
  }

  toReplay() {
    return {
      version: REPLAY_VERSION,
      seed: this.seed,
      entries: this.entries,
      commands: this.commands,
      result: summarize(this.world),
    };
  }
}

// Plays a recorded match back. No bots run: the recorded commands drive the same engine.
export class ReplayMatch {
  constructor(replay) {
    if (!replay || replay.version !== REPLAY_VERSION || !Array.isArray(replay.commands)) {
      throw new Error('Not a valid replay file.');
    }
    this.replay = replay;
    this.seed = replay.seed >>> 0;
    this.entries = replay.entries;
    this.world = createWorld(this.seed, this.entries);
    this.debug = this.entries.map(() => null);
    this.runners = this.entries.map(() => null);
    this.isReplay = true;
  }

  async init() {}

  async step() {
    const w = this.world;
    if (w.over) return;
    const rec = this.replay.commands[w.tick];
    if (!rec) {
      // Replay cut short (match was stopped early)
      w.over = true;
      w.endReason = 'replay ended';
      return;
    }
    step(w, rec.map(decodeCommand));
  }

  dispose() {}

  toReplay() {
    return this.replay;
  }
}

export function summarize(world) {
  return {
    winner: world.winner,
    endReason: world.endReason,
    ticks: world.tick,
    ships: world.ships.map((s) => ({
      name: s.name, alive: s.alive, hp: Math.round(s.hp), ...s.stats, upgrades: { ...s.upgrades },
    })),
  };
}
