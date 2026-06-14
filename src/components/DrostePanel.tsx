import { useEffect, useRef, useState } from "react";

type Props = {
  texture: HTMLCanvasElement; // 自己相似化した結果(プレビュー用)
  target: { x: number; y: number };
  onTarget: (t: { x: number; y: number }) => void;
};

const PS = 200;

export function DrostePanel(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const { texture, target } = props;

  // プレビュー(自己相似画像 + ズーム中心マーカー)を描画
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, PS, PS);
    ctx.drawImage(texture, 0, 0, PS, PS);
    const px = target.x * PS;
    const py = target.y * PS;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.moveTo(px - 14, py);
    ctx.lineTo(px + 14, py);
    ctx.moveTo(px, py - 14);
    ctx.lineTo(px, py + 14);
    ctx.stroke();
  }, [texture, target]);

  const pick = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    props.onTarget({ x, y });
  };

  return (
    <div className="droste-panel">
      <span className="field-label">ズームする場所を指定</span>
      <p className="desc">
        下のプレビューをクリック / ドラッグでズーム中心を指定。その点に画像自身が埋め込まれ、通常の画像でも
        「拡大すると同じ画像」になる。
      </p>
      <canvas
        ref={ref}
        width={PS}
        height={PS}
        className="droste-preview"
        onPointerDown={(e) => {
          setDragging(true);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => dragging && pick(e)}
        onPointerUp={() => setDragging(false)}
      />
      <p className="desc">深さ(1段の拡大率)は下の「自己相似スケール f」で調整。</p>
    </div>
  );
}
