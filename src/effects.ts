// エフェクト定義とGLSL。
// 各エフェクトは「出力ピクセル座標 z(複素数) → 元画像のサンプリング座標」を計算する
// フラグメントシェーダを持つ。共通部分(complex math + 座標生成)は COMMON に集約する。

import { sampleFrames, sampleCheckerboard, sampleWheel, sampleStripes } from "./samples";

export type ParamSpec = {
  key: string; // uniform 名は u_<key>
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  hidden?: boolean; // 専用 UI から操作するため通常のスライダーは出さない
};

export type Effect = {
  id: string;
  name: string;
  description: string;
  fragment: string;
  params: ParamSpec[];
  // アニメーション(u_offset)の周期。offset を 0→period で動かすとシームレスにループする。
  animPeriod: (p: Record<string, number>) => number;
  // エフェクトの効果が分かる代表的な初期画像(手続き的生成)
  sample: () => HTMLCanvasElement;
};

export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
const vec2 verts[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main(){
  vec2 p = verts[gl_VertexID];
  vUv = 0.5 * (p + 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// 全フラグメント共通のプリアンブル(複素数演算 + 座標生成)。
const COMMON = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D u_img;
uniform vec2  u_resolution;
uniform float u_viewScale;  // ビューのズーム(大きいほど引き)
uniform float u_rotate;     // 全体回転(rad)
uniform float u_offset;     // アニメーション用オフセット

#define PI  3.141592653589793
#define TAU 6.283185307179586

vec2 cMul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cDiv(vec2 a, vec2 b){ float d = dot(b,b); return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y) / d; }
vec2 cLog(vec2 z){ return vec2(log(max(length(z), 1e-8)), atan(z.y, z.x)); }
vec2 cExp(vec2 z){ float e = exp(z.x); return vec2(e*cos(z.y), e*sin(z.y)); }
vec2 cPowR(vec2 z, float n){ return cExp(n * cLog(z)); }

// 出力ピクセルを中心原点・アスペクト補正済みの複素座標へ
vec2 baseZ(){
  vec2 f = vUv - 0.5;
  f.x *= u_resolution.x / u_resolution.y;
  float c = cos(u_rotate), s = sin(u_rotate);
  f = mat2(c, -s, s, c) * f;
  return f / u_viewScale;   // 大きいほど寄る(拡大)
}

vec4 sampleImg(vec2 uv){ return texture(u_img, uv); }

// 蓄積点基準の差分 d に「表示の拡大率」「全体の向き」を適用する(Droste/Escher 用)
vec2 applyFrame(vec2 d){
  float a = u_resolution.x / u_resolution.y;
  d.x *= a;
  float c = cos(u_rotate), s = sin(u_rotate);
  d = mat2(c, -s, s, c) * d;
  d /= u_viewScale;     // 大きいほど寄る
  d.x /= a;
  return d;
}

// 自己相似画像の基本領域 [0,1]²\窓 へ座標を畳む(窓の中→展開 / 画像の外→収縮)。
// 常にレベル0のフル解像度を参照するので、どのスケールでも鮮明度が一定。
vec2 reduceToCell(vec2 q, vec2 winC, float size){
  for (int i = 0; i < 96; i++) {
    if (abs(q.x - winC.x) < 0.5 * size && abs(q.y - winC.y) < 0.5 * size) {
      q = (q - winC) / size + 0.5;            // T^-1: 展開
    } else if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
      q = (q - 0.5) * size + winC;            // T: 収縮
    } else {
      break;
    }
  }
  return q;
}

// 中央の白い霧(Escher の Print Gallery 中心のような曇り)
uniform float u_fogR;     // 半径(短辺基準, 0..)
uniform float u_fogSoft;  // ぼかし幅
uniform float u_fogStr;   // 強さ 0..1
vec3 applyFog(vec3 col){
  vec2 f = vUv - 0.5;
  f.x *= u_resolution.x / u_resolution.y;
  float d = length(f);
  float m = (1.0 - smoothstep(u_fogR, u_fogR + max(u_fogSoft, 1e-4), d)) * u_fogStr;
  return mix(col, vec3(1.0), clamp(m, 0.0, 1.0));
}
`;

// --- Droste(渦なしの再帰ズーム) ---
// 自己相似画像(指定点に自分の縮小コピーが入れ子)を、その蓄積点へ素直にズームする。歪みなし。
// 画像は蓄積点まわりの ×f で同一なので、ズーム係数 s が [1/f,1] を一周するとシームレスにループ。
const DROSTE_PLAIN = /* glsl */ `
uniform float u_zoomF;   // 自己相似のスケール係数 f (>1)
uniform vec3  u_win;     // ズーム窓 (cx, cy, size)  size = 1/f
void main(){
  float cx = u_win.x, cy = u_win.y, size = u_win.z;
  vec2 winC = vec2(cx, cy);
  vec2 pstar = (winC - 0.5 * size) / (1.0 - size);  // 蓄積点

  float lnf = log(max(u_zoomF, 1.0001));
  float s = exp(-mod(u_offset, lnf));               // (1/f, 1]
  vec2 q = pstar + applyFrame(vUv - pstar) * s;     // 蓄積点へズームイン(拡大率/向きを反映)
  q = reduceToCell(q, winC, size);
  outColor = vec4(applyFog(sampleImg(q).rgb), 1.0);
}`;

// --- Escher 渦(ツイストあり) ---
// Droste と同じ自己相似画像(窓に自分自身を再帰的に埋め込んだもの)を元画像 B とし、
// 出力点を蓄積点 p* 基準の log-polar にして、ねじれ β=(1, -strands·lnf/2π) を掛け、
// exp で 2D 平面へ戻して B を参照する。
//  - 半径方向の連続: B が ×f 自己相似だから(中心まで繋がる)
//  - 角度方向の連続: exp が角度 2π 周期なので自動(上下の切れ目が出ない)
//  - 分岐切断 Δw=(0,2π) は q を f^strands 倍する=B の対称なので連続
// B は焼き込まず、座標をシェーダ内で基本領域へ畳んで毎回フル解像度を参照する。
const ESCHER = /* glsl */ `
uniform float u_zoomF;     // f = 1/size(窓から)
uniform vec3  u_win;       // (cx, cy, size) — Droste と共有
uniform float u_strands;   // ねじれ(整数で連続)
void main(){
  float cx = u_win.x, cy = u_win.y, size = u_win.z;
  vec2  winC  = vec2(cx, cy);
  vec2  pstar = (winC - 0.5 * size) / (1.0 - size);
  float lnf   = log(max(u_zoomF, 1.0001));

  vec2 w  = cLog(applyFrame(vUv - pstar));        // 出力の log-polar(拡大率/向きを反映)
  vec2 beta = vec2(1.0, -u_strands * lnf / TAU);  // ねじれ(分岐切断を閉じる)
  vec2 wt = cMul(beta, w);
  wt.x -= u_offset;                               // 自己相似ズーム(螺旋状, 周期 lnf)
  vec2 q = pstar + cExp(wt);                      // 2D 平面へ
  q = reduceToCell(q, winC, size);
  outColor = vec4(applyFog(sampleImg(q).rgb), 1.0);
}`;

// --- 対数 (log-polar 展開) ---
// 自己相似画像を複素 log で「帯」に展開して表示する。スケール自己相似が log では
// 横方向の周期 lnf になるので、帯は横(周期 lnf)にも縦(角度 2π)にもシームレスにタイルし、
// 横スクロール(=ズーム)でループする。出力 = 元画像の log をとったもの。
const LOGPOLAR = /* glsl */ `
uniform float u_zoomF;     // f = 1/size(窓から)
uniform vec3  u_win;       // (cx, cy, size) — Droste と共有
void main(){
  float cx = u_win.x, cy = u_win.y, size = u_win.z;
  vec2  winC  = vec2(cx, cy);
  vec2  pstar = (winC - 0.5 * size) / (1.0 - size);
  float lnf   = log(max(u_zoomF, 1.0001));

  float u = (vUv.x - 0.5) * lnf + u_offset;   // 横: 対数半径(1周期 = lnf)
  float v = (vUv.y - 0.5) * TAU;              // 縦: 角度(全周 = 2π)
  vec2 q = pstar + cExp(vec2(u, v));
  q = reduceToCell(q, winC, size);
  outColor = vec4(applyFog(sampleImg(q).rgb), 1.0);
}`;

// --- べき乗 z^n ---
const POWER = /* glsl */ `
uniform float u_power;
void main(){
  vec2 z = baseZ();
  vec2 zs = cPowR(z, u_power);
  zs = cMul(zs, cExp(vec2(0.0, u_offset)));   // 回転アニメーション(周期 TAU)
  vec2 uv = fract(0.5 + 0.5 * zs);
  outColor = vec4(applyFog(sampleImg(uv).rgb), 1.0);
}`;

// --- 複素 exp ---
const EXPMAP = /* glsl */ `
uniform float u_scale;
void main(){
  vec2 z = baseZ();
  vec2 zs = cExp(z * u_scale);
  zs = cMul(zs, cExp(vec2(0.0, u_offset)));   // 回転アニメーション(周期 TAU)
  vec2 uv = fract(0.5 + 0.5 * zs);
  outColor = vec4(applyFog(sampleImg(uv).rgb), 1.0);
}`;

export const EFFECTS: Effect[] = [
  {
    id: "droste",
    name: "Droste (再帰ズーム)",
    description:
      "渦なし。指定した窓に画像自身を再帰的に埋め込み、f 倍に拡大しても同じ画像に戻る無限ズームにする。渦にしたくない画像向け。",
    fragment: COMMON + DROSTE_PLAIN,
    // zoomF は窓の大きさ(範囲指定)から決まるので専用 UI で操作する
    params: [{ key: "zoomF", label: "自己相似スケール f", min: 1.2, max: 16, step: 0.1, default: 3, hidden: true }],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: sampleFrames,
  },
  {
    id: "escher",
    name: "Escher 渦",
    description:
      "論文の中核。Droste と同じ「ズームする範囲(窓)」で作った自己相似画像をねじって Print Gallery 風の螺旋に。中心まで切れ目なく連続し、シームレスにループする。",
    fragment: COMMON + ESCHER,
    params: [
      { key: "strands", label: "ねじれ(螺旋の本数)", min: 1, max: 6, step: 1, default: 1 },
      // f は窓(範囲)から決まるので隠す。u_zoomF を設定するために params には残す
      { key: "zoomF", label: "f", min: 1.2, max: 64, step: 0.1, default: 3, hidden: true },
    ],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: sampleCheckerboard,
  },
  {
    id: "log",
    name: "対数 (log-polar 展開)",
    description:
      "Droste と同じ窓で作った自己相似画像を複素 log で帯に展開して表示。スケール自己相似が log では横の周期になるので、横スクロール(ズーム)で帯がシームレスにループする。",
    fragment: COMMON + LOGPOLAR,
    // f は窓から決まるので隠す(u_zoomF 設定のため params には残す)
    params: [{ key: "zoomF", label: "f", min: 1.2, max: 64, step: 0.1, default: 3, hidden: true }],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: sampleCheckerboard,
  },
  {
    id: "power",
    name: "べき乗 z^n",
    description: "等角なべき乗写像。万華鏡的な n 回対称の渦。",
    fragment: COMMON + POWER,
    params: [{ key: "power", label: "指数 n", min: 1, max: 8, step: 0.05, default: 2 }],
    animPeriod: () => TAU,
    sample: sampleWheel,
  },
  {
    id: "exp",
    name: "複素 exp",
    description: "exp 写像。直線の帯を同心円へ写す対数螺旋的なタイリング。",
    fragment: COMMON + EXPMAP,
    params: [{ key: "scale", label: "スケール", min: 1, max: 12, step: 0.1, default: 6 }],
    animPeriod: () => TAU,
    sample: sampleStripes,
  },
];

const TAU = Math.PI * 2;

export function getEffect(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}
