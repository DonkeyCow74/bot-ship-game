import { mulberry32 } from '../engine/rng.js';

const TILE = 1024;
const LAYERS = [
  { count: 140, depth: 0.15, size: 1, alpha: 0.45 },
  { count: 70, depth: 0.35, size: 1.5, alpha: 0.7 },
  { count: 25, depth: 0.6, size: 2, alpha: 0.95 },
];

// Parallax stars, drawn in screen space behind everything.
export class Starfield {
  constructor() {
    const rnd = mulberry32(2024);
    this.layers = LAYERS.map((l) => ({
      ...l,
      stars: Array.from({ length: l.count }, () => [rnd() * TILE, rnd() * TILE, 0.5 + rnd() * 0.5]),
    }));
  }

  draw(g, w, h, cam) {
    for (const l of this.layers) {
      const ox = -((cam.x * l.depth * cam.zoom * 4) % TILE);
      const oy = -((cam.y * l.depth * cam.zoom * 4) % TILE);
      g.fillStyle = '#fff';
      for (let tx = ox - TILE; tx < w; tx += TILE) {
        for (let ty = oy - TILE; ty < h; ty += TILE) {
          if (tx + TILE < 0 || ty + TILE < 0) continue;
          for (const [x, y, b] of l.stars) {
            const sx = tx + x, sy = ty + y;
            if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
            g.globalAlpha = l.alpha * b;
            g.fillRect(sx, sy, l.size, l.size);
          }
        }
      }
    }
    g.globalAlpha = 1;
  }
}
