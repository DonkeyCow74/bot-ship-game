import { C } from '../engine/constants.js';

// mode: 'fit' (whole arena), 'follow' (a ship), 'free' (dragged / zoomed by the viewer)
export class Camera {
  constructor() {
    this.x = C.ARENA_W / 2;
    this.y = C.ARENA_H / 2;
    this.zoom = 0.1;
    this.followZoom = 0.45;
    this.mode = 'fit';
  }

  // Leaves room at the top for the timer
  fitZoom(w, h) {
    return Math.min(w / C.ARENA_W, (h - 60) / C.ARENA_H) * 0.97;
  }

  update(w, h, target) {
    if (this.mode === 'fit') {
      this.zoom = this.fitZoom(w, h);
      this.x = C.ARENA_W / 2;
      this.y = C.ARENA_H / 2 - 22 / this.zoom;
    } else if (this.mode === 'follow' && target) {
      this.zoom = this.followZoom;
      this.x += (target.x - this.x) * 0.25;
      this.y += (target.y - this.y) * 0.25;
    }
  }

  zoomAt(factor, sx, sy, w, h) {
    const min = this.fitZoom(w, h) * 0.8, max = 2;
    const wx = this.x + (sx - w / 2) / this.zoom;
    const wy = this.y + (sy - h / 2) / this.zoom;
    const z = Math.min(max, Math.max(min, this.zoom * factor));
    if (this.mode === 'follow') {
      this.followZoom = z;
      this.zoom = z;
      return;
    }
    this.mode = 'free';
    this.zoom = z;
    this.x = wx - (sx - w / 2) / z;
    this.y = wy - (sy - h / 2) / z;
  }

  pan(dx, dy) {
    this.mode = 'free';
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }
}
