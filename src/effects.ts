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
  vec2 q = pstar + (vUv - pstar) * s;               // 蓄積点へズームイン

  // 窓に入った座標は展開(T^-1)して元画像から取り直す。
  // 常にレベル0のフル解像度を参照するので、どのズーム段でも鮮明度が一定=継ぎ目が出ない。
  // 上限は窓が大きい(f が小さい)ときに蓄積点付近まで展開しきるために十分大きく取る。
  for (int i = 0; i < 96; i++) {
    if (abs(q.x - cx) < 0.5 * size && abs(q.y - cy) < 0.5 * size) {
      q = (q - winC) / size + 0.5;
    } else {
      break;
    }
  }
  outColor = vec4(applyFog(sampleImg(q).rgb), 1.0);
}`;

// --- Escher 渦(ツイストあり) ---
// 自己相似(スケール f)と分岐切断(角度の 2π 巻き戻り)を両立させるため、整数 b(螺旋の本数)と
// k(巻きの密度)で格子 L=<(lnf,0),(0,2π)> を閉じる。両条件から
//   lnf = 2π·√(b/k)   (= f = exp(2π√(b/k)) は自動で決まる)
//   ねじれ p = (1, √(b·k))
// 分岐切断 Δw=(0,2π) は Δuv=(-k,1)、スケール Δw=(lnf,0) は Δuv=(1,b) と
// どちらも整数格子に乗るため、fract せず MIRRORED_REPEAT で標本化すれば
// 画像の縁でも反射で連続=中心まで切れ目が出ない。
const ESCHER = /* glsl */ `
uniform float u_strands;  // b
uniform float u_winds;    // k
void main(){
  vec2 z = baseZ();
  vec2 w = cLog(z);
  float b = max(u_strands, 1.0);
  float k = max(u_winds, 1.0);
  float lnf = TAU * sqrt(b / k);
  vec2 p = vec2(1.0, sqrt(b * k));
  vec2 wsrc = cMul(p, w);
  // 自己相似ベクトル (lnf, b·TAU) に沿ってズーム(周期 lnf でシームレス)
  float t = u_offset / lnf;
  wsrc -= t * vec2(lnf, b * TAU);
  vec2 uv = vec2(wsrc.x / lnf, wsrc.y / TAU);   // fract なし → MIRRORED_REPEAT に任せる
  outColor = vec4(applyFog(sampleImg(uv).rgb), 1.0);
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
      "渦なし。画像を log-polar にタイル化し、f 倍に拡大しても同じ画像に戻る無限ズームにする。渦にしたくない画像向け。",
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
      "論文の中核。log-polar ツイストで Print Gallery 風の螺旋に。中心まで切れ目なく連続。2つの整数で格子が閉じ、拡大率 f=exp(2π√(本数/密度)) は自動で決まる。",
    fragment: COMMON + ESCHER,
    params: [
      { key: "strands", label: "螺旋の本数 b", min: 1, max: 6, step: 1, default: 1 },
      { key: "winds", label: "巻きの密度 k (大きいほど密)", min: 1, max: 12, step: 1, default: 3 },
    ],
    // MIRRORED_REPEAT なので 1 自己相似周期(lnf)では鏡映反転する。2 周期で恒等に戻り完全ループ
    animPeriod: (p) => 2 * TAU * Math.sqrt((p.strands ?? 1) / Math.max(p.winds ?? 3, 1)),
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
