// 各エフェクトの代表的な初期画像。
// 権利問題を避けるため、すべてその場で手続き的に描画する(外部画像・既存作品は使わない)。
// 配色は gruvbox パレットで統一する。

// gruvbox のアクセント色(鮮やかな並び)とベース色。
const GB = {
  red: "#cc241d",
  orange: "#d65d0e",
  yellow: "#d79921",
  green: "#98971a",
  aqua: "#689d6a",
  blue: "#458588",
  purple: "#b16286",
  cream: "#fbf1c7", // bg0 light
  bg: "#282828", // bg0 dark
  bgSoft: "#3c3836", // bg1 dark
};
// 色相環的に並べたアクセント(セグメント塗り分け用)
const WHEEL = [GB.red, GB.orange, GB.yellow, GB.green, GB.aqua, GB.blue, GB.purple];

function cv(size = 512): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; S: number } {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, ctx: c.getContext("2d")!, S: size };
}

// Droste(再帰ズーム): 入れ子のフレーム。無限に枠が続く様子が分かる。
export function sampleFrames(): HTMLCanvasElement {
  const { c, ctx, S } = cv();
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, GB.bg);
  g.addColorStop(1, GB.bgSoft);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  const colors = [GB.yellow, GB.orange, GB.red, GB.blue, GB.cream];
  let i = 0;
  for (let m = 8; m < S / 2 - 6; m += 24) {
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = 9;
    ctx.strokeRect(m, m, S - 2 * m, S - 2 * m);
    i++;
  }
  ctx.fillStyle = GB.cream;
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
      ctx.fillStyle = (x + y) % 2 === 0 ? GB.blue : GB.orange;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const rg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, "rgba(251,241,199,0.30)"); // cream で中心を起こす
  rg.addColorStop(1, "rgba(40,40,40,0.32)"); // bg で外周を締める
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// べき乗 z^n: アクセント色の扇 + 同心円。n 回対称が映える。
export function sampleWheel(): HTMLCanvasElement {
  const { c, ctx, S } = cv();
  const cx = S / 2;
  const cy = S / 2;
  const seg = WHEEL.length * 3; // 環を3周ぶん刻んで滑らかに
  ctx.fillStyle = GB.bg;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, S * 0.72, a0, a1);
    ctx.closePath();
    ctx.fillStyle = WHEEL[i % WHEEL.length];
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(251,241,199,0.6)";
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
  const n = WHEEL.length * 2;
  const w = S / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = WHEEL[i % WHEEL.length];
    ctx.fillRect(i * w, 0, w, S);
  }
  ctx.fillStyle = "rgba(251,241,199,0.18)";
  for (let y = 0; y < S; y += w) {
    ctx.fillRect(0, y, S, 3);
  }
  return c;
}
