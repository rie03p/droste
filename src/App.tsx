import { useMemo, useRef, useState } from "react";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { Controls } from "./components/Controls";
import { ImageUploader } from "./components/ImageUploader";
import { ImageEditor } from "./components/ImageEditor";
import { DrostePanel, type DrosteRect } from "./components/DrostePanel";
import { StripPanel } from "./components/StripPanel";
import { ExportPanel } from "./components/ExportPanel";
import { EFFECTS, getEffect } from "./effects";
import { dimsFromLongEdge } from "./aspects";
import { composeSquare, makeCover, IDENTITY_TRANSFORM, type Transform } from "./util/compose";
import { LogStripBaker } from "./webgl/LogStripBaker";
import type { Renderer } from "./webgl/Renderer";
import "./App.css";

// log 帯テクスチャの解像度(横=対数半径, 縦=角度)
const STRIP_W = 1280;
const STRIP_H = 640;
// 帯モードは自己相似の窓を使わない。中心=画像中心・f 固定で焼き、巻き戻しは z 送り+exp のみ。
const STRIP_WIN = { cx: 0.5, cy: 0.5, size: 1 / 3 };
const STRIP_F = 1 / STRIP_WIN.size;

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
  const [drosteRect, setDrosteRect] = useState<DrosteRect>({ cx: 0.5, cy: 0.5, size: 1 / 3 }); // Droste のズーム窓
  // ソース: 元画像 / log 帯(中間画像)。帯モードでは log-polar に焼いた帯をテクスチャに使う。
  const [sourceMode, setSourceMode] = useState<"original" | "strip">("original");
  const [replacedStrip, setReplacedStrip] = useState<HTMLImageElement | null>(null); // 編集後に差し替えた帯
  const rendererRef = useRef<Renderer | null>(null);
  const bakerRef = useRef<LogStripBaker | null>(null);
  const effect = useMemo(() => getEffect(effectId), [effectId]);

  const handleEffectChange = (id: string) => {
    setEffectId(id);
    // ドロステ化(帯巻き戻し)は log 帯ソース前提なので自動で帯モードへ
    if (id === "expwrap") setSourceMode("strip");
    if (usingSample) {
      // サンプル表示中はそのエフェクトの代表画像に差し替える
      setOriginal(getEffect(id).sample());
      setTransform(IDENTITY_TRANSFORM);
    }
  };
  const view = useMemo(() => dimsFromLongEdge(1080, aspect), [aspect]);

  // トリミング結果を正方形に焼き込む(高解像度でズーム時の粗さを抑える)
  const square = useMemo(() => composeSquare(original, transform, 1536), [original, transform]);

  // Droste / Escher / 対数 は同じ自己相似画像(窓に画像自身を埋め込み)を使う
  const isSelfSimilar = effect.id === "droste" || effect.id === "escher" || effect.id === "log";
  const useStrip = sourceMode === "strip" || effect.id === "expwrap";
  // 自己相似系(元画像ソース)だけ窓(drosteRect)で f を決める。帯モードは f 固定。
  const usesDrosteWindow = isSelfSimilar && !useStrip;
  const needsWindow = usesDrosteWindow || effect.id === "expwrap";
  const win = usesDrosteWindow ? drosteRect : STRIP_WIN;
  const zoomF = usesDrosteWindow ? 1 / drosteRect.size : STRIP_F;
  // 窓のサイズからズーム倍率 f=1/size を決め、u_zoomF に注入する。
  // size はシェーダの窓サイズ(u_win.z)と完全一致させること(ずれるとループが崩れる)。
  const renderParams = useMemo(
    () => (needsWindow ? { ...params, zoomF } : params),
    [needsWindow, params, zoomF]
  );
  // 自己相似系のレベル0画像(ビュー比)。帯ベイクの入力にもこれを使う。
  const cover = useMemo(() => makeCover(square, view.width, view.height), [square, view.width, view.height]);

  // log 帯(中間画像)を焼く。帯モードは窓を使わず中心=画像中心・f 固定で焼く。
  const bakedStrip = useMemo(() => {
    if (!useStrip) return null;
    const baker = (bakerRef.current ??= new LogStripBaker());
    return baker.bake(
      cover,
      { zoomF: STRIP_F, winX: STRIP_WIN.cx, winY: 1 - STRIP_WIN.cy, winSize: STRIP_WIN.size },
      STRIP_W,
      STRIP_H
    );
  }, [useStrip, cover]);
  const stripSource = replacedStrip ?? bakedStrip;

  // テクスチャ: 帯モード=帯 / 自己相似=ビュー比レベル0 / それ以外=正方形クロップ
  const texture = useStrip ? stripSource ?? cover : isSelfSimilar ? cover : square;
  // 帯はベイカーが上下反転済みなのでメインでは反転しない。元画像系は反転する。
  const flipImageY = !useStrip;
  // 同一 canvas を再ベイクしても参照が変わらないので、内容変化を検知させるための版番号
  const imageVersion = useStrip
    ? `strip:${replacedStrip ? "edited" : "baked"}:${square.width}`
    : `src:${isSelfSimilar ? "cover" : "square"}:${square.width}:${view.width}`;

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
            setReplacedStrip(null);
          }}
        />
        <div className="field">
          <span className="field-label">ソース</span>
          <select
            className="full-select"
            value={sourceMode}
            onChange={(e) => setSourceMode(e.target.value as "original" | "strip")}
          >
            <option value="original">元画像</option>
            <option value="strip">log 帯（中間画像）</option>
          </select>
          <p className="desc">
            log 帯にすると元画像を log-polar に焼いた帯がソースになる。exp 系で巻き戻すと Droste、
            他のエフェクトに通すと帯ならではの渦になる。
          </p>
        </div>
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
        {usesDrosteWindow && <DrostePanel texture={cover} rect={drosteRect} onRect={setDrosteRect} />}
        {useStrip && stripSource && (
          <StripPanel
            strip={bakedStrip ?? cover}
            replaced={replacedStrip}
            onReplace={setReplacedStrip}
          />
        )}
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
          winX={win.cx}
          winY={1 - win.cy}
          winSize={win.size}
        />
      </aside>
      <main className="stage">
        <ShaderCanvas
          image={texture}
          imageVersion={imageVersion}
          flipImageY={flipImageY}
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
          winX={win.cx}
          winY={1 - win.cy}
          winSize={win.size}
          width={view.width}
          height={view.height}
          onReady={(r) => (rendererRef.current = r)}
        />
      </main>
    </div>
  );
}
