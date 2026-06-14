// 入力画像をズーム/パン/回転して正方形ソースに焼き込む。
// エフェクトのテクスチャはこの正方形を使うので、ここで構図を決められる。
export type Transform = {
  scale: number; // cover を 1 とした倍率
  tx: number; // 横パン(-0.5..0.5, 正方形に対する割合)
  ty: number; // 縦パン
  rot: number; // 回転(rad)
};

export const IDENTITY_TRANSFORM: Transform = { scale: 1, tx: 0, ty: 0, rot: 0 };

export function composeSquare(src: CanvasImageSource, t: Transform, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);

  const iw = (src as HTMLImageElement | HTMLCanvasElement).width;
  const ih = (src as HTMLImageElement | HTMLCanvasElement).height;
  const cover = Math.max(size / iw, size / ih); // 余白なく埋める基準倍率
  const s = cover * t.scale;

  ctx.translate(size / 2 + t.tx * size, size / 2 + t.ty * size);
  ctx.rotate(t.rot);
  ctx.scale(s, s);
  ctx.drawImage(src, -iw / 2, -ih / 2);
  return c;
}

// src を W×H に余白なく(cover)描く
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, W: number, H: number) {
  const iw = (src as HTMLCanvasElement).width;
  const ih = (src as HTMLCanvasElement).height;
  const scale = Math.max(W / iw, H / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}

// 通常画像を「ズームすると同じ画像に戻る」自己相似画像へ変換する。
// ビューと同じ W×H で焼き、窓(中心 cx,cy・ビュー比に対する大きさ size=1/f)に
// 画像自身を再帰的に埋め込む。蓄積点 p* = ((c-0.5·size)/(1-size)) まわりの ×f に不変。
export function makeSelfSimilar(
  src: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  W: number,
  H: number
): HTMLCanvasElement {
  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  drawCover(base.getContext("2d")!, src, W, H); // ビュー全体の画像(レベル0)

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(base, 0, 0);

  const r = Math.min(Math.max(size, 0.05), 0.95);
  const levels = Math.min(24, Math.ceil(Math.log(Math.max(W, H)) / Math.log(1 / r)) + 1);
  // 窓への写像 T(u) = (u - 0.5)·r + (cx,cy) を繰り返し、縮小コピーを重ねる
  let u = 0.5;
  let v = 0.5;
  let scale = 1;
  for (let k = 1; k <= levels; k++) {
    u = (u - 0.5) * r + cx;
    v = (v - 0.5) * r + cy;
    scale *= r;
    const w = scale * W;
    const h = scale * H;
    if (w < 1 || h < 1) break;
    ctx.drawImage(base, u * W - w / 2, v * H - h / 2, w, h);
  }
  return c;
}

// 窓(中心 cx,cy・大きさ size)からズームの蓄積点 p* を求める。
export function accumulationPoint(cx: number, cy: number, size: number): { x: number; y: number } {
  const d = 1 - size;
  return { x: (cx - 0.5 * size) / d, y: (cy - 0.5 * size) / d };
}
