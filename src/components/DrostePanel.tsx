import { useEffect, useRef, useState } from "react";

export type DrosteRect = { cx: number; cy: number; size: number };

type Props = {
  texture: HTMLCanvasElement; // 自己相似化した結果(プレビュー用、ビュー比)
  rect: DrosteRect;
  onRect: (r: DrosteRect) => void;
};

const PW = 220; // プレビュー幅

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function DrostePanel(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<null | "move" | "resize">(null);
  const { texture, rect } = props;
  const ph = Math.round((PW * texture.height) / texture.width); // プレビュー高さ(ビュー比)

  // プレビュー(自己相似画像 + ズーム窓の矩形)を描画
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, PW, ph);
    ctx.drawImage(texture, 0, 0, PW, ph);
    const x = (rect.cx - rect.size / 2) * PW;
    const y = (rect.cy - rect.size / 2) * ph;
    const w = rect.size * PW;
    const h = rect.size * ph;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    // リサイズハンドル(右下)
    ctx.fillStyle = "#a78bfa";
    ctx.fillRect(x + w - 7, y + h - 7, 9, 9);
  }, [texture, rect, ph]);

  const norm = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };

  const apply = (n: { x: number; y: number }, m: "move" | "resize") => {
    if (m === "resize") {
      const half = Math.max(Math.abs(n.x - rect.cx), Math.abs(n.y - rect.cy));
      const size = clamp(2 * half, 0.02, 0.9);
      props.onRect(clampRect({ ...rect, size }));
    } else {
      props.onRect(clampRect({ ...rect, cx: n.x, cy: n.y }));
    }
  };

  return (
    <div className="droste-panel">
      <span className="field-label">ズームする範囲を指定</span>
      <p className="desc">
        矩形(ビューと同じ比率)をドラッグで移動、右下の角でサイズ変更。その範囲に画像自身が埋め込まれ、
        通常画像でも「拡大すると同じ画像」になる。矩形が小さいほど1段の拡大率が上がる。
      </p>
      <canvas
        ref={ref}
        width={PW}
        height={ph}
        className="droste-preview"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const n = norm(e);
          // 右下ハンドル付近ならリサイズ、それ以外は移動
          const brx = rect.cx + rect.size / 2;
          const bry = rect.cy + rect.size / 2;
          const m = Math.abs(n.x - brx) < 0.06 && Math.abs(n.y - bry) < 0.06 ? "resize" : "move";
          setMode(m);
          apply(n, m);
        }}
        onPointerMove={(e) => mode && apply(norm(e), mode)}
        onPointerUp={() => setMode(null)}
      />

      <div className="droste-inputs">
        <label>
          横位置
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={round(rect.cx)}
            onChange={(e) => setField("cx", e.target.value)}
          />
        </label>
        <label>
          縦位置
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={round(rect.cy)}
            onChange={(e) => setField("cy", e.target.value)}
          />
        </label>
        <label>
          大きさ
          <input
            type="number"
            min={0.02}
            max={0.9}
            step={0.01}
            value={round(rect.size)}
            onChange={(e) => setField("size", e.target.value)}
          />
        </label>
      </div>
      <p className="desc">1段あたりの拡大率 f = {(1 / rect.size).toFixed(1)}</p>
    </div>
  );

  function setField(key: keyof DrosteRect, raw: string) {
    const v = parseFloat(raw);
    if (Number.isNaN(v)) return;
    const next = { ...rect, [key]: key === "size" ? clamp(v, 0.02, 0.9) : clamp(v, 0, 1) };
    props.onRect(clampRect(next));
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// 矩形をビュー内に収める
function clampRect(r: DrosteRect): DrosteRect {
  const h = r.size / 2;
  return { size: r.size, cx: clamp(r.cx, h, 1 - h), cy: clamp(r.cy, h, 1 - h) };
}
