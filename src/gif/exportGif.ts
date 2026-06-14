import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { Renderer } from "../webgl/Renderer";
import type { Effect } from "../effects";

export type ExportMode = "zoom" | "rotate" | "both";

export type ExportOptions = {
  effect: Effect;
  params: Record<string, number>;
  viewScale: number;
  rotate: number; // 基準回転
  mode: ExportMode;
  rotateTurns: number; // "both"/"rotate" でループ中に回す周回数(整数=シームレス)
  size: number; // 出力 GIF の一辺(px)
  frames: number; // フレーム数(1ループ)
  fps: number;
  onProgress?: (ratio: number) => void;
};

const TAU = Math.PI * 2;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// 1 ループ分のフレームを生成してシームレスループ GIF を書き出す。
// - zoom : u_offset を 0→period(=ln f 相当) で回す → f 倍に拡大して同じ画像に戻る
// - rotate: 回転を 0→turns*TAU で回す
// - both : 上の両方を同時に
export async function exportGif(renderer: Renderer, opts: ExportOptions): Promise<Blob> {
  const { effect, params, viewScale, rotate, mode, rotateTurns, size, frames, fps } = opts;

  const out = document.createElement("canvas");
  out.width = out.height = size;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;

  const period = effect.animPeriod(params);
  const delay = Math.round(1000 / fps);
  const gif = GIFEncoder();

  for (let i = 0; i < frames; i++) {
    const t = i / frames; // 0..1(端でつながる)
    const offset = mode === "rotate" ? 0 : period * t;
    const turns = mode === "zoom" ? 0 : rotateTurns;
    const frameRotate = rotate + turns * TAU * t;

    renderer.render({ effect, params, viewScale, rotate: frameRotate, offset });
    ctx.drawImage(renderer.canvas, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, size, size, { palette, delay });

    opts.onProgress?.((i + 1) / frames);
    await nextFrame(); // UI を固めないよう毎フレーム譲る
  }

  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}

// 現在キャンバスに映っているフレームを PNG として保存する。
export function downloadCanvasPng(renderer: Renderer, filename: string) {
  renderer.canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
