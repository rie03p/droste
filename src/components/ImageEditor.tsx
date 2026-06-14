import { useEffect, useRef } from "react";
import { composeSquare, type Transform } from "../util/compose";

type Props = {
  original: CanvasImageSource | null;
  transform: Transform;
  onChange: (t: Transform) => void;
  onReset: () => void;
};

function Slider(p: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {p.label}
        <code className="var">{p.hint}</code>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => p.onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

const PREVIEW = 168;

export function ImageEditor(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { original, transform } = props;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !original) return;
    const out = composeSquare(original, transform, PREVIEW);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, PREVIEW, PREVIEW);
    ctx.drawImage(out, 0, 0);
  }, [original, transform]);

  const set = (patch: Partial<Transform>) => props.onChange({ ...transform, ...patch });

  return (
    <div className="image-editor">
      <div className="editor-head">
        <span className="field-label">元画像のトリミング</span>
        <button className="link-btn" onClick={props.onReset}>
          リセット
        </button>
      </div>
      <p className="desc">テクスチャに使う正方形の範囲を決める。下が切り出し結果。</p>
      <canvas ref={ref} width={PREVIEW} height={PREVIEW} className="editor-preview" />

      <Slider label="拡大率" hint="scale" min={0.2} max={4} step={0.01} value={transform.scale} onChange={(v) => set({ scale: v })} />
      <Slider label="横位置" hint="x" min={-0.5} max={0.5} step={0.005} value={transform.tx} onChange={(v) => set({ tx: v })} />
      <Slider label="縦位置" hint="y" min={-0.5} max={0.5} step={0.005} value={transform.ty} onChange={(v) => set({ ty: v })} />
      <Slider label="傾き" hint="θ rad" min={0} max={Math.PI * 2} step={0.01} value={transform.rot} onChange={(v) => set({ rot: v })} />
    </div>
  );
}
