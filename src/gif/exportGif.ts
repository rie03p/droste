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
  zoomDir: number; // +1: 縮小 / -1: 拡大
  fogR: number;
  fogSoft: number;
  fogStr: number;
  winX: number;
  winY: number;
  winSize: number;
  width: number; // 出力 GIF の幅(px)
  height: number; // 出力 GIF の高さ(px)
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
  const {
    effect,
    params,
    viewScale,
    rotate,
    mode,
    rotateTurns,
    zoomDir,
    fogR,
    fogSoft,
    fogStr,
    winX,
    winY,
    winSize,
    width,
    height,
    frames,
    fps,
  } = opts;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;

  const period = effect.animPeriod(params);
  const delay = Math.round(1000 / fps);
  const gif = GIFEncoder();

  for (let i = 0; i < frames; i++) {
    const t = i / frames; // 0..1(端でつながる)
    // zoomDir<0(拡大)のときは offset を減少方向に。どちら向きでもループはシームレス。
    const zt = zoomDir < 0 ? 1 - t : t;
    const offset = mode === "rotate" ? 0 : period * zt;
    const turns = mode === "zoom" ? 0 : rotateTurns;
    const frameRotate = rotate + turns * TAU * t;

    renderer.render({
      effect,
      params,
      viewScale,
      rotate: frameRotate,
      offset,
      fogR,
      fogSoft,
      fogStr,
      winX,
      winY,
      winSize,
    });
    ctx.drawImage(renderer.canvas, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay });

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
