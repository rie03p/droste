import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  className?: string;
  // 入力途中の値も即反映するか(スライダー併設時に true)。false なら確定時のみ反映。
  live?: boolean;
  // − / + ボタンを併設し、step ずつ刻んで調整できるようにする。
  steppers?: boolean;
  onChange: (v: number) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// step グリッドに丸める(浮動小数の誤差を抑える)
function snap(v: number, step: number): number {
  if (!step) return v;
  return Math.round(v / step) * step;
}

// 表示用の整形。長い小数を避けつつ、入力中の文字列は壊さない。
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "";
  return String(Math.round(v * 1e6) / 1e6);
}

// 数値テキスト入力。編集中は外部からの値で文字列を上書きしない(=入力途中の値が
// 丸め直し/クランプで弾かれて「癖がある」挙動になるのを防ぐ)。確定(blur/Enter)で正規化する。
export function NumberInput({ value, min, max, step, className, live = true, steppers, onChange }: Props) {
  const [text, setText] = useState(() => fmt(value));
  const editing = useRef(false);

  // フォーカスしていないときだけ、外部(スライダー/ドラッグ)の変化を文字列へ反映。
  useEffect(() => {
    if (!editing.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    editing.current = false;
    const v = parseFloat(text);
    if (Number.isNaN(v)) {
      setText(fmt(value)); // 不正入力は元に戻す
      return;
    }
    const c = clamp(v, min, max);
    onChange(c);
    setText(fmt(c));
  };

  // − / + で step ずつ刻む。編集中の文字列があればそれを基準に。
  const nudge = (dir: 1 | -1) => {
    const st = step || 1;
    const base = editing.current ? parseFloat(text) : value;
    const cur = Number.isNaN(base) ? value : base;
    const next = clamp(snap(cur + dir * st, st), min, max);
    onChange(next);
    setText(fmt(next));
  };

  const input = (
    <input
      type="number"
      className={className}
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        if (!live) return;
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(clamp(v, min, max)); // 文字列は触らずに値だけ即反映
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );

  if (!steppers) return input;

  return (
    <span className="num-stepper">
      <button type="button" className="num-step" aria-label="減らす" tabIndex={-1} onClick={() => nudge(-1)}>
        −
      </button>
      {input}
      <button type="button" className="num-step" aria-label="増やす" tabIndex={-1} onClick={() => nudge(1)}>
        +
      </button>
    </span>
  );
}
