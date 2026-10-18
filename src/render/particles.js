// Purely visual effects. They never touch the simulation, so they can use Math.random.
export class Particles {
  constructor() {
    this.list = [];
    this.rings = [];
    this.texts = [];
  }

  clear() {
    this.list.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
  }

  burst(x, y, n, color, speed, life, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.5 + Math.random()) });
    }
    if (this.list.length > 3000) this.list.splice(0, this.list.length - 3000);
  }

  ring(x, y, r, color, life = 0.5) {
    this.rings.push({ x, y, r, color, life, max: life });
  }

  text(x, y, text, color) {
    this.texts.push({ x, y, text, color, life: 1.6, max: 1.6 });
  }

  // events: world.events from one tick. ships: world.ships (for colors).
  addEvents(events, ships) {
    for (const e of events) {
      switch (e.type) {
        case 'explosion':
          this.burst(e.x, e.y, 60, '#ffb347', 420, 0.8, 5);
          this.burst(e.x, e.y, 30, '#fff3b0', 250, 0.5, 4);
          this.ring(e.x, e.y, e.r, '#ffb347', 0.6);
          break;
        case 'kill':
          this.burst(e.x, e.y, 90, ships[e.ship].color, 380, 1.4, 6);
          this.burst(e.x, e.y, 40, '#ffffff', 200, 0.7, 4);
          this.ring(e.x, e.y, 160, ships[e.ship].color, 0.8);
          break;
        case 'asteroidBreak':
          this.burst(e.x, e.y, 10 + e.r / 3, '#9a9aab', 140, 1, 4);
          break;
        case 'asteroidHit':
          this.burst(e.x, e.y, 4, '#c8c8d8', 120, 0.3, 2);
          break;
        case 'damage':
          if (e.cause === 'bullet') this.burst(e.x, e.y, 8, '#ff7b5c', 180, 0.35, 3);
          break;
        case 'shieldHit':
          this.burst(e.x, e.y, 8, '#7ff3ff', 200, 0.35, 3);
          break;
        case 'pigEaten':
          this.burst(e.x, e.y, 40, '#ff9ec4', 260, 1, 5);
          this.text(e.x, e.y - 40, `+25 ${e.stat.toUpperCase()}`, '#ff9ec4');
          break;
        case 'pigSpawn':
          this.ring(e.x, e.y, 120, '#ff9ec4', 0.8);
          break;
      }
    }
  }

  update(dt) {
    for (const p of this.list) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 1.5 * dt;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= 40 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  draw(g, zoom) {
    for (const p of this.list) {
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      const s = Math.max(p.size, 1.5 / zoom);
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      g.globalAlpha = (1 - k) * 0.8;
      g.strokeStyle = r.color;
      g.lineWidth = 4 / zoom;
      g.beginPath();
      g.arc(r.x, r.y, r.r * (0.3 + 0.7 * k), 0, Math.PI * 2);
      g.stroke();
    }
    g.textAlign = 'center';
    for (const t of this.texts) {
      g.globalAlpha = Math.min(1, t.life / 0.5);
      g.fillStyle = t.color;
      g.font = `bold ${Math.round(16 / zoom)}px "Press Start 2P", monospace`;
      g.fillText(t.text, t.x, t.y);
    }
    g.globalAlpha = 1;
  }
}
