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

// 通常画像を「ズームすると同じ画像に戻る」自己相似画像へ変換する。
// 窓(中心 cx,cy・大きさ size=1/f)に画像自身を縮小して再帰的に埋め込む。
// 結果は蓄積点 p* = (c - 0.5·size)/(1 - size) まわりの ×f スケールに対して不変。
export function makeSelfSimilar(
  src: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  S = 1024
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, S, S); // レベル0(元画像全体)

  const r = Math.min(Math.max(size, 0.05), 0.95);
  const levels = Math.min(16, Math.ceil(Math.log(S) / Math.log(1 / r)) + 1);
  // 窓への写像 T(p) = (p - 0.5)·r + (cx,cy) を繰り返し適用して縮小コピーを重ねる
  let kx = 0.5;
  let ky = 0.5;
  let scale = 1;
  for (let k = 1; k <= levels; k++) {
    kx = (kx - 0.5) * r + cx;
    ky = (ky - 0.5) * r + cy;
    scale *= r;
    const w = scale * S;
    if (w < 1) break;
    ctx.drawImage(src, kx * S - w / 2, ky * S - w / 2, w, w);
  }
  return c;
}
