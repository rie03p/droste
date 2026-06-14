// 出力アスペクト比のプリセット。ratio = 幅 / 高さ。
export type Aspect = { label: string; ratio: number };

export const ASPECTS: Aspect[] = [
  { label: "1:1 正方形", ratio: 1 },
  { label: "4:3 横", ratio: 4 / 3 },
  { label: "3:2 横", ratio: 3 / 2 },
  { label: "16:9 横", ratio: 16 / 9 },
  { label: "3:4 縦", ratio: 3 / 4 },
  { label: "2:3 縦", ratio: 2 / 3 },
  { label: "9:16 縦", ratio: 9 / 16 },
];

// 長辺の px から、与えた比率の幅・高さを求める。
export function dimsFromLongEdge(longEdge: number, ratio: number) {
  return ratio >= 1
    ? { width: longEdge, height: Math.round(longEdge / ratio) }
    : { width: Math.round(longEdge * ratio), height: longEdge };
}
