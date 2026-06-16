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
import { composeSquare, makeCover, maxTextureSize, IDENTITY_TRANSFORM, type Transform } from "./util/compose";
import { LogStripBaker } from "./webgl/LogStripBaker";
import type { Renderer } from "./webgl/Renderer";
import "./App.css";

// log 帯テクスチャの解像度(横=対数半径, 縦=角度)。
// 縦(角度)が外周リングの解像度を決める=画質の要。外周の円周(約2π·Rmax·元画像px)に
// 見合うよう高めに取る。横(半径方向)は1周期 lnf を覆えれば十分なので控えめ。
const STRIP_W = 1536;
const STRIP_H = 4096;
// 帯モードは自己相似の窓(矩形)を使わず中心=画像中心。縮小率 f(=1段の拡大率)だけ可変。
const STRIP_F_DEFAULT = 3;

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
  const [drosteRect, setDrosteRect] = useState<DrosteRect>({ cx: 0.5, cy: 0.5, size: 1 / 3 }); // Droste のズーム窓
  // ソース: 元画像 / 写真をlog帯に焼く / この画像をlog帯として扱う(焼かない=対数済み入力用)。
  const [sourceMode, setSourceMode] = useState<"original" | "bake" | "strip">("original");
  const [stripF, setStripF] = useState(STRIP_F_DEFAULT); // 帯の縮小率 f(=1段の拡大率)
  const [replacedStrip, setReplacedStrip] = useState<HTMLImageElement | null>(null); // 編集後に差し替えた帯
  const rendererRef = useRef<Renderer | null>(null);
  const bakerRef = useRef<LogStripBaker | null>(null);
  const effect = useMemo(() => getEffect(effectId), [effectId]);

  const handleEffectChange = (id: string) => {
    setEffectId(id);
    // ドロステ化(帯巻き戻し)は帯ソース前提。元画像のままなら「写真を焼く」へ。
    if (id === "expwrap") setSourceMode((m) => (m === "original" ? "bake" : m));
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

  // Droste / Escher / 対数 は同じ自己相似画像(窓に画像自身を埋め込み)を使う
  const isSelfSimilar = effect.id === "droste" || effect.id === "escher" || effect.id === "log";
  // 帯の種別: none=元画像 / bake=写真を焼く / direct=この画像をそのまま帯にする(対数済み)
  const stripKind: "none" | "bake" | "direct" =
    sourceMode === "strip" ? "direct" : sourceMode === "bake" || effect.id === "expwrap" ? "bake" : "none";
  const useStrip = stripKind !== "none";
  // 自己相似系(元画像ソース)だけ窓(drosteRect)で f を決める。
  const usesDrosteWindow = isSelfSimilar && !useStrip;
  const needsWindow = usesDrosteWindow || effect.id === "expwrap";
  // 帯モードは中心=画像中心。窓サイズは縮小率 f から決める(size=1/f なら自己相似が成立)。
  const stripWin = useMemo(() => ({ cx: 0.5, cy: 0.5, size: 1 / stripF }), [stripF]);
  const win = usesDrosteWindow ? drosteRect : stripWin;
  const zoomF = usesDrosteWindow ? 1 / drosteRect.size : stripF;
  // 窓のサイズからズーム倍率 f=1/size を決め、u_zoomF に注入する。
  // size はシェーダの窓サイズ(u_win.z)と完全一致させること(ずれるとループが崩れる)。
  const renderParams = useMemo(
    () => (needsWindow ? { ...params, zoomF } : params),
    [needsWindow, params, zoomF]
  );
  // 自己相似系のレベル0画像(ビュー比)。帯ベイクの入力にもこれを使う。
  // 描画解像度ではなくテクスチャ解像度(texDims)で焼き、ズーム時もネイティブの解像感を保つ。
  const cover = useMemo(
    () => makeCover(square, texDims.width, texDims.height),
    [square, texDims.width, texDims.height]
  );

  // log 帯(中間画像)を焼く。中心=画像中心、縮小率 f で1周期ぶんを焼く。bake のときだけ。
  const bakedStrip = useMemo(() => {
    if (stripKind !== "bake") return null;
    const baker = (bakerRef.current ??= new LogStripBaker());
    return baker.bake(
      cover,
      { zoomF: stripF, winX: stripWin.cx, winY: 1 - stripWin.cy, winSize: stripWin.size },
      STRIP_W,
      STRIP_H
    );
  }, [stripKind, cover, stripF, stripWin]);
  const stripSource = replacedStrip ?? bakedStrip;

  // direct: アップロード画像をそのまま帯テクスチャに(焼かない=対数済み入力用)。クロップしない。
  const directStrip = useMemo(() => {
    if (stripKind !== "direct") return null;
    const iw = (original as HTMLImageElement | HTMLCanvasElement).width;
    const ih = (original as HTMLImageElement | HTMLCanvasElement).height;
    const c = document.createElement("canvas");
    c.width = iw;
    c.height = ih;
    c.getContext("2d")!.drawImage(original, 0, 0);
    return c;
  }, [stripKind, original]);

  // テクスチャ: bake=焼いた帯 / direct=画像そのまま / 自己相似=ビュー比レベル0 / 他=正方形クロップ
  const texture =
    stripKind === "bake"
      ? stripSource ?? cover
      : stripKind === "direct"
      ? directStrip ?? cover
      : isSelfSimilar
      ? cover
      : square;
  // bake はベイカーが上下反転済みなのでメインでは反転しない。それ以外は通常の画像として反転。
  const flipImageY = stripKind !== "bake";
  // 同一 canvas を再ベイクしても参照が変わらないので、内容変化を検知させるための版番号
  const imageVersion =
    stripKind === "bake"
      ? `bake:${replacedStrip ? "edited" : "baked"}:${square.width}:${stripF}`
      : stripKind === "direct"
      ? `direct:${square.width}`
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
            onChange={(e) => setSourceMode(e.target.value as "original" | "bake" | "strip")}
          >
            <option value="original">元画像</option>
            <option value="bake">写真を log 帯に焼く</option>
            <option value="strip">この画像は log 帯（焼かない）</option>
          </select>
          <p className="desc">
            「写真を焼く」は元画像を log-polar に焼いて帯にする。「焼かない」は対数済みの画像を
            そのまま帯として扱う（二重に対数を取らない）。どちらも exp 系で巻き戻すと Droste になる。
          </p>
          {useStrip && (
            <label className="slider">
              <span className="slider-label">
                縮小率 f（1段の拡大率）
                <span className="slider-meta">
                  <code className="var">f</code>
                  <em>{stripF.toFixed(1)}</em>
                </span>
              </span>
              <input
                type="range"
                min={1.2}
                max={16}
                step={0.1}
                value={stripF}
                onChange={(e) => setStripF(parseFloat(e.target.value))}
              />
            </label>
          )}
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
        {stripKind === "bake" && (
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
