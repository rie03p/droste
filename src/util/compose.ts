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
