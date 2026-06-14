import { useMemo, useRef, useState } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { Controls } from "./components/Controls";
import { ImageUploader } from "./components/ImageUploader";
import { ImageEditor } from "./components/ImageEditor";
import { ExportPanel } from "./components/ExportPanel";
import { EFFECTS, getEffect } from "./effects";
import { dimsFromLongEdge } from "./aspects";
import { composeSquare, IDENTITY_TRANSFORM, type Transform } from "./util/compose";
import { makeDefaultImage } from "./util/defaultImage";
import type { Renderer } from "./webgl/Renderer";
import "./App.css";

// 全エフェクトのパラメータ初期値をまとめて保持する
function buildInitialParams(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const e of EFFECTS) for (const param of e.params) p[param.key] = param.default;
  return p;
}

export default function App() {
  const [effectId, setEffectId] = useState(EFFECTS[0].id);
  const [params, setParams] = useState<Record<string, number>>(buildInitialParams);
  const [viewScale, setViewScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [animateZoom, setAnimateZoom] = useState(true);
  const [zoomSpeed, setZoomSpeed] = useState(0.15);
  const [zoomDir, setZoomDir] = useState(-1); // -1: 拡大(寄る) / +1: 縮小(引く)
  const [animateRotate, setAnimateRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(0.1);
  const [fogEnabled, setFogEnabled] = useState(false);
  const [fogR, setFogR] = useState(0.16);
  const [fogSoft, setFogSoft] = useState(0.14);
  const [fogStr, setFogStr] = useState(0.9);
  const [original, setOriginal] = useState<CanvasImageSource>(() => makeDefaultImage());
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);

  const [aspect, setAspect] = useState(1); // 幅/高さ
  const rendererRef = useRef<Renderer | null>(null);
  const effect = useMemo(() => getEffect(effectId), [effectId]);
  const view = useMemo(() => dimsFromLongEdge(720, aspect), [aspect]);
  // トリミング結果を正方形テクスチャに焼き込む
  const image = useMemo(() => composeSquare(original, transform, 1024), [original, transform]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Droste Lab</h1>
        <p className="tagline">等角写像で画像を渦に。Escher の Droste 効果と仲間たち。</p>
        <ImageUploader
          onImage={(img) => {
            setOriginal(img);
            setTransform(IDENTITY_TRANSFORM);
          }}
        />
        <ImageEditor
          original={original}
          transform={transform}
          onChange={setTransform}
          onReset={() => setTransform(IDENTITY_TRANSFORM)}
        />
        <Controls
          effect={effect}
          onEffectChange={setEffectId}
          aspect={aspect}
          onAspect={setAspect}
          params={params}
          onParamChange={(k, v) => setParams((prev) => ({ ...prev, [k]: v }))}
          viewScale={viewScale}
          onViewScale={setViewScale}
          rotate={rotate}
          onRotate={setRotate}
          animateZoom={animateZoom}
          onAnimateZoom={setAnimateZoom}
          zoomSpeed={zoomSpeed}
          onZoomSpeed={setZoomSpeed}
          zoomDir={zoomDir}
          onZoomDir={setZoomDir}
          animateRotate={animateRotate}
          onAnimateRotate={setAnimateRotate}
          rotateSpeed={rotateSpeed}
          onRotateSpeed={setRotateSpeed}
          fogEnabled={fogEnabled}
          onFogEnabled={setFogEnabled}
          fogR={fogR}
          onFogR={setFogR}
          fogSoft={fogSoft}
          onFogSoft={setFogSoft}
          fogStr={fogStr}
          onFogStr={setFogStr}
        />
        <ExportPanel
          getRenderer={() => rendererRef.current}
          effect={effect}
          params={params}
          viewScale={viewScale}
          rotate={rotate}
          zoomDir={zoomDir}
          aspect={aspect}
          fogR={fogR}
          fogSoft={fogSoft}
          fogStr={fogEnabled ? fogStr : 0}
        />
      </aside>
      <main className="stage">
        <ShaderCanvas
          image={image}
          effect={effect}
          params={params}
          viewScale={viewScale}
          rotate={rotate}
          animateZoom={animateZoom}
          zoomSpeed={zoomSpeed}
          zoomDir={zoomDir}
          animateRotate={animateRotate}
          rotateSpeed={rotateSpeed}
          fogR={fogR}
          fogSoft={fogSoft}
          fogStr={fogEnabled ? fogStr : 0}
          width={view.width}
          height={view.height}
          onReady={(r) => (rendererRef.current = r)}
        />
      </main>
    </div>
  );
}
