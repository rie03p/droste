import type { ReactNode } from "react";
import { NumberInput } from "./NumberInput";

type Props = {
  label: ReactNode;
  hint?: ReactNode; // 操作している変数/単位
  min: number;
  max: number;
  step: number;
  value: number;
  steppers?: boolean; // 数値入力に − / + ボタンを併設する
  onChange: (v: number) => void;
};

// スライダー + テキスト入力。スクロール(range)でもキーボード(number)でも同じ値を操作できる。
export function Slider(p: Props) {
  return (
    <label className="slider">
      <span className="slider-label">
        {p.label}
        {p.hint && (
          <span className="slider-meta">
            <code className="var">{p.hint}</code>
          </span>
        )}
      </span>
      <div className="slider-row">
        <input
          type="range"
          min={p.min}
          max={p.max}
          step={p.step}
          value={p.value}
          onChange={(e) => p.onChange(parseFloat(e.target.value))}
        />
        <NumberInput
          className="slider-num"
          value={p.value}
          min={p.min}
          max={p.max}
          step={p.step}
          steppers={p.steppers}
          onChange={p.onChange}
        />
      </div>
    </label>
  );
}
