// Bot library: built-in sample bots (from /bots) + your own bots (saved in this browser).
const KEY = 'shipArena.bots.v1';

export const BUILTIN_FILES = ['bots/hunter.js', 'bots/sniper.js', 'bots/spinner.js'];
export const PALETTE = ['#ff5c5c', '#5cc8ff', '#f7d154', '#7dff6b', '#c77dff', '#ff9f43', '#ff6bcb', '#4dd6b4'];

export const STARTER_CODE = `// Pick 2 weapons: 'gun', 'mine', 'tracker', 'shockwave'
const loadout = ['gun', 'mine'];

// Your ship's brain. think() runs 30 times a second.
// view   = everything your ship can see right now (see the "How to build a bot" tab)
// memory = an object that sticks around between ticks; store anything you like in it
function think(view, memory) {
  const me = view.self;
  const enemy = view.enemies[0];

  if (enemy) {
    // Aim where the enemy WILL be when the bullet arrives
    const aim = leadTarget(me, enemy, view.constants.BULLET_SPEED) || enemy;
    const aimAngle = angleTo(me, aim);
    const linedUp = Math.abs(angleDiff(me.angle, aimAngle)) < 0.1;
    return {
      turn: turnToward(me, aimAngle),
      thrust: distance(me, enemy) > 500 ? 0.6 : 0,
      fire: linedUp && lineOfSight(view, me, enemy),
      mine: distance(me, enemy) < 250, // drop a mine if they get close
      pigStat: 'speed',
    };
  }

  // Nobody in sight: go get the pig if it's there, otherwise drift toward the middle
  const goal = view.pig || view.pigZone;
  return {
    turn: turnToward(me, angleTo(me, goal)),
    thrust: 0.5,
    pigStat: 'speed',
  };
}
`;

// Optional header lines in a bot file:  // @name Hunter   and   // @color #ff5c5c
export function parseMeta(code) {
  return {
    name: code.match(/^\s*\/\/\s*@name\s+(.+)$/m)?.[1].trim().slice(0, 24) || null,
    color: code.match(/^\s*\/\/\s*@color\s+(#[0-9a-fA-F]{6})/m)?.[1] || null,
  };
}

export function withMeta(code, name, color) {
  const body = code.replace(/^\s*\/\/\s*@(name|color)\b.*\n?/gm, '');
  return `// @name ${name}\n// @color ${color}\n${body}`;
}

export class BotStore {
  constructor() {
    this.builtins = [];
    this.user = [];
    this.listeners = new Set();
  }

  async load() {
    this.builtins = await Promise.all(BUILTIN_FILES.map(async (file, i) => {
      const res = await fetch(file);
      const code = await res.text();
      const meta = parseMeta(code);
      return { id: 'builtin:' + file, name: meta.name || file, color: meta.color || PALETTE[i], code, builtin: true };
    }));
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      this.user = Array.isArray(raw) ? raw.filter((b) => b && typeof b.code === 'string') : [];
    } catch {
      this.user = [];
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.user));
    } catch (err) {
      alert('Could not save bots in this browser: ' + err.message);
    }
    for (const fn of this.listeners) fn();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  all() {
    return [...this.user, ...this.builtins];
  }

  get(id) {
    return this.all().find((b) => b.id === id) || null;
  }

  uniqueName(name, exceptId) {
    const taken = new Set(this.all().filter((b) => b.id !== exceptId).map((b) => b.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const n = `${name.slice(0, 20)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
  }

  create({ name, color, code }) {
    const bot = {
      id: 'user:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: this.uniqueName((name || 'My Bot').slice(0, 24)),
      color: color || PALETTE[(this.user.length + 3) % PALETTE.length],
      code: code ?? STARTER_CODE,
      builtin: false,
      updated: Date.now(),
    };
    this.user.unshift(bot);
    this.save();
    return bot;
  }

  update(id, changes) {
    const bot = this.user.find((b) => b.id === id);
    if (!bot) return null;
    if (changes.name != null) changes.name = this.uniqueName(changes.name.slice(0, 24) || 'My Bot', id);
    Object.assign(bot, changes, { updated: Date.now() });
    this.save();
    return bot;
  }

  remove(id) {
    this.user = this.user.filter((b) => b.id !== id);
    this.save();
  }
}

// Makes sure ships in one match have distinct names and colors.
export function matchEntries(bots) {
  const usedColors = new Set();
  const nameCount = {};
  return bots.map((b) => {
    let color = b.color;
    if (usedColors.has(color)) color = PALETTE.find((c) => !usedColors.has(c)) || color;
    usedColors.add(color);
    nameCount[b.name] = (nameCount[b.name] || 0) + 1;
    const name = nameCount[b.name] > 1 ? `${b.name} #${nameCount[b.name]}` : b.name;
    return { name, color, code: b.code, botId: b.id };
  });
}
