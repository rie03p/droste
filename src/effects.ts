// エフェクト定義とGLSL。
// 各エフェクトは「出力ピクセル座標 z(複素数) → 元画像のサンプリング座標」を計算する
// フラグメントシェーダを持つ。共通部分(complex math + 座標生成)は COMMON に集約する。

import {
  sampleFrames,
  sampleCheckerboard,
  sampleWheel,
  sampleStripes,
  samplePlaid,
  sampleHyper,
} from "./samples";

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
  // 「ズームする範囲を指定」(DrostePanel の窓)を使うか。
  // true のとき窓から f=1/size を決めて u_zoomF に注入し、窓の中心/大きさをシェーダへ渡す。
  usesWindow?: boolean;
  // [0,1]² へ畳む自己相似系(reduceToCell)か。true ならテクスチャにビュー比 cover を使う。
  // false の効果は正方形クロップを fract 等でサンプルする。
  selfSimilar?: boolean;
  // 状態をもつシミュレーション系(ping-pong FBO)。指定すると Renderer が
  // seed→step×N→display(=fragment) のマルチパスで描く。
  sim?: {
    seedFragment: string; // 初期状態を元画像から焼くシェーダ(出力 = (U,V,0,1))
    stepFragment: string; // 1ステップ更新するシェーダ(u_state を読み次状態を出力)
  };
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

// 自己相似画像の基本領域 [0,1]² (窓を除く) へ座標を畳む(窓の中→展開 / 画像の外→収縮)。
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

// --- 自己相似(再帰ズーム): Droste / Escher 統合 ---
// 窓に自分自身を再帰的に埋め込んだ自己相似画像 B を元画像とし、出力点を蓄積点 p* 基準の
// log-polar(帯)へ展開 → ねじれ β を掛ける(帯の中では「傾き」) → exp で平面へ戻して B を参照。
//
//   q = p* + exp( β·log(z − p*) − offset ),   β = (1, −twist·lnf/2π)
//
//  - twist = 0      … β=1。帯をそのまま戻すので渦なしの純 Droste(歪みなし無限ズーム)。
//  - twist = k(整数) … k 本の Escher 螺旋。分岐切断 Δw=(0,2π) が q を f^k 倍する=B の対称なので
//                       角度方向の継ぎ目が閉じる。非整数だと帯の上下が一致せず継ぎ目が出る。
//  - 半径方向の連続  … B が ×f 自己相似(中心まで繋がる)。ズームは offset を周期 lnf で流すだけ。
// B は焼き込まず、座標を基本領域へ畳んで毎回フル解像度を参照する(どのスケールでも鮮明)。
const SELF_SIMILAR = /* glsl */ `
uniform float u_zoomF;     // f = 1/size(窓から)
uniform vec3  u_win;       // (cx, cy, size)
uniform float u_twist;     // ねじれ β の傾き(0=Droste, 整数で継ぎ目なし)
void main(){
  float cx = u_win.x, cy = u_win.y, size = u_win.z;
  vec2  winC  = vec2(cx, cy);
  vec2  pstar = (winC - 0.5 * size) / (1.0 - size);
  float lnf   = log(max(u_zoomF, 1.0001));

  vec2 w    = cLog(applyFrame(vUv - pstar));       // log: 帯へ展開(拡大率/向きを反映)
  vec2 beta = vec2(1.0, -u_twist * lnf / TAU);     // 傾き β(分岐切断を閉じる)
  vec2 wt   = cMul(beta, w);
  wt.x     -= u_offset;                            // 自己相似ズーム(螺旋状, 周期 lnf)
  vec2 q    = pstar + cExp(wt);                    // exp: 平面へ戻す
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

  // 表示の拡大率(寄り)と向きを帯座標に効かせる(他エフェクトと同じ操作)
  vec2 p = vUv - 0.5;
  float cr = cos(u_rotate), sr = sin(u_rotate);
  p = mat2(cr, -sr, sr, cr) * p;   // 向き
  p /= u_viewScale;                // 拡大率(大きいほど寄る)
  float u = p.x * lnf + u_offset;  // 横: 対数半径(1周期 = lnf)
  float v = p.y * TAU;             // 縦: 角度(全周 = 2π)
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

// --- 反転 1/z(メビウス) ---
// 中心と無限遠を入れ替える等角写像。z↦k/z。中心付近が外側へ、外周が中心へ巻き込まれる。
const INVERT = /* glsl */ `
uniform float u_scale;   // k(反転の強さ/半径)
void main(){
  vec2 z = baseZ();
  z = cDiv(vec2(u_scale, 0.0), z);            // 1/z(スケール k 付き)
  z = cMul(z, cExp(vec2(0.0, u_offset)));     // 回転アニメーション(周期 TAU)
  vec2 uv = fract(0.5 + 0.5 * z);
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

// --- Möbius 変換(ロクソドロミック・ドロステ) ---
// 2つの不動点(湧き出し/吸い込み)をもつメビウス変換 z↦μ(z) の反復による自己相似。
// 正規座標 w=(z-α)/(z-β) では純粋な拡大回転 w↦μw になり、log をとると平行移動になる。
// 1周期 lnf へ畳むと、2つの不動点をめぐる二重渦のドロステ(無限ズーム)になる。
//  - 窓(ズーム範囲): size から f=|μ| を、中心から不動点ペアの中点を決める。
//  - twist: 角度方向の流れ(0=渦の締まりのみ, 整数で継ぎ目なし=Escher 螺旋と同じ理屈)。
//  - sep: 2不動点の間隔(中点からの距離)。小さいほど中心に寄った密な二重渦。
const MOBIUS = /* glsl */ `
uniform float u_zoomF;   // f=|μ|(窓 size から)
uniform vec3  u_win;     // (cx, cy, size) — xy=不動点ペアの中点
uniform float u_twist;   // ねじれ(角度方向の流れ)
uniform float u_sep;     // 不動点の間隔
void main(){
  vec2 z = baseZ() - (u_win.xy - 0.5);   // 中点を窓の位置へ
  vec2 a = vec2(u_sep, 0.0);             // 不動点 α=+a(吸い込み), β=-a(湧き出し)
  vec2 w0 = cDiv(z - a, z + a);          // α→0, β→∞ の正規座標
  vec2 L  = cLog(w0);                    // ロクソドロミック流は L 平面の平行移動
  float lnf = log(max(u_zoomF, 1.0001));
  vec2 beta = vec2(1.0, -u_twist * lnf / TAU);
  vec2 Lt   = cMul(beta, L);
  Lt.x     -= u_offset;                  // ドロステズーム(周期 lnf)
  Lt.x      = mod(Lt.x, lnf);            // 1周期へ畳む(自己相似タイル)
  vec2 w  = cExp(Lt);
  vec2 zp = cMul(a, cDiv(vec2(1.0, 0.0) + w, vec2(1.0, 0.0) - w)); // 逆写像 z=a(1+w)/(1-w)
  vec2 uv = fract(0.5 + 0.5 * zp);
  outColor = vec4(applyFog(sampleImg(uv).rgb), 1.0);
}`;

// --- Newton フラクタル ---
// f(z)=z^n-1 のニュートン反復 z←z-(z^n-1)/(n·z^{n-1})。各点がどの根(1の n 乗根)へ
// 収束するかで平面が n 個の流域に分かれ、その境界がフラクタルになる。収束先の根の位置で
// 元画像をサンプルし、収束までの反復回数で陰影をつけて境界を浮かせる。
const NEWTON = /* glsl */ `
uniform float u_power;   // 次数 n(根の数)
uniform float u_detail;  // 境界の陰影の強さ
void main(){
  vec2 z = baseZ() * 1.6;                      // 視野を広げて流域を見せる
  z = cMul(z, cExp(vec2(0.0, u_offset)));      // 回転アニメ(周期 TAU)
  float n = u_power;
  int iters = 40;
  for (int i = 0; i < 40; i++){
    vec2 zn1 = cPowR(z, n - 1.0);              // z^{n-1}
    vec2 fz  = cMul(zn1, z) - vec2(1.0, 0.0);  // z^n - 1
    vec2 fpz = n * zn1;                        // n·z^{n-1}
    vec2 dz  = cDiv(fz, fpz);
    z -= dz;
    if (dot(dz, dz) < 1e-8) { iters = i; break; }
  }
  vec2 uv = fract(0.5 + 0.42 * z);             // 収束した根の位置で画像をサンプル
  vec3 col = sampleImg(uv).rgb;
  float shade = 1.0 - u_detail * float(iters) / 40.0;  // 反復が多い=境界付近を暗く
  outColor = vec4(applyFog(col * clamp(shade, 0.0, 1.0)), 1.0);
}`;

// --- Hyperbolic Tiling(Poincaré 円板の {p,q} タイリング)---
// 中心に p 回対称の頂点を置いた {p,q} 双曲タイリング。出力点を基本三角形(角 π/p, π/q, π/2)
// へ「2本の直線鏡(中心まわり)」と「1つの測地線=円鏡」で折り返し、その三角形内の位置で
// 元画像をサンプルする。円板の外側は単位円で反転して内側へ写し、画面全体を埋める。
const HYPERBOLIC = /* glsl */ `
uniform float u_p;       // p(中心頂点の対称数)
uniform float u_q;       // q(各タイルの辺数)
void main(){
  vec2 z = baseZ();
  // 回転スピン(p-fold なので周期 2π/p でシームレス)
  float cs = cos(u_offset), sn = sin(u_offset);
  z = mat2(cs, -sn, sn, cs) * z;
  // 単位円の外は反転して内側へ(画面全体を埋める)
  if (dot(z, z) >= 1.0) z = z / dot(z, z);

  float p = max(u_p, 3.0), q = max(u_q, 3.0);
  float pa = PI / p;
  // 測地線の円鏡(単位円・実軸に直交)。双曲右三角形の関係 cosh(c)=cos(π/q)/sin(π/p)。
  float coshc = max(cos(PI / q) / sin(pa), 1.0001); // 非双曲な (p,q) はクランプ
  float xB = sqrt((coshc - 1.0) / (coshc + 1.0));    // tanh(c/2)=頂点 B の半径
  float d  = (xB * xB + 1.0) / (2.0 * xB);           // 円鏡の中心(実軸上)
  float r  = sqrt(max(d * d - 1.0, 0.0));            // 円鏡の半径
  vec2  cc = vec2(d, 0.0);

  // 基本三角形へ折り返す(角度を p のくさびへ → 円鏡の内側なら反転、を繰り返す)
  for (int i = 0; i < 24; i++) {
    float a = atan(z.y, z.x);
    float rho = length(z);
    a = mod(a, 2.0 * pa);
    if (a > pa) a = 2.0 * pa - a;       // 二面体対称(直線鏡2本)
    z = rho * vec2(cos(a), sin(a));
    vec2 dv = z - cc;
    float dd = dot(dv, dv);
    if (dd < r * r) z = cc + (r * r) * dv / dd;  // 円鏡で外側へ戻す
    else break;
  }
  // 基本三角形 → 画像 [0,1]²(くさび角を u、A→辺 BC の半径を v)
  float u = clamp(atan(z.y, z.x) / pa, 0.0, 1.0);
  float v = clamp(length(z) / xB, 0.0, 1.0);
  outColor = vec4(applyFog(sampleImg(vec2(u, v)).rgb), 1.0);
}`;

// --- Reaction Diffusion(Gray-Scott)---
// U,V 2 化学種の反応拡散をシミュレートする。状態は (U,V) を RG に持つテクスチャで、
// ping-pong FBO で毎フレーム数ステップ進める。元画像の暗い領域に V を蒔いて種にする。
//   dU = Du·∇²U − U·V² + F·(1−U)
//   dV = Dv·∇²V + U·V² − (F+K)·V
// COMMON は使わず各シェーダが独立した #version を持つ(座標生成や複素演算は不要)。
const RD_SEED = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_img;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 c = texture(u_img, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float v = (1.0 - lum) > 0.45 ? 0.5 : 0.0;     // 暗い領域に種をまく
  if (hash(vUv * 900.0) > 0.9975) v = 0.5;       // 微小スペックで核形成を促す
  outColor = vec4(1.0, v, 0.0, 1.0);             // U=1, V=v
}`;

const RD_STEP = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_state;
uniform vec2 u_texel;   // 1/解像度
uniform float u_feed;   // F
uniform float u_kill;   // K
void main(){
  vec2 c = texture(u_state, vUv).xy;
  // 9点ラプラシアン(中心 -1, 上下左右 0.2, 斜め 0.05)
  vec2 lap =
      texture(u_state, vUv + u_texel * vec2(-1.0,  0.0)).xy * 0.2
    + texture(u_state, vUv + u_texel * vec2( 1.0,  0.0)).xy * 0.2
    + texture(u_state, vUv + u_texel * vec2( 0.0, -1.0)).xy * 0.2
    + texture(u_state, vUv + u_texel * vec2( 0.0,  1.0)).xy * 0.2
    + texture(u_state, vUv + u_texel * vec2(-1.0, -1.0)).xy * 0.05
    + texture(u_state, vUv + u_texel * vec2( 1.0, -1.0)).xy * 0.05
    + texture(u_state, vUv + u_texel * vec2(-1.0,  1.0)).xy * 0.05
    + texture(u_state, vUv + u_texel * vec2( 1.0,  1.0)).xy * 0.05
    - c;
  float U = c.x, V = c.y;
  float reaction = U * V * V;
  float du = 1.0 * lap.x - reaction + u_feed * (1.0 - U);
  float dv = 0.5 * lap.y + reaction - (u_feed + u_kill) * V;
  outColor = vec4(clamp(U + du, 0.0, 1.0), clamp(V + dv, 0.0, 1.0), 0.0, 1.0);
}`;

const RD_DISPLAY = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_state;
uniform sampler2D u_img;
uniform float u_tint;   // 元画像で色付けする量 0..1
void main(){
  float V = texture(u_state, vUv).y;
  vec3 lo  = vec3(0.157, 0.157, 0.157); // gruvbox bg0
  vec3 mid = vec3(0.271, 0.522, 0.533); // aqua #458588
  vec3 hi  = vec3(0.984, 0.502, 0.099); // orange #fe8019
  vec3 col = mix(lo, mid, smoothstep(0.05, 0.25, V));
  col = mix(col, hi, smoothstep(0.25, 0.5, V));
  vec3 img = texture(u_img, vUv).rgb;
  col = mix(col, col * 0.5 + img * V * 1.5, u_tint); // 元画像で色付け
  outColor = vec4(col, 1.0);
}`;

export const EFFECTS: Effect[] = [
  {
    id: "droste",
    name: "Droste (再帰ズーム)",
    description:
      "渦なし。指定した窓に画像自身を再帰的に埋め込み、f 倍に拡大しても同じ画像に戻る無限ズームにする。Escher 渦の twist=0 にあたる。",
    fragment: COMMON + SELF_SIMILAR,
    params: [
      // twist=0 固定で純 Droste。Escher と同じ統合シェーダを使う
      { key: "twist", label: "ねじれ", min: 0, max: 0, step: 1, default: 0, hidden: true },
      // zoomF は窓の大きさ(範囲指定)から決まるので専用 UI で操作する
      {
        key: "zoomF",
        label: "自己相似スケール f",
        min: 1.2,
        max: 16,
        step: 0.1,
        default: 3,
        hidden: true,
      },
    ],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: sampleFrames,
    usesWindow: true,
    selfSimilar: true,
  },
  {
    id: "escher",
    name: "Escher 渦",
    description:
      "論文の中核。Droste と同じ自己相似画像をねじって Print Gallery 風の螺旋に。ねじれ β を連続で動かせる(0=Droste)。整数のとき中心まで切れ目なく繋がりシームレスにループする。",
    fragment: COMMON + SELF_SIMILAR,
    params: [
      { key: "twist", label: "ねじれ(整数で継ぎ目なし)", min: -6, max: 6, step: 0.01, default: 1 },
      // f は窓(範囲)から決まるので隠す。u_zoomF を設定するために params には残す
      { key: "zoomF", label: "f", min: 1.2, max: 64, step: 0.1, default: 3, hidden: true },
    ],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: sampleCheckerboard,
    usesWindow: true,
    selfSimilar: true,
  },
  {
    id: "log",
    name: "対数 (log-polar 展開)",
    description:
      "Droste と同じ窓で作った自己相似画像を複素 log で帯に展開して表示。スケール自己相似が log では横の周期になるので、横スクロール(ズーム)で帯がシームレスにループする。『複素 exp』は逆ではない(どちらも exp サンプル系)。",
    fragment: COMMON + LOGPOLAR,
    // f は窓から決まるので隠す(u_zoomF 設定のため params には残す)
    params: [{ key: "zoomF", label: "f", min: 1.2, max: 64, step: 0.1, default: 3, hidden: true }],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: sampleCheckerboard,
    usesWindow: true,
    selfSimilar: true,
  },
  {
    id: "power",
    name: "べき乗 z^n / 累乗根",
    description:
      "等角なべき乗写像 z^n。n>1 は万華鏡的な n 回対称の渦、n<1 は累乗根(√z は n=0.5)で多重像が開く。",
    fragment: COMMON + POWER,
    params: [{ key: "power", label: "指数 n", min: 0.25, max: 8, step: 0.05, default: 2 }],
    animPeriod: () => TAU,
    sample: sampleWheel,
  },
  {
    id: "invert",
    name: "反転 1/z",
    description:
      "メビウス反転 z↦k/z。中心と無限遠を入れ替え、中心付近を外へ・外周を中心へ巻き込む等角写像。",
    fragment: COMMON + INVERT,
    params: [{ key: "scale", label: "強さ k", min: 0.05, max: 2, step: 0.01, default: 0.4 }],
    animPeriod: () => TAU,
    sample: sampleWheel,
  },
  {
    id: "exp",
    name: "複素 exp",
    description:
      "exp 写像。直線の帯を同心円へ写す対数螺旋的なタイリング。独立した装飾エフェクトで、『対数(log-polar展開)』の逆ではない(どちらも exp サンプル系で、繋ぐと exp∘exp になり元に戻らない)。",
    fragment: COMMON + EXPMAP,
    params: [{ key: "scale", label: "スケール", min: 1, max: 12, step: 0.1, default: 6 }],
    animPeriod: () => TAU,
    sample: sampleStripes,
  },
  {
    id: "mobius",
    name: "Möbius 変換(二重渦ドロステ)",
    description:
      "2つの不動点をもつロクソドロミックなメビウス変換による自己相似。正規座標で w↦μw になり、湧き出し/吸い込みをめぐる二重渦の無限ズームに。ズーム範囲で渦の中心と締まり f を、間隔で2不動点の開きを決める。ねじれ整数で継ぎ目なし。",
    fragment: COMMON + MOBIUS,
    params: [
      { key: "twist", label: "ねじれ(整数で継ぎ目なし)", min: -6, max: 6, step: 0.01, default: 0 },
      { key: "sep", label: "不動点の間隔", min: 0.05, max: 1.2, step: 0.01, default: 0.5 },
      { key: "zoomF", label: "f", min: 1.2, max: 64, step: 0.1, default: 3, hidden: true },
    ],
    animPeriod: (p) => Math.log(Math.max(p.zoomF ?? 3, 1.0001)),
    sample: samplePlaid,
    usesWindow: true,
  },
  {
    id: "newton",
    name: "Newton フラクタル",
    description:
      "f(z)=z^n-1 のニュートン反復。各点がどの根へ収束するかで平面が n 個の流域に分かれ、その境界がフラクタルになる。収束先の根の位置で元画像をサンプルし、反復回数で境界を陰影づけする。回転でアニメーション。",
    fragment: COMMON + NEWTON,
    params: [
      { key: "power", label: "次数 n(根の数)", min: 2, max: 8, step: 1, default: 3 },
      { key: "detail", label: "境界の陰影", min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
    animPeriod: () => TAU,
    sample: sampleWheel,
  },
  {
    id: "hyperbolic",
    name: "Hyperbolic Tiling ({p,q})",
    description:
      "Poincaré 円板の {p,q} 双曲タイリング。中心に p 回対称の頂点を置き、出力点を基本三角形へ折り返して各タイルに元画像を敷き詰める。境界(単位円)に近づくほどタイルが無限に小さくなる。回転でシームレスにアニメーション。(p-2)(q-2)>4 のとき双曲。",
    fragment: COMMON + HYPERBOLIC,
    params: [
      { key: "p", label: "p(中心の対称数)", min: 3, max: 10, step: 1, default: 5 },
      { key: "q", label: "q(タイルの辺数)", min: 3, max: 10, step: 1, default: 4 },
    ],
    animPeriod: (p) => (2 * Math.PI) / Math.max(p.p ?? 5, 3),
    sample: sampleHyper,
  },
  {
    id: "reaction",
    name: "Reaction Diffusion (Gray-Scott)",
    description:
      "Gray-Scott 反応拡散シミュレーション。元画像の暗い領域に種をまき、フィード率 F とキル率 K に応じて斑点・縞・珊瑚状のパターンが自己組織化する。毎フレーム時間発展する(ズーム/回転アニメは使わない)。種をまき直すには『リセット』。",
    fragment: RD_DISPLAY,
    params: [
      { key: "feed", label: "フィード率 F", min: 0.01, max: 0.1, step: 0.001, default: 0.054 },
      { key: "kill", label: "キル率 K", min: 0.04, max: 0.07, step: 0.001, default: 0.062 },
      { key: "tint", label: "元画像で色付け", min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: "steps", label: "1フレームの反復", min: 1, max: 24, step: 1, default: 10 },
    ],
    animPeriod: () => 1,
    sample: sampleCheckerboard,
    sim: { seedFragment: RD_SEED, stepFragment: RD_STEP },
  },
];

const TAU = Math.PI * 2;

export function getEffect(id: string): Effect {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}
