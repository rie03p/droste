import type { ReactNode } from "react";
import { EFFECTS, type Effect } from "../effects";
import { ASPECTS } from "../aspects";

type Props = {
  effect: Effect;
  onEffectChange: (id: string) => void;
  aspect: number;
  onAspect: (v: number) => void;
  params: Record<string, number>;
  onParamChange: (key: string, value: number) => void;
  viewScale: number;
  onViewScale: (v: number) => void;
  rotate: number;
  onRotate: (v: number) => void;
  animateZoom: boolean;
  onAnimateZoom: (v: boolean) => void;
  zoomSpeed: number;
  onZoomSpeed: (v: number) => void;
  zoomDir: number;
  onZoomDir: (v: number) => void;
  animateRotate: boolean;
  onAnimateRotate: (v: boolean) => void;
  rotateSpeed: number;
  onRotateSpeed: (v: number) => void;
  fogEnabled: boolean;
  onFogEnabled: (v: boolean) => void;
  fogR: number;
  onFogR: (v: number) => void;
  fogSoft: number;
  onFogSoft: (v: number) => void;
  fogStr: number;
  onFogStr: (v: number) => void;
};

function Slider(p: {
  label: string;
  hint?: string; // 操作している変数/単位
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
        <span className="slider-meta">
          {p.hint && <code className="var">{p.hint}</code>}
          <em>{p.value.toFixed(p.step < 1 ? 2 : 0)}</em>
        </span>
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

function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="section-title">{children}</span>;
}

export function Controls(props: Props) {
  return (
    <div className="controls">
      <div className="field">
        <span className="field-label">エフェクト</span>
        <select value={props.effect.id} onChange={(e) => props.onEffectChange(e.target.value)}>
          {EFFECTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <p className="desc">{props.effect.description}</p>
      </div>

      <div className="field">
        <span className="field-label">出力比率</span>
        <select
          className="full-select"
          value={props.aspect}
          onChange={(e) => props.onAspect(parseFloat(e.target.value))}
        >
          {ASPECTS.map((a) => (
            <option key={a.label} value={a.ratio}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {props.effect.params.filter((p) => !p.hidden).map((p) => (
        <Slider
          key={p.key}
          label={p.label}
          min={p.min}
          max={p.max}
          step={p.step}
          value={props.params[p.key] ?? p.default}
          onChange={(v) => props.onParamChange(p.key, v)}
        />
      ))}

      <hr />

      <SectionTitle>表示(静的な値)</SectionTitle>
      <Slider
        label="表示の拡大率"
        hint="視野 / 大=寄る"
        min={0.2}
        max={4}
        step={0.05}
        value={props.viewScale}
        onChange={props.onViewScale}
      />
      <Slider label="全体の向き" hint="θ₀ rad" min={0} max={Math.PI * 2} step={0.01} value={props.rotate} onChange={props.onRotate} />

      <hr />

      <SectionTitle>アニメーション(時間で値を動かす)</SectionTitle>

      <label className="checkbox">
        <input type="checkbox" checked={props.animateZoom} onChange={(e) => props.onAnimateZoom(e.target.checked)} />
        自己相似ズームを動かす
      </label>
      <p className="desc">log半径方向に送る。拡大しても同じ画像に戻る。</p>
      <label className="slider">
        <span className="slider-label">ズームの向き</span>
        <select className="full-select" value={props.zoomDir} onChange={(e) => props.onZoomDir(+e.target.value)}>
          <option value={1}>拡大</option>
          <option value={-1}>縮小</option>
        </select>
      </label>
      <Slider label="ズーム速度" hint="周期/秒" min={0.02} max={1} step={0.01} value={props.zoomSpeed} onChange={props.onZoomSpeed} />

      <label className="checkbox">
        <input type="checkbox" checked={props.animateRotate} onChange={(e) => props.onAnimateRotate(e.target.checked)} />
        回転を動かす
      </label>
      <p className="desc">向き θ を時間で送る。</p>
      <Slider label="回転速度" hint="回転/秒" min={0.02} max={1} step={0.01} value={props.rotateSpeed} onChange={props.onRotateSpeed} />

      <hr />

      <SectionTitle>中央の白い霧(Escher 風)</SectionTitle>
      <label className="checkbox">
        <input type="checkbox" checked={props.fogEnabled} onChange={(e) => props.onFogEnabled(e.target.checked)} />
        霧をかける
      </label>
      {props.fogEnabled && (
        <>
          <Slider label="霧の半径" hint="r 視野比" min={0} max={0.6} step={0.01} value={props.fogR} onChange={props.onFogR} />
          <Slider label="霧のぼかし幅" hint="soft" min={0.01} max={0.5} step={0.01} value={props.fogSoft} onChange={props.onFogSoft} />
          <Slider label="霧の濃さ" hint="0..1" min={0} max={1} step={0.01} value={props.fogStr} onChange={props.onFogStr} />
        </>
      )}
    </div>
  );
}
