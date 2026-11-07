/** Obstacle designs. They only change how circles look: the shape and the rules stay the same. */

type Painter = (c: CanvasRenderingContext2D, x: number, y: number, r: number, i: number) => void;

export interface ObstacleStyle {
  /** Debris color when this obstacle is hit. */
  debris: (i: number) => string;
  paint: Painter;
}

const GOLDEN = 2.399963;

/** Places spots the same way on every redraw, so they don't jump around. */
function scatter(x: number, y: number, r: number, i: number, gap: number, each: (px: number, py: number, k: number) => void): void {
  const count = Math.floor(r / gap);
  for (let k = 0; k < count; k++) {
    const a = k * GOLDEN + i;
    const d = r * Math.sqrt((k + 0.5) / count) * 0.85;
    each(x + Math.cos(a) * d, y + Math.sin(a) * d, k);
  }
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

/** A shaded lower edge and a bright upper edge give each circle a rounded look. */
function rimAndShine(c: CanvasRenderingContext2D, x: number, y: number, r: number, rim: string, shine = '#ffffff66'): void {
  c.strokeStyle = rim;
  c.lineWidth = 7;
  c.beginPath();
  c.arc(x, y + 2.5, r, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = shine;
  c.lineWidth = 2.5;
  c.beginPath();
  // Tiny circles can be smaller than this inset, and a negative radius would throw.
  c.arc(x, y, Math.max(0.5, r - 3.5), Math.PI * 1.1, Math.PI * 1.65);
  c.stroke();
}

const CANDY = [
  { fill: '#f7d65c', rim: '#d9a92a', spot: '#e6bb3a' },
  { fill: '#6fb7f2', rim: '#3e86cf', spot: '#529fe0' },
];

const candy: Painter = (c, x, y, r, i) => {
  const look = CANDY[i % CANDY.length]!;
  c.fillStyle = look.fill;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.fillStyle = look.spot;
  scatter(x, y, r, i, 7, (px, py, k) => dot(c, px, py, 1.6 + (k % 3)));
  rimAndShine(c, x, y, r, look.rim);
};

const blackWhite: Painter = (c, x, y, r, i) => {
  const dark = i % 2 === 0;
  c.fillStyle = dark ? '#161616' : '#fafafa';
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.fillStyle = dark ? '#5a5a5a' : '#c4c4c4';
  scatter(x, y, r, i, 7, (px, py, k) => dot(c, px, py, 1.4 + (k % 3)));
  c.strokeStyle = dark ? '#000000' : '#161616';
  c.lineWidth = dark ? 5 : 4;
  c.beginPath();
  c.arc(x, y, r - 1, 0, Math.PI * 2);
  c.stroke();
};

function bands(c: CanvasRenderingContext2D, x: number, y: number, r: number, colors: string[], tilt: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(tilt);
  const h = (r * 2) / colors.length;
  colors.forEach((color, k) => {
    c.fillStyle = color;
    c.fillRect(-r - 2, -r + k * h, r * 2 + 4, h + 1);
  });
  c.restore();
}

const planets: Painter = (c, x, y, r, i) => {
  switch (i % 5) {
    case 0: // Banded gas giant with a storm.
      bands(c, x, y, r, ['#e7c9a0', '#c98f5b', '#f0dcc0', '#b5713f', '#e7c9a0', '#cc9866', '#ecd7b8'], 0.14);
      c.fillStyle = '#b5482c';
      c.beginPath();
      c.ellipse(x + r * 0.28, y + r * 0.26, r * 0.22, r * 0.12, 0.14, 0, Math.PI * 2);
      c.fill();
      break;
    case 1: // Blue and green world with clouds.
      c.fillStyle = '#2f7fd8';
      c.fillRect(x - r, y - r, r * 2, r * 2);
      c.fillStyle = '#4faa5c';
      scatter(x, y, r, i, 15, (px, py, k) => {
        c.beginPath();
        c.ellipse(px, py, r * 0.24 + (k % 3) * 2, r * 0.15, k, 0, Math.PI * 2);
        c.fill();
      });
      c.fillStyle = '#ffffffb0';
      scatter(x, y, r, i + 2, 22, (px, py, k) => {
        c.beginPath();
        c.ellipse(px, py, r * 0.2, r * 0.05 + 1, k * 0.4, 0, Math.PI * 2);
        c.fill();
      });
      break;
    case 2: // Rusty red world with craters.
      c.fillStyle = '#c9583a';
      c.fillRect(x - r, y - r, r * 2, r * 2);
      c.fillStyle = '#9c3f27';
      scatter(x, y, r, i, 9, (px, py, k) => dot(c, px, py, 1.5 + (k % 4)));
      c.fillStyle = '#f1e3d6';
      c.beginPath();
      c.ellipse(x, y - r * 0.92, r * 0.42, r * 0.15, 0, 0, Math.PI * 2);
      c.fill();
      break;
    case 3: // Pale ice giant.
      bands(c, x, y, r, ['#8fdcd8', '#74cfd0', '#a6e6e0', '#74cfd0', '#8fdcd8'], -0.3);
      break;
    default: // Ringed planet, with the ring kept inside the circle.
      bands(c, x, y, r, ['#ecd9a6', '#d9bd7c', '#f0e2b8', '#d2b06b', '#ecd9a6'], 0.28);
      c.strokeStyle = '#8a6a33';
      c.lineWidth = Math.max(1.4, r * 0.09);
      c.beginPath();
      c.ellipse(x, y, r * 0.96, r * 0.26, 0.28, 0, Math.PI * 2);
      c.stroke();
      break;
  }
  // Night side.
  const shade = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.2, x, y, r * 1.05);
  shade.addColorStop(0, '#00000000');
  shade.addColorStop(1, '#00000080');
  c.fillStyle = shade;
  c.fillRect(x - r, y - r, r * 2, r * 2);
};

const moon: Painter = (c, x, y, r, i) => {
  c.fillStyle = '#b9bcc4';
  c.fillRect(x - r, y - r, r * 2, r * 2);
  scatter(x, y, r, i, 9, (px, py, k) => {
    const size = 2 + (k % 4) * 1.5;
    c.fillStyle = '#9498a3';
    dot(c, px, py, size);
    c.fillStyle = '#d4d6dc';
    dot(c, px + size * 0.3, py + size * 0.3, size * 0.55);
  });
  rimAndShine(c, x, y, r, '#7d818c');
};

const cookies: Painter = (c, x, y, r, i) => {
  c.fillStyle = '#d9a766';
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.fillStyle = '#c28f4f';
  scatter(x, y, r, i + 3, 5, (px, py) => dot(c, px, py, 1));
  c.fillStyle = '#4a2c17';
  scatter(x, y, r, i, 8, (px, py, k) => {
    c.beginPath();
    c.ellipse(px, py, 2.4 + (k % 3), 1.8 + (k % 2), k, 0, Math.PI * 2);
    c.fill();
  });
  rimAndShine(c, x, y, r, '#a8743a', '#ffffff40');
};

const POOL = ['#e8b90f', '#1c4fc2', '#d62828', '#6d2f9e', '#ef7d12', '#147a3d', '#7f1d1d', '#111111'];

const pool: Painter = (c, x, y, r, i) => {
  const n = (i % 15) + 1;
  const color = POOL[(n - 1) % 8]!;
  const striped = n > 8;
  c.fillStyle = striped ? '#fafafa' : color;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  if (striped) {
    c.fillStyle = color;
    c.fillRect(x - r, y - r * 0.52, r * 2, r * 1.04);
  }
  if (r >= 9) {
    c.fillStyle = '#fafafa';
    dot(c, x, y, r * 0.38);
    c.fillStyle = '#111111';
    c.font = `700 ${r * 0.42}px "Shantell Sans", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), x, y + 0.5);
  }
  rimAndShine(c, x, y, r, '#00000044', '#ffffff99');
};

const NEON = ['#ff3fa4', '#27e0ff', '#a6ff3d', '#ffd23d', '#b98cff'];

const neon: Painter = (c, x, y, r, i) => {
  const color = NEON[i % NEON.length]!;
  c.fillStyle = '#12122a';
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.strokeStyle = color;
  c.globalAlpha = 0.28;
  c.lineWidth = 9;
  c.beginPath();
  c.arc(x, y, r - 2, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = 1;
  c.lineWidth = 2.5;
  c.beginPath();
  c.arc(x, y, r - 2, 0, Math.PI * 2);
  c.stroke();
  if (r > 16) {
    c.globalAlpha = 0.55;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, r * 0.6, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }
};

const FRUIT = [
  { rind: '#f08a1d', pith: '#ffe9c7', flesh: '#ffa62b' },
  { rind: '#5fa52c', pith: '#f2f8c9', flesh: '#b4dc4b' },
  { rind: '#e8627a', pith: '#ffe6e0', flesh: '#ff8a8a' },
  { rind: '#e9c91c', pith: '#fff8cf', flesh: '#ffe34d' },
];

const fruit: Painter = (c, x, y, r, i) => {
  const look = FRUIT[i % FRUIT.length]!;
  c.fillStyle = look.rind;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.fillStyle = look.pith;
  dot(c, x, y, Math.max(0.5, r * 0.88));
  c.fillStyle = look.flesh;
  const segments = 8;
  const inner = Math.max(0.5, r * 0.8);
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2 + i;
    c.beginPath();
    c.moveTo(x + Math.cos(a + 0.39) * r * 0.06, y + Math.sin(a + 0.39) * r * 0.06);
    c.arc(x, y, inner, a + 0.06, a + (Math.PI * 2) / segments - 0.06);
    c.closePath();
    c.fill();
  }
};

export const OBSTACLE_STYLES: Record<string, ObstacleStyle> = {
  candy: { paint: candy, debris: (i) => CANDY[i % CANDY.length]!.fill },
  bw: { paint: blackWhite, debris: (i) => (i % 2 === 0 ? '#161616' : '#e8e8e8') },
  planets: { paint: planets, debris: () => '#a8836a' },
  moon: { paint: moon, debris: () => '#a4a7b0' },
  cookies: { paint: cookies, debris: () => '#c28f4f' },
  pool: { paint: pool, debris: (i) => POOL[i % 8]! },
  neon: { paint: neon, debris: (i) => NEON[i % NEON.length]! },
  fruit: { paint: fruit, debris: (i) => FRUIT[i % FRUIT.length]!.flesh },
};

export function obstacleStyle(id: string | undefined): ObstacleStyle {
  return (id && OBSTACLE_STYLES[id]) || OBSTACLE_STYLES.candy!;
}

/** Draws one obstacle, clipped to its circle. */
export function drawObstacle(c: CanvasRenderingContext2D, style: ObstacleStyle, x: number, y: number, r: number, i: number): void {
  c.save();
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.clip();
  style.paint(c, x, y, r, i);
  c.restore();
}
