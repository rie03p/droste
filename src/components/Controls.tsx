import { EFFECTS, type Effect } from "../effects";

type Props = {
  effect: Effect;
  onEffectChange: (id: string) => void;
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
  animateRotate: boolean;
  onAnimateRotate: (v: boolean) => void;
  rotateSpeed: number;
  onRotateSpeed: (v: number) => void;
};

function Slider(p: {
  label: string;
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
        <em>{p.value.toFixed(p.step < 1 ? 2 : 0)}</em>
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

      {props.effect.params.map((p) => (
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

      <Slider label="ビューズーム" min={0.2} max={4} step={0.05} value={props.viewScale} onChange={props.onViewScale} />
      <Slider label="基準回転" min={0} max={Math.PI * 2} step={0.01} value={props.rotate} onChange={props.onRotate} />

      <hr />

      <label className="checkbox">
        <input type="checkbox" checked={props.animateZoom} onChange={(e) => props.onAnimateZoom(e.target.checked)} />
        ズームアニメーション(同じ画像に戻る)
      </label>
      <Slider label="ズーム速度 (周期/秒)" min={0.02} max={1} step={0.01} value={props.zoomSpeed} onChange={props.onZoomSpeed} />

      <label className="checkbox">
        <input type="checkbox" checked={props.animateRotate} onChange={(e) => props.onAnimateRotate(e.target.checked)} />
        回転アニメーション
      </label>
      <Slider label="回転速度 (回転/秒)" min={0.02} max={1} step={0.01} value={props.rotateSpeed} onChange={props.onRotateSpeed} />
    </div>
  );
}
