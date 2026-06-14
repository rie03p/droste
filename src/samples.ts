// 各エフェクトの代表的な初期画像。
// 権利問題を避けるため、すべてその場で手続き的に描画する(外部画像・既存作品は使わない)。

function cv(size = 512): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; S: number } {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, ctx: c.getContext("2d")!, S: size };
}

// Droste(再帰ズーム): 入れ子のフレーム。無限に枠が続く様子が分かる。
export function sampleFrames(): HTMLCanvasElement {
  const { c, ctx, S } = cv();
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, "#0b1f3a");
  g.addColorStop(1, "#3a0b2e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  const colors = ["#f4d35e", "#ee964b", "#f95738", "#5fa8d3", "#faf0ca"];
  let i = 0;
  for (let m = 8; m < S / 2 - 6; m += 24) {
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = 9;
    ctx.strokeRect(m, m, S - 2 * m, S - 2 * m);
    i++;
  }
  ctx.fillStyle = "#faf0ca";
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 16, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

// Escher 渦: 市松模様。螺旋に巻き込まれる様子が一番分かりやすい。
export function sampleCheckerboard(): HTMLCanvasElement {
  const { c, ctx, S } = cv();
  const n = 8;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#1d3557" : "#e63946";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const rg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "rgba(255,255,255,0.28)");
  rg.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// べき乗 z^n: 色相環 + 同心円。n 回対称が映える。
export function sampleWheel(): HTMLCanvasElement {
  const { c, ctx, S } = cv();
  const cx = S / 2;
  const cy = S / 2;
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, S * 0.72, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `hsl(${(i / seg) * 360}, 70%, 55%)`;
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 3;
  for (let r = 36; r < S / 2; r += 36) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

// 複素 exp: 縦縞。exp 写像で縞が同心円・螺旋へ変わる。
export function sampleStripes(): HTMLCanvasElement {
  const { c, ctx, S } = cv();
  const n = 12;
  const w = S / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `hsl(${(i / n) * 300 + 20}, 65%, ${i % 2 ? 45 : 60}%)`;
    ctx.fillRect(i * w, 0, w, S);
  }
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let y = 0; y < S; y += w) {
    ctx.fillRect(0, y, S, 3);
  }
  return c;
}
