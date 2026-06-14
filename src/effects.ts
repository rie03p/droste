// エフェクト定義とGLSL。
// 各エフェクトは「出力ピクセル座標 z(複素数) → 元画像のサンプリング座標」を計算する
// フラグメントシェーダを持つ。共通部分(complex math + 座標生成)は COMMON に集約する。

export type ParamSpec = {
  key: string; // uniform 名は u_<key>
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type Effect = {
  id: string;
  name: string;
  description: string;
  fragment: string;
  params: ParamSpec[];
  // アニメーション(u_offset)の周期。offset を 0→period で動かすとシームレスにループする。
  animPeriod: (p: Record<string, number>) => number;
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

// --- Droste / Escher 渦 ---
// z_src = z^p,  p = 1 + i * strands * TAU / ln(f)
// strands=0 → 純粋な再帰ズーム(N倍で同一)、strands=整数 → Escher 螺旋。いずれも ×f で厳密に自己相似。
const DROSTE = /* glsl */ `
uniform float u_zoomF;   // 自己相似のスケール係数 f (>1)
uniform float u_strands; // 螺旋の本数(整数で自己相似)
void main(){
  vec2 z = baseZ();
  vec2 w = cLog(z);
  float lnf = log(max(u_zoomF, 1.0001));
  vec2 p = vec2(1.0, u_strands * TAU / lnf);
  vec2 wsrc = cMul(p, w);
  wsrc.x += u_offset;                  // ズームアニメーション(周期 lnf)
  vec2 uv = vec2(fract(wsrc.x / lnf), fract(wsrc.y / TAU));
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
    name: "Droste / Escher 渦",
    description:
      "論文の中核。log-polar ツイストで Print Gallery 効果。strands=0 で純粋な再帰ズーム、整数で螺旋。zoomF 倍に拡大しても同じ画像になる。",
    fragment: COMMON + DROSTE,
    params: [
      { key: "zoomF", label: "自己相似スケール f", min: 1.2, max: 16, step: 0.1, default: 3 },
      { key: "strands", label: "螺旋の本数 (整数で自己相似)", min: 0, max: 6, step: 1, default: 1 },
    ],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
  },
  {
    id: "power",
    name: "べき乗 z^n",
    description: "等角なべき乗写像。万華鏡的な n 回対称の渦。",
    fragment: COMMON + POWER,
    params: [{ key: "power", label: "指数 n", min: 1, max: 8, step: 0.05, default: 2 }],
    animPeriod: () => TAU,
  },
  {
    id: "exp",
    name: "複素 exp",
    description: "exp 写像。直線の帯を同心円へ写す対数螺旋的なタイリング。",
    fragment: COMMON + EXPMAP,
    params: [{ key: "scale", label: "スケール", min: 1, max: 12, step: 0.1, default: 6 }],
    animPeriod: () => TAU,
  },
];

const TAU = Math.PI * 2;

export function getEffect(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}
