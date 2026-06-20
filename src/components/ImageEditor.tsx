import { useEffect, useRef, useState } from "react";
import { type Transform } from "../util/compose";
import { Slider } from "./Slider";

type Props = {
  original: CanvasImageSource | null;
  transform: Transform;
  onChange: (t: Transform) => void;
  onReset: () => void;
};

// 切り出し矩形の指定。画像正規化座標で持つ(直感的に扱える)。
//   cx, cy: 切り出し中心(0..1, 画像の幅/高さに対する割合)
//   size  : 切り出しの一辺(画像の短辺に対する割合。1=短辺いっぱい=従来の正方形クロップ)
//   rot   : 傾き(rad)
type CropSpec = { cx: number; cy: number; size: number; rot: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const SIZE_MIN = 0.05; // これ以上寄ると粗くなる下限
const SIZE_MAX = 2; // 1 超で短辺より広く(周囲に黒余白)

// Transform(composeSquare 用)と CropSpec の相互変換。
// composeSquare では出力正方形が短辺 m=min(iw,ih) を基準に cover されるので、
//   切り出し一辺 D = m / scale、中心の画素位置 px = iw/2 - tx*D が成り立つ。
function specFromTransform(t: Transform, iw: number, ih: number): CropSpec {
  const m = Math.min(iw, ih);
  const D = m / t.scale;
  return {
    size: D / m, // = 1 / scale
    cx: (iw / 2 - t.tx * D) / iw,
    cy: (ih / 2 - t.ty * D) / ih,
    rot: t.rot,
  };
}

function transformFromSpec(s: CropSpec, iw: number, ih: number): Transform {
  const m = Math.min(iw, ih);
  const D = s.size * m;
  return {
    scale: m / D, // = 1 / size
    tx: (iw / 2 - s.cx * iw) / D,
    ty: (ih / 2 - s.cy * ih) / D,
    rot: s.rot,
  };
}

const PREVIEW_LONG = 240; // プレビューの内部解像度(長辺)

export function ImageEditor(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { original, transform } = props;
  // ドラッグ中の状態。move のときは掴んだ点と枠中心のオフセット(画素)を保持し、
  // 相対移動にする(クリックした瞬間に枠がカーソル位置へ飛ぶのを防ぐ)。
  const [drag, setDrag] = useState<null | { mode: "move" | "resize"; ox: number; oy: number }>(
    null,
  );

  const iw = (original as HTMLImageElement | HTMLCanvasElement | null)?.width || 1;
  const ih = (original as HTMLImageElement | HTMLCanvasElement | null)?.height || 1;
  const m = Math.min(iw, ih);
  // プレビューの内部解像度(画像アスペクト比を維持。長辺 = PREVIEW_LONG)
  const cw = iw >= ih ? PREVIEW_LONG : Math.round((PREVIEW_LONG * iw) / ih);
  const ch = iw >= ih ? Math.round((PREVIEW_LONG * ih) / iw) : PREVIEW_LONG;

  const spec = specFromTransform(transform, iw, ih);

  // プレビュー(元画像 + 切り出し矩形)を描画
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !original) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(original, 0, 0, cw, ch);

    const ps = cw / iw; // 画素 → プレビュー px
    const D = spec.size * m * ps;
    // 矩形外を暗く
    ctx.save();
    ctx.translate(spec.cx * iw * ps, spec.cy * ih * ps);
    ctx.rotate(spec.rot);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-D / 2, -D / 2, D, D);
    ctx.fillStyle = "#a78bfa";
    ctx.fillRect(D / 2 - 5, D / 2 - 5, 10, 10); // 右下リサイズハンドル
    ctx.restore();
  }, [original, spec.cx, spec.cy, spec.size, spec.rot, iw, ih, m, cw, ch]);

  const set = (patch: Partial<CropSpec>) =>
    props.onChange(transformFromSpec({ ...spec, ...patch }, iw, ih));

  // ポインタ位置を画素座標へ
  const toPx = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * iw, y: ((e.clientY - r.top) / r.height) * ih };
  };

  const apply = (p: { x: number; y: number }, mode: "move" | "resize", ox = 0, oy = 0) => {
    if (mode === "move") {
      set({ cx: clamp((p.x + ox) / iw, 0, 1), cy: clamp((p.y + oy) / ih, 0, 1) });
    } else {
      // 回転フレームでの中心からの距離で一辺を決める
      const dx = p.x - spec.cx * iw;
      const dy = p.y - spec.cy * ih;
      const c = Math.cos(-spec.rot);
      const s = Math.sin(-spec.rot);
      const half = Math.max(Math.abs(dx * c - dy * s), Math.abs(dx * s + dy * c));
      set({ size: clamp((2 * half) / m, SIZE_MIN, SIZE_MAX) });
    }
  };

  return (
    <div className="image-editor">
      <div className="editor-head">
        <span className="field-label">元画像のトリミング</span>
        <button className="link-btn" onClick={props.onReset}>
          リセット
        </button>
      </div>
      <p className="desc">
        枠をドラッグで移動、右下の角でサイズ変更。枠の中だけがテクスチャに使われる（枠外は黒余白）。
      </p>
      <canvas
        ref={ref}
        width={cw}
        height={ch}
        className="editor-preview"
        onPointerDown={(e) => {
          if (!original) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const p = toPx(e);
          // 右下ハンドル(回転考慮)付近ならリサイズ
          const D = spec.size * m;
          const c = Math.cos(spec.rot);
          const s = Math.sin(spec.rot);
          const hx = spec.cx * iw + (c * (D / 2) - s * (D / 2));
          const hy = spec.cy * ih + (s * (D / 2) + c * (D / 2));
          const mode = Math.hypot(p.x - hx, p.y - hy) < 0.07 * m ? "resize" : "move";
          // 掴んだ点と枠中心のオフセットを保持。即適用はしない(クリックでジャンプさせない)。
          setDrag({ mode, ox: spec.cx * iw - p.x, oy: spec.cy * ih - p.y });
        }}
        onPointerMove={(e) => drag && apply(toPx(e), drag.mode, drag.ox, drag.oy)}
        onPointerUp={() => setDrag(null)}
      />

      <Slider
        label="切り出しサイズ"
        hint="小=寄る"
        min={SIZE_MIN}
        max={SIZE_MAX}
        step={0.01}
        value={spec.size}
        steppers
        onChange={(v) => set({ size: v })}
      />
      <Slider
        label="横位置"
        hint="0..1"
        min={0}
        max={1}
        step={0.005}
        value={spec.cx}
        steppers
        onChange={(v) => set({ cx: v })}
      />
      <Slider
        label="縦位置"
        hint="0..1"
        min={0}
        max={1}
        step={0.005}
        value={spec.cy}
        steppers
        onChange={(v) => set({ cy: v })}
      />
      <Slider
        label="傾き"
        hint="θ rad"
        min={0}
        max={Math.PI * 2}
        step={0.01}
        value={spec.rot}
        steppers
        onChange={(v) => set({ rot: v })}
      />
    </div>
  );
}
