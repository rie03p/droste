import { useMemo, useRef, useState } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { Controls } from "./components/Controls";
import { ImageUploader } from "./components/ImageUploader";
import { ImageEditor } from "./components/ImageEditor";
import { DrostePanel, type DrosteRect } from "./components/DrostePanel";
import { ExportPanel } from "./components/ExportPanel";
import { EFFECTS, getEffect } from "./effects";
import { dimsFromLongEdge } from "./aspects";
import { composeSquare, makeCover, maxTextureSize, IDENTITY_TRANSFORM, type Transform } from "./util/compose";
import type { Renderer } from "./webgl/Renderer";
import "./App.css";

// ライブ描画(画面/GIF プレビュー)の長辺。重くしすぎないため一定に保つ。
const VIEW_LONG = 1080;
// テクスチャ解像度の下限。入力がこれより小さくても、ズーム時の粗さ抑制のため最低限確保する。
const TEX_MIN = 1536;

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
  const [drosteRect, setDrosteRect] = useState<DrosteRect>({ cx: 0.5, cy: 0.5, size: 1 / 3 }); // ズームする範囲(窓)
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
  // 描画(画面表示・プレビュー)の解像度。テクスチャ解像度とは分離して一定に保つ。
  const view = useMemo(() => dimsFromLongEdge(VIEW_LONG, aspect), [aspect]);

  // テクスチャの長辺 = 入力画像のネイティブ長辺(GPU 上限でのみ頭打ち)。下限 TEX_MIN。
  // これにより入力解像度に実質上限を設けず、ズーム時もネイティブの解像感を保つ。
  const texLong = useMemo(() => {
    const iw = (original as HTMLImageElement | HTMLCanvasElement).width || TEX_MIN;
    const ih = (original as HTMLImageElement | HTMLCanvasElement).height || TEX_MIN;
    return Math.max(TEX_MIN, Math.min(Math.round(Math.max(iw, ih)), maxTextureSize()));
  }, [original]);
  const texDims = useMemo(() => dimsFromLongEdge(texLong, aspect), [texLong, aspect]);

  // トリミング結果を正方形に焼き込む(高解像度でズーム時の粗さを抑える)
  const square = useMemo(() => composeSquare(original, transform, texLong), [original, transform, texLong]);

  // 「ズームする範囲を指定」を使う自己相似系か。窓から f=1/size を決めて u_zoomF に注入する。
  const usesWindow = !!effect.usesWindow;
  // 窓のサイズからズーム倍率 f=1/size を決め、u_zoomF に注入する。
  // size はシェーダの窓サイズ(u_win.z)と完全一致させること(ずれるとループが崩れる)。
  const zoomF = 1 / drosteRect.size;
  const renderParams = useMemo(
    () => (usesWindow ? { ...params, zoomF } : params),
    [usesWindow, params, zoomF]
  );
  // 自己相似系のレベル0画像(ビュー比)。
  // 描画解像度ではなくテクスチャ解像度(texDims)で焼き、ズーム時もネイティブの解像感を保つ。
  const cover = useMemo(
    () => makeCover(square, texDims.width, texDims.height),
    [square, texDims.width, texDims.height]
  );

  // テクスチャ: 自己相似系=ビュー比レベル0(cover) / 他=正方形クロップ(square)
  const texture = usesWindow ? cover : square;
  const imageVersion = `src:${usesWindow ? "cover" : "square"}:${square.width}:${view.width}`;

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
        {usesWindow && <DrostePanel texture={cover} rect={drosteRect} onRect={setDrosteRect} />}
        <ExportPanel
          getRenderer={() => rendererRef.current}
          effect={effect}
          params={renderParams}
          viewScale={viewScale}
          rotate={rotate}
          zoomDir={zoomDir}
          aspect={aspect}
          fogR={fogR}
          fogSoft={fogSoft}
          fogStr={fogEnabled ? fogStr : 0}
          winX={drosteRect.cx}
          winY={1 - drosteRect.cy}
          winSize={drosteRect.size}
        />
      </aside>
      <main className="stage">
        <ShaderCanvas
          image={texture}
          imageVersion={imageVersion}
          effect={effect}
          params={renderParams}
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
          winX={drosteRect.cx}
          winY={1 - drosteRect.cy}
          winSize={drosteRect.size}
          width={view.width}
          height={view.height}
          onReady={(r) => (rendererRef.current = r)}
        />
      </main>
    </div>
  );
}
