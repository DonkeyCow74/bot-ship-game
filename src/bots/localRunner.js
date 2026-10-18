// Runs bots in-process with no sandbox. Only for tests and the Node command-line tools:
// the website always uses BotRunner (Web Workers).
import * as helpers from './helpers.js';
import { createWorld, getView, step } from '../engine/sim.js';

export function compileBot(code) {
  const names = Object.keys(helpers);
  const factory = new Function(...names, code + '\n;return typeof think === "function" ? think : undefined;');
  const think = factory(...names.map((n) => helpers[n]));
  if (typeof think !== 'function') throw new Error('Your bot must define a function named think(view, memory).');
  return think;
}

// bots: [{name, code, color}]. Returns the finished world.
export function runLocalMatch({ seed, bots, maxTicks, onTick }) {
  const world = createWorld(seed, bots);
  if (maxTicks) world.maxTicks = maxTicks;
  const thinkers = bots.map((b) => compileBot(b.code));
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
