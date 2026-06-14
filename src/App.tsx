import { useMemo, useRef, useState } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { Controls } from "./components/Controls";
import { ImageUploader } from "./components/ImageUploader";
import { ImageEditor } from "./components/ImageEditor";
import { DrostePanel } from "./components/DrostePanel";
import { ExportPanel } from "./components/ExportPanel";
import { EFFECTS, getEffect } from "./effects";
import { dimsFromLongEdge } from "./aspects";
import { composeSquare, makeSelfSimilar, IDENTITY_TRANSFORM, type Transform } from "./util/compose";
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
  const [zoomDir, setZoomDir] = useState(1); // +1: 拡大(寄る) / -1: 縮小(引く)
  const [animateRotate, setAnimateRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(0.1);
  const [fogEnabled, setFogEnabled] = useState(false);
  const [fogR, setFogR] = useState(0.16);
  const [fogSoft, setFogSoft] = useState(0.14);
  const [fogStr, setFogStr] = useState(0.9);
  const [original, setOriginal] = useState<CanvasImageSource>(() => EFFECTS[0].sample());
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);
  // 初期サンプル表示中か(ユーザー画像をアップしたら false)。サンプル中はエフェクト切替で代表画像を差し替える。
  const [usingSample, setUsingSample] = useState(true);

  const [aspect, setAspect] = useState(1); // 幅/高さ
  const [drosteTarget, setDrosteTarget] = useState({ x: 0.5, y: 0.5 }); // Droste のズーム蓄積点
  const rendererRef = useRef<Renderer | null>(null);
  const effect = useMemo(() => getEffect(effectId), [effectId]);

  const handleEffectChange = (id: string) => {
    setEffectId(id);
    if (usingSample) {
      // サンプル表示中はそのエフェクトの代表画像に差し替える
      setOriginal(getEffect(id).sample());
      setTransform(IDENTITY_TRANSFORM);
    }
  };
  const view = useMemo(() => dimsFromLongEdge(720, aspect), [aspect]);

  // トリミング結果を正方形に焼き込む
  const square = useMemo(() => composeSquare(original, transform, 1024), [original, transform]);

  const isDroste = effect.id === "droste";
  const zoomF = params.zoomF ?? 3;
  // Droste では指定した蓄積点へ画像自身を埋め込み、自己相似画像にする
  const drosteWindow = useMemo(() => {
    const size = 1 / Math.max(zoomF, 1.0001);
    return {
      size,
      cx: drosteTarget.x * (1 - size) + 0.5 * size,
      cy: drosteTarget.y * (1 - size) + 0.5 * size,
    };
  }, [zoomF, drosteTarget]);
  const texture = useMemo(
    () => (isDroste ? makeSelfSimilar(square, drosteWindow.cx, drosteWindow.cy, drosteWindow.size, 1024) : square),
    [isDroste, square, drosteWindow]
  );
  const center = isDroste ? drosteTarget : { x: 0.5, y: 0.5 };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Droste Lab</h1>
        <p className="tagline">等角写像で画像を渦に。Escher の Droste 効果と仲間たち。</p>
        <ImageUploader
          onImage={(img) => {
            setOriginal(img);
            setTransform(IDENTITY_TRANSFORM);
            setUsingSample(false);
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
          onEffectChange={handleEffectChange}
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
        {isDroste && <DrostePanel texture={texture} target={drosteTarget} onTarget={setDrosteTarget} />}
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
          centerX={center.x}
          centerY={center.y}
        />
      </aside>
      <main className="stage">
        <ShaderCanvas
          image={texture}
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
          centerX={center.x}
          centerY={center.y}
          width={view.width}
          height={view.height}
          onReady={(r) => (rendererRef.current = r)}
        />
      </main>
    </div>
  );
}
