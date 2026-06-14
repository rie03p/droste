// 起動時に表示するデフォルト画像(グリッド + グラデーション)を生成する。
// 等角写像の効果が一目で分かるよう、方眼と色のグラデーションを描く。
export function makeDefaultImage(size = 512): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;

  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, "#1e3a8a");
  g.addColorStop(0.5, "#7c3aed");
  g.addColorStop(1, "#db2777");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // 方眼
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const p = (i / n) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // 中央の目印
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `bold ${size * 0.12}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DROSTE", size / 2, size / 2);

  return c;
}
