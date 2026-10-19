import { C } from '../engine/constants.js';
import { hasLineOfSight } from '../engine/vision.js';
import { mulberry32 } from '../engine/rng.js';
import { Camera } from './camera.js';
import { Starfield } from './starfield.js';
import { Particles } from './particles.js';
import { pigSprite } from './sprites.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.camera = new Camera();
    this.stars = new Starfield();
    this.particles = new Particles();
    this.shapes = new Map(); // asteroid id -> polygon
    this.lastFrame = performance.now();
  }

  reset() {
    this.particles.clear();
    this.shapes.clear();
  }

  addEvents(events, world) {
    this.particles.addEvents(events, world.ships);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.w = r.width;
    this.h = r.height;
  }

  // Screen (CSS px) -> world coordinates
  toWorld(sx, sy) {
    const cam = this.camera;
    return { x: cam.x + (sx - this.w / 2) / cam.zoom, y: cam.y + (sy - this.h / 2) / cam.zoom };
  }

  // opts: { alpha, follow, vision, showDebug, debug: [per-ship debug list] }
  draw(world, opts) {
    const now = performance.now();
    const frameDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.resize();
    const { g, w, h, dpr } = this;
    const t = opts.alpha ?? 1;
    const cam = this.camera;

    const followed = opts.follow != null ? world?.ships[opts.follow] : null;
    cam.update(w, h, followed && { x: lerp(followed.px, followed.x, t), y: lerp(followed.py, followed.y, t) });

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#05060d';
    g.fillRect(0, 0, w, h);
    this.stars.draw(g, w, h, cam);
    if (!world) return;

    const z = cam.zoom;
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z), dpr * (h / 2 - cam.y * z));

    this.drawArena(g, z, world);
    this.drawPig(g, z, world, t);
    this.drawAsteroids(g, z, world, t);
    this.drawBombs(g, z, world, t);
    this.drawBullets(g, z, world, t);
    this.drawShips(g, z, world, t);
    this.particles.update(frameDt);
    this.particles.draw(g, z);
    if (opts.vision != null && world.ships[opts.vision]?.alive) this.drawVision(g, z, world, opts.vision, t);
    if (opts.showDebug && opts.debug) this.drawDebug(g, z, world, opts.debug);
  }

  drawArena(g, z, world) {
    g.strokeStyle = '#3d4a7a';
    g.lineWidth = 6 / z;
    g.strokeRect(0, 0, C.ARENA_W, C.ARENA_H);
    // Faint grid
    g.strokeStyle = 'rgba(80, 100, 180, 0.07)';
    g.lineWidth = 1 / z;
    g.beginPath();
    for (let x = 500; x < C.ARENA_W; x += 500) { g.moveTo(x, 0); g.lineTo(x, C.ARENA_H); }
    for (let y = 500; y < C.ARENA_H; y += 500) { g.moveTo(0, y); g.lineTo(C.ARENA_W, y); }
    g.stroke();
    // The pig's open zone
    g.save();
    g.strokeStyle = 'rgba(255, 158, 196, 0.25)';
    g.lineWidth = 3 / z;
    g.setLineDash([30, 24]);
    g.beginPath();
    g.arc(C.ARENA_W / 2, C.ARENA_H / 2, C.PIG_ZONE_RADIUS, 0, TAU);
    g.stroke();
    g.restore();
  }

  drawPig(g, z, world, t) {
    const pig = world.pig;
    const cx = C.ARENA_W / 2, cy = C.ARENA_H / 2;
    if (!pig) {
      if (world.pigRespawnAt >= 0) {
        const secs = Math.ceil((world.pigRespawnAt - world.tick) / C.TICK_RATE);
        g.fillStyle = 'rgba(255, 158, 196, 0.5)';
        g.textAlign = 'center';
        g.font = `${Math.round(14 / z)}px "Press Start 2P", monospace`;
        g.fillText(`PIG IN ${secs}s`, cx, cy);
      }
      return;
    }
    const x = lerp(pig.px, pig.x, t), y = lerp(pig.py, pig.y, t);
    // Dance! One hop per beat, swapping leg poses, swaying, and squashing on landing.
    const time = performance.now() / 1000;
    const BEAT = 0.42;
    const beat = Math.floor(time / BEAT);
    const phase = (time % BEAT) / BEAT;     // 0..1 through this beat
    const s = pigSprite(beat);
    // Never smaller than ~14 screen px, so you can always spot it
    const scale = Math.max(4.2, 14 / s.width / z);
    const hop = Math.sin(phase * Math.PI) * 5 * scale;
    const squash = phase < 0.15 ? 1 - (0.15 - phase) * 1.4 : 1; // flattens right as it lands
    const sway = Math.sin((time / BEAT) * Math.PI) * 0.22;

    const glow = g.createRadialGradient(x, y, 5, x, y, 70);
    glow.addColorStop(0, 'rgba(255, 158, 196, 0.35)');
    glow.addColorStop(1, 'rgba(255, 158, 196, 0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(x, y, 70, 0, TAU); g.fill();
    // Shadow shrinks while it's in the air
    const h = s.height * scale;
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(x, y + h / 2, s.width * scale * 0.4 * (1 - hop / (12 * scale)), 2 * scale, 0, 0, TAU);
    g.fill();

    g.save();
    g.translate(x, y + h / 2 - hop);   // pivot at the feet
    g.rotate(sway);
    g.scale(1 / squash, squash);
    g.imageSmoothingEnabled = false;
    g.drawImage(s, (-s.width * scale) / 2, -h, s.width * scale, h);
    g.imageSmoothingEnabled = true;
    g.restore();

    // Music notes float up, alternating sides
    g.textAlign = 'center';
    g.font = `${Math.round(5 * scale)}px system-ui, sans-serif`;
    for (let i = 0; i < 3; i++) {
      const life = ((time / (BEAT * 2)) + i / 3) % 1;
      const side = (Math.floor(time / (BEAT * 2) + i / 3) + i) % 2 ? 1 : -1;
      g.globalAlpha = Math.sin(life * Math.PI);
      g.fillStyle = i % 2 ? '#ff9ec4' : '#ffd0e2';
      g.fillText(i % 2 ? '♪' : '♫', x + side * (8 + life * 4) * scale, y - h * 0.4 - life * 10 * scale);
    }
    g.globalAlpha = 1;
  }

  shapeFor(a) {
    let pts = this.shapes.get(a.id);
    if (!pts) {
      const rnd = mulberry32(a.id * 7919);
      const n = 9 + Math.floor(rnd() * 5);
      pts = [];
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU;
        const r = 0.8 + rnd() * 0.25;
        pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }
      const cracks = [0, 1, 2].map(() => [rnd() * TAU, 0.5 + rnd() * 0.4]);
      pts.cracks = cracks;
      this.shapes.set(a.id, pts);
    }
    return pts;
  }

  drawAsteroids(g, z, world, t) {
    for (const a of world.asteroids) {
      const x = lerp(a.px, a.x, t), y = lerp(a.py, a.y, t);
      const pts = this.shapeFor(a);
      g.save();
      g.translate(x, y);
      g.rotate(a.angle);
      g.scale(a.r, a.r);
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px * 1.08, py * 1.08) : g.moveTo(px * 1.08, py * 1.08)));
      g.closePath();
      g.fillStyle = '#2b2c38';
      g.fill();
      g.lineWidth = 2.5 / z / a.r;
      g.strokeStyle = '#8b8ca3';
      g.stroke();
      // Cracks show how many hits it has taken
      const damage = C.ASTEROID_HITS - a.hitsLeft;
      g.strokeStyle = '#d4a373';
      g.lineWidth = 2 / z / a.r;
      for (let i = 0; i < damage; i++) {
        const [ang, len] = pts.cracks[i];
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(ang) * len * 0.5, Math.sin(ang) * len * 0.5 + 0.1);
        g.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
        g.stroke();
      }
      g.restore();
    }
  }

  drawBullets(g, z, world, t) {
    g.lineCap = 'round';
    for (const b of world.bullets) {
      const x = lerp(b.px, b.x, t), y = lerp(b.py, b.y, t);
      g.strokeStyle = world.ships[b.owner].color;
      g.lineWidth = Math.max(4, 2.5 / z);
      g.beginPath();
      g.moveTo(x - b.vx * 0.025, y - b.vy * 0.025);
      g.lineTo(x, y);
      g.stroke();
    }
    g.lineCap = 'butt';
  }

  drawBombs(g, z, world, t) {
    for (const b of world.bombs) {
      const x = lerp(b.px, b.x, t), y = lerp(b.py, b.y, t);
      const armed = world.tick >= b.armAt;
      const r = Math.max(C.BOMB_RADIUS, 5 / z);
      if (b.kind === 'tracker') {
        this.drawTracker(g, z, world, b, x, y, r, armed);
        continue;
      }
      g.fillStyle = '#1b1b22';
      g.strokeStyle = world.ships[b.owner].color;
      g.lineWidth = 3 / z;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
      const blink = armed ? Math.sin(world.tick * 0.9) > 0 : Math.sin(world.tick * 0.3) > 0.6;
      if (blink) {
        g.fillStyle = armed ? '#ff3b3b' : '#ffcf3b';
        g.beginPath(); g.arc(x, y, r * 0.45, 0, TAU); g.fill();
      }
      if (armed) {
        g.strokeStyle = 'rgba(255, 59, 59, 0.15)';
        g.lineWidth = 1.5 / z;
        g.beginPath(); g.arc(x, y, C.MINE_TRIGGER_RADIUS, 0, TAU); g.stroke();
      }
    }
  }

  // A little homing missile: points where it's heading, with a flame once it's chasing
  drawTracker(g, z, world, b, x, y, r, armed) {
    const color = world.ships[b.owner].color;
    g.save();
    g.translate(x, y);
    g.rotate(b.heading);
    const s = r * 1.4;
    if (armed) {
      const len = s * (1 + b.speed / 250 + Math.random() * 0.4);
      g.fillStyle = '#ffae3b';
      g.beginPath();
      g.moveTo(-s * 0.6, -s * 0.35);
      g.lineTo(-s * 0.6 - len, 0);
      g.lineTo(-s * 0.6, s * 0.35);
      g.fill();
    }
    g.fillStyle = '#1b1b22';
    g.strokeStyle = color;
    g.lineWidth = 3 / z;
    g.beginPath();
    g.moveTo(s * 1.1, 0);
    g.lineTo(-s * 0.6, -s * 0.6);
    g.lineTo(-s * 0.6, s * 0.6);
    g.closePath();
    g.fill();
    g.stroke();
    if (Math.sin(world.tick * (armed ? 1.2 : 0.3)) > 0) {
      g.fillStyle = armed ? '#ff3b3b' : '#ffcf3b';
      g.beginPath(); g.arc(0, 0, s * 0.3, 0, TAU); g.fill();
    }
    g.restore();
  }

  drawShips(g, z, world, t) {
    const R = C.SHIP_RADIUS;
    for (const s of world.ships) {
      if (!s.alive) continue;
      const x = lerp(s.px, s.x, t), y = lerp(s.py, s.y, t);
      const ang = lerpAngle(s.pa, s.angle, t);
      // Draw a little bigger when zoomed way out so ships stay visible
      const k = Math.max(1, 9 / (R * z));
      if (s.dashTicks > 0) this.drawDashTrail(g, z, s, x, y, k);
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.scale(k, k);
      if (s.boosting) {
        // Afterburner: a long blue flame behind the normal one
        const len = R * (3.6 + Math.random() * 1.2);
        g.fillStyle = 'rgba(90, 190, 255, 0.9)';
        g.beginPath();
        g.moveTo(-R * 0.6, -R * 0.75);
        g.lineTo(-R * 0.7 - len, 0);
        g.lineTo(-R * 0.6, R * 0.75);
        g.fill();
        g.fillStyle = 'rgba(230, 248, 255, 0.95)';
        g.beginPath();
        g.moveTo(-R * 0.6, -R * 0.3);
        g.lineTo(-R * 0.7 - len * 0.6, 0);
        g.lineTo(-R * 0.6, R * 0.3);
        g.fill();
      }
      if (s.lastCmd?.thrust > 0 || s.boosting) {
        const len = R * (0.8 + (s.boosting ? 1 : s.lastCmd.thrust) * 0.9 + Math.random() * 0.3);
        g.fillStyle = '#ffae3b';
        g.beginPath();
        g.moveTo(-R * 0.7, -R * 0.35);
        g.lineTo(-R * 0.7 - len, 0);
        g.lineTo(-R * 0.7, R * 0.35);
        g.fill();
      }
      g.fillStyle = s.color;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2 / z / k;
      g.beginPath();
      g.moveTo(R * 1.25, 0);
      g.lineTo(-R * 0.8, -R * 0.85);
      g.lineTo(-R * 0.45, 0);
      g.lineTo(-R * 0.8, R * 0.85);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();

      if (s.spinTicks > 0) {
        // Dizzy stars circling overhead
        const time = performance.now() / 1000;
        g.fillStyle = '#ffe66b';
        g.font = `${Math.round(12 / z)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        for (let i = 0; i < 3; i++) {
          const a = time * 8 + (i * TAU) / 3;
          g.fillText('★', x + Math.cos(a) * (R + 6) * k, y - (R + 4) * k + Math.sin(a) * 6 * k);
        }
      }

      if (s.shieldOn) {
        // An arc on the protected side only
        const face = ang + (s.shieldSide === 'back' ? Math.PI : 0);
        const half = C.SHIELD_ARC / 2;
        const rad = (R + 10) * k;
        g.fillStyle = 'rgba(127, 243, 255, 0.15)';
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, rad, face - half, face + half);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(127, 243, 255, 0.95)';
        g.lineWidth = Math.max(4, 3 / z);
        g.lineCap = 'round';
        g.beginPath(); g.arc(x, y, rad, face - half, face + half); g.stroke();
        g.lineCap = 'butt';
      }

      // Name + HP bar (constant size on screen)
      const bw = 44 / z, bh = 5 / z, by = y - (R * k + 14 / z);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x - bw / 2, by, bw, bh);
      g.fillStyle = s.hp / s.maxHp > 0.35 ? '#5cff8a' : '#ff5c5c';
      g.fillRect(x - bw / 2, by, (bw * Math.max(0, s.hp)) / s.maxHp, bh);
      g.fillStyle = '#ffffff';
      g.font = `${Math.round(11 / z)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(s.name, x, by - 4 / z);
    }
  }

  drawDashTrail(g, z, s, x, y, k) {
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / sp, uy = s.vy / sp;
    const len = sp * 0.18;
    const px = -uy, py = ux;
    g.save();
    g.lineCap = 'round';
    for (const off of [-0.6, 0, 0.6]) {
      const ox = px * off * C.SHIP_RADIUS * k, oy = py * off * C.SHIP_RADIUS * k;
      const grad = g.createLinearGradient(x + ox, y + oy, x + ox - ux * len, y + oy - uy * len);
      grad.addColorStop(0, 'rgba(180, 240, 255, 0.8)');
      grad.addColorStop(1, 'rgba(180, 240, 255, 0)');
      g.strokeStyle = grad;
      g.lineWidth = (off === 0 ? 5 : 3) / z;
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox - ux * len, y + oy - uy * len);
      g.stroke();
    }
    g.restore();
  }

  drawVision(g, z, world, id, t) {
    const s = world.ships[id];
    const x = s.x, y = s.y;
    const range = C.SENSOR_RANGE;
    g.save();
    // Darken everything outside the sensor circle
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    g.beginPath();
    g.rect(-5000, -5000, C.ARENA_W + 10000, C.ARENA_H + 10000);
    g.arc(x, y, range, 0, TAU, true);
    g.fill('evenodd');
    // Shadows cast by asteroids
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    for (const a of world.asteroids) {
      const dx = a.x - x, dy = a.y - y;
      const d = Math.hypot(dx, dy);
      if (d <= a.r || d - a.r > range) continue;
      const base = Math.atan2(dy, dx);
      const half = Math.asin(a.r / d);
      const tl = Math.sqrt(d * d - a.r * a.r);
      const far = range * 1.5;
      const p1 = [x + Math.cos(base - half) * tl, y + Math.sin(base - half) * tl];
      const p2 = [x + Math.cos(base + half) * tl, y + Math.sin(base + half) * tl];
      g.beginPath();
      g.moveTo(p1[0], p1[1]);
      g.lineTo(x + Math.cos(base - half) * far, y + Math.sin(base - half) * far);
      g.lineTo(x + Math.cos(base + half) * far, y + Math.sin(base + half) * far);
      g.lineTo(p2[0], p2[1]);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(120, 200, 255, 0.5)';
    g.lineWidth = 2 / z;
    g.beginPath(); g.arc(x, y, range, 0, TAU); g.stroke();
    // Line of sight to each enemy: green = seen, red = hidden
    for (const o of world.ships) {
      if (o === s || !o.alive) continue;
      const inRange = Math.hypot(o.x - x, o.y - y) <= range + C.SHIP_RADIUS;
      const seen = inRange && hasLineOfSight(world, x, y, o.x, o.y);
      g.strokeStyle = seen ? 'rgba(92, 255, 138, 0.8)' : 'rgba(255, 92, 92, 0.45)';
      g.setLineDash(seen ? [] : [12 / z, 10 / z]);
      g.lineWidth = 2 / z;
      g.beginPath(); g.moveTo(x, y); g.lineTo(o.x, o.y); g.stroke();
    }
    g.restore();
  }

  drawDebug(g, z, world, debug) {
    g.save();
    g.textAlign = 'left';
    debug.forEach((list, i) => {
      const ship = world.ships[i];
      if (!list || !ship?.alive) return;
      for (const d of list) {
        const color = d.color || ship.color;
        g.strokeStyle = color;
        g.fillStyle = color;
        g.lineWidth = (d.width || 1.5) / z;
        if (d.type === 'line' && d.x2 != null) {
          g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x2, d.y2); g.stroke();
        } else if (d.type === 'circle') {
          g.beginPath(); g.arc(d.x, d.y, Math.max(1, d.r || 10), 0, TAU); g.stroke();
        } else if (d.type === 'text' && d.text) {
          g.font = `${Math.round(11 / z)}px ui-monospace, monospace`;
          g.fillText(d.text, d.x, d.y);
        }
      }
    });
    g.restore();
  }
}
