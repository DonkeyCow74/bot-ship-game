// 8-bit pixel art, drawn once into small offscreen canvases.
const PIG_BODY = [
  '.DD......DD.',
  '.DLD....DLD.',
  '.DPPPPPPPPD.',
  'DPPPPPPPPPPD',
  'DPPKPPPPKPPD',
  'DPPWPPPPWPPD',
  'DPPPSSSSPPPD',
  'DPPSNSSNSPPD',
  'DPPPSSSSPPPD',
  '.DPPPPPPPPD.',
  '..DDDDDDDD..',
];
// Two dance frames: legs tucked in, legs kicked out
const PIG_FRAMES = [
  [...PIG_BODY, '...DP..PD...', '...DD..DD...'],
  [...PIG_BODY, '.DP......PD.', 'DD........DD'],
];
const PIG_COLORS = {
  D: '#b0406a', P: '#ff9ec4', L: '#ffd0e2', K: '#1a0a12', W: '#ffffff', S: '#ff6f9f', N: '#7a1d42',
};

function bake(rows, colors) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (!colors[ch]) return;
      g.fillStyle = colors[ch];
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

let pig = null;
export function pigSprite(frame = 0) {
  if (!pig) pig = PIG_FRAMES.map((rows) => bake(rows, PIG_COLORS));
  return pig[frame % pig.length];
}
