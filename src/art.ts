/** Branch-only visual exploration. `?art=original` retains the shipped renderer. */
export const cartoonArt = new URLSearchParams(location.search).get('art') !== 'original';
export const previewScene = new URLSearchParams(location.search).get('scene');
export const inComparison = new URLSearchParams(location.search).get('embed') === '1';

const INK = '#193c43';

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2;
    const d = i % 2 ? r * .45 : r;
    g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  g.closePath();
  g.fill();
}

/** Painted once per resize; no images, network requests, or per-frame filters. */
export function paintCartoonBackdrop(g: CanvasRenderingContext2D, W: number, H: number, attract: boolean) {
  g.save();
  g.lineJoin = 'round';
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#ffe6b6');
  sky.addColorStop(1, '#ffb995');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // Cream paper booth with three recessed, illustrated shooting lanes.
  g.fillStyle = '#fff7df';
  g.fillRect(W * .025, H * .13, W * .95, H);
  const bottom = H * (attract ? .93 : .84);
  const top = H * .2;
  const ys = [.36, .67, .97].map(n => top + (bottom - top) * n);
  const laneHeight = (ys[1] - ys[0]) * .88;
  for (let row = 0; row < 3; row++) {
    const y = ys[row] - laneHeight;
    g.fillStyle = ['#b6d9cc', '#c6dfce', '#cfe1c9'][row];
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(W * .045, y, W * .91, laneHeight + 8, [24, 24, 0, 0]);
    g.fill();
    g.stroke();
    g.save();
    g.beginPath();
    g.rect(W * .048, y + 2, W * .904, laneHeight);
    g.clip();
    // Screen-printed rays and tiny registration dots.
    g.fillStyle = 'rgba(255,255,235,.25)';
    for (let i = 0; i < 12; i++) {
      const x = i * W / 6;
      g.beginPath();
      g.moveTo(W * .5, ys[row] + laneHeight);
      g.lineTo(x, y);
      g.lineTo(x + W * .07, y);
      g.fill();
    }
    g.fillStyle = 'rgba(25,60,67,.09)';
    for (let x = 0; x < W; x += 21) for (let j = 0; j < 4; j++) {
      g.beginPath();
      g.arc(x + j % 2 * 10, y + 18 + j * 21, 1.1, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 9; i++) {
      const x = (i + .5) * W / 9;
      star(g, x, y + laneHeight * .43, Math.min(13, laneHeight * .11), '#fff5cf');
    }
    g.restore();
  }

  // Canvas canopy: coral/cream stripes, stitched scallops, ink edges.
  const aw = H * .105;
  const stripe = W / Math.max(8, Math.round(W / 85));
  g.fillStyle = 'rgba(25,60,67,.16)';
  g.fillRect(0, aw, W, H * .055);
  for (let x = 0, i = 0; x < W; x += stripe, i++) {
    g.fillStyle = i % 2 ? '#fff3d3' : '#ed6954';
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + stripe, 0);
    g.lineTo(x + stripe, aw);
    g.quadraticCurveTo(x + stripe / 2, aw + H * .065, x, aw);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.beginPath();
    g.moveTo(x + 8, 0);
    g.lineTo(x + 8, aw - 4);
    g.stroke();
  }

  // Wrapped posts and their little brass rivets.
  const post = Math.max(14, W * .025);
  for (const x of [0, W - post]) {
    g.fillStyle = '#ed6954';
    g.fillRect(x, aw, post, H);
    g.fillStyle = '#fda77d';
    g.fillRect(x + post * .2, aw, post * .25, H);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.strokeRect(x, aw, post, H);
    for (let y = H * .22; y < H; y += H * .21) {
      g.fillStyle = '#ffe1a0';
      g.beginPath();
      g.arc(x + post / 2, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Hanging marquee keeps the original Thai game name.
  const sw = Math.min(W * .47, 440);
  const sh = Math.max(34, H * .085);
  const sx = (W - sw) / 2;
  g.fillStyle = '#123e46';
  g.strokeStyle = '#f5c75f';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(sx, 5, sw, sh, 14);
  g.fill();
  g.stroke();
  g.font = `700 ${Math.min(sw * .083, sh * .53)}px "Mitr", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff3d3';
  g.fillText('ยิงเป้าแก๊งเพื่อน', W / 2, 5 + sh / 2, sw * .82);
  star(g, sx + 18, 5 + sh / 2, 6, '#f5c75f');
  star(g, sx + sw - 18, 5 + sh / 2, 6, '#f5c75f');
  g.restore();
}

export function paintCartoonShelf(g: CanvasRenderingContext2D, W: number, y: number, h: number, belt: number) {
  g.save();
  g.fillStyle = '#f3b981';
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.fillRect(0, y, W, h * 1.5);
  g.strokeRect(0, y, W, h * 1.5);
  g.fillStyle = '#fff2cf';
  g.fillRect(0, y + 2, W, h * .3);
  g.fillStyle = '#cc7658';
  for (let x = belt % 40 - 40; x < W; x += 40) g.fillRect(x, y + h * .85, 16, 3);
  g.restore();
}

export function paintCartoonCounter(g: CanvasRenderingContext2D, W: number, H: number, y: number, U: number) {
  g.save();
  g.fillStyle = '#216471';
  g.fillRect(0, y, W, H - y);
  g.fillStyle = '#1c5863';
  for (let x = 0; x < W; x += 48) g.fillRect(x, y, 23, H - y);
  g.fillStyle = '#ffda97';
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-5, y, W + 10, U * .5, 5);
  g.fill();
  g.stroke();
  if (H - y > 65) {
    for (const x of [W * .17, W * .83]) {
      star(g, x, y + (H - y) * .57, U * .45, '#ffda97');
      for (const s of [-1, 1]) {
        g.strokeStyle = '#e4b779';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + s * U * .8, y + (H - y) * .57);
        g.lineTo(x + s * U * 2.1, y + (H - y) * .57);
        g.stroke();
      }
    }
  }
  g.restore();
}
