import { useState } from "react";
import { exportGif, downloadCanvasPng, type ExportMode } from "../gif/exportGif";
import { dimsFromLongEdge } from "../aspects";
import type { Renderer } from "../webgl/Renderer";
import type { Effect } from "../effects";

type Props = {
  getRenderer: () => Renderer | null;
  effect: Effect;
  params: Record<string, number>;
  viewScale: number;
  rotate: number;
  zoomDir: number;
  aspect: number;
  fogR: number;
  fogSoft: number;
  fogStr: number;
};

const MODES: { value: ExportMode; label: string }[] = [
  { value: "zoom", label: "ズーム(同じ画像に戻る)" },
  { value: "rotate", label: "回転" },
  { value: "both", label: "ズーム + 回転" },
];

export function ExportPanel(props: Props) {
  const [mode, setMode] = useState<ExportMode>("zoom");
  const [rotateTurns, setRotateTurns] = useState(1);
  const [size, setSize] = useState(480);
  const [frames, setFrames] = useState(48);
  const [fps, setFps] = useState(24);
  const [progress, setProgress] = useState<number | null>(null);

  const savePng = () => {
    const r = props.getRenderer();
    if (r) downloadCanvasPng(r, `droste-${props.effect.id}-${Date.now()}.png`);
  };

  const run = async () => {
    const r = props.getRenderer();
    if (!r || progress !== null) return;
    setProgress(0);
    try {
      const { width, height } = dimsFromLongEdge(size, props.aspect);
      const blob = await exportGif(r, {
        effect: props.effect,
        params: props.params,
        viewScale: props.viewScale,
        rotate: props.rotate,
        mode,
        rotateTurns,
        zoomDir: props.zoomDir,
        fogR: props.fogR,
        fogSoft: props.fogSoft,
        fogStr: props.fogStr,
        width,
        height,
        frames,
        fps,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `droste-${props.effect.id}-${mode}-${Date.now()}.gif`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="export-panel">
      <h2>書き出し</h2>

      <button className="png-btn" onClick={savePng}>
        現在の画像を保存 (PNG)
      </button>

      <p className="desc" style={{ marginTop: 16 }}>
        アニメーションの 1 周期をシームレスループ GIF に。
      </p>

      <label className="field-label" style={{ marginTop: 10 }}>動き</label>
      <select className="full-select" value={mode} onChange={(e) => setMode(e.target.value as ExportMode)}>
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      <div className="export-grid">
        <label>
          長辺(px)
          <select value={size} onChange={(e) => setSize(+e.target.value)}>
            {[240, 360, 480, 600, 720].map((s) => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </select>
        </label>
        <label>
          フレーム
          <select value={frames} onChange={(e) => setFrames(+e.target.value)}>
            {[24, 36, 48, 60, 90].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          FPS
          <select value={fps} onChange={(e) => setFps(+e.target.value)}>
            {[12, 18, 24, 30].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        {mode !== "zoom" && (
          <label>
            回転周回数
            <select value={rotateTurns} onChange={(e) => setRotateTurns(+e.target.value)}>
              {[1, 2, 3, 4].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button className="export-btn" onClick={run} disabled={progress !== null}>
        {progress === null ? "GIF を生成してダウンロード" : `生成中… ${Math.round(progress * 100)}%`}
      </button>
      {progress !== null && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}
