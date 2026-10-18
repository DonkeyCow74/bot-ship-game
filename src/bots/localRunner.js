// Runs bots in-process with no sandbox. Only for tests and the Node command-line tools:
// the website always uses BotRunner (Web Workers).
import * as helpers from './helpers.js';
import { createWorld, getView, step } from '../engine/sim.js';
import { normalizeLoadout } from '../engine/constants.js';

// Returns { think, loadout } (loadout already checked/fixed)
export function compileBot(code) {
  const names = Object.keys(helpers);
  const factory = new Function(...names, code +
    '\n;return { think: typeof think === "function" ? think : undefined, loadout: typeof loadout === "undefined" ? undefined : loadout };');
  const made = factory(...names.map((n) => helpers[n]));
  if (typeof made.think !== 'function') throw new Error('Your bot must define a function named think(view, memory).');
  return { think: made.think, loadout: normalizeLoadout(made.loadout).loadout };
}

// bots: [{name, code, color}]. Returns the finished world.
export function runLocalMatch({ seed, bots, maxTicks, onTick }) {
  const compiled = bots.map((b) => compileBot(b.code));
  const world = createWorld(seed, bots.map((b, i) => ({ ...b, loadout: compiled[i].loadout })));
  if (maxTicks) world.maxTicks = maxTicks;
  const thinkers = compiled.map((c) => c.think);
  const memories = bots.map(() => ({}));
  while (!world.over) {
    const cmds = world.ships.map((s, i) => {
      if (!s.alive) return null;
      try {
        return thinkers[i](structuredClone(getView(world, i)), memories[i]);
      } catch {
        return null;
      }
    });
    step(world, cmds);
    onTick?.(world, cmds);
  }
  return world;
}
