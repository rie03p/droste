import { VERTEX_SHADER, type Effect } from "../effects";

type ImageSource = TexImageSource;

type RenderState = {
  effect: Effect;
  params: Record<string, number>;
  viewScale: number;
  rotate: number;
  offset: number;
  fogR: number;
  fogSoft: number;
  fogStr: number;
  winX: number;
  winY: number;
  winSize: number;
};

// フルスクリーン三角形に各エフェクトのフラグメントシェーダを適用する WebGL2 レンダラ。
// 通常エフェクトは単一パス。sim を持つエフェクト(Reaction Diffusion 等)は
// seed→step×N→display のマルチパス(ping-pong FBO)で描く。
export class Renderer {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private uniformCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private texture: WebGLTexture;
  private hasImage = false;

  // --- シミュレーション(ping-pong)用の状態 ---
  private simTex: [WebGLTexture, WebGLTexture] | null = null;
  private simFbo: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private simW = 0;
  private simH = 0;
  private simCur = 0; // 現在の状態が入っている simTex の添字
  private simDirty = true; // true なら次の sim 描画で seed し直す
  private simInternal: number;
  private simType: number;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 が利用できません");
    this.gl = gl;
    // 反応拡散の状態は float テクスチャに描く(8bit では精度不足でパターンが崩れる)。
    // 使えない環境では RGBA8 にフォールバック。
    const floatOk = !!gl.getExtension("EXT_color_buffer_float");
    this.simInternal = floatOk ? gl.RGBA16F : gl.RGBA8;
    this.simType = floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Droste/Escher は座標を基本領域 [0,1]² に畳んでから参照するので端は CLAMP で十分
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 1x1 のプレースホルダ(gruvbox bg0)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([40, 40, 40, 255]),
    );
  }

  setImage(source: ImageSource, flipY = true) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // 再帰の奥(縮小コピー)のエイリアシングを抑えるためミップマップを生成
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.hasImage = true;
    this.simDirty = true; // 画像が変わったらシミュレーションの種をまき直す
  }

  // シミュレーションの種をまき直す(UI のリセットから呼ぶ)
  reseedSim() {
    this.simDirty = true;
  }

  private getProgram(key: string, fragment: string): WebGLProgram {
    let prog = this.programs.get(key);
    if (prog) return prog;
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compile(gl.FRAGMENT_SHADER, fragment);
    prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("link error: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.programs.set(key, prog);
    this.uniformCache.set(prog, new Map());
    return prog;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error("compile error: " + gl.getShaderInfoLog(sh) + "\n" + src);
    }
    return sh;
  }

  private uniform(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    const cache = this.uniformCache.get(prog)!;
    if (cache.has(name)) return cache.get(name)!;
    const loc = this.gl.getUniformLocation(prog, name);
    cache.set(name, loc);
    return loc;
  }

  render(state: RenderState) {
    if (state.effect.sim) {
      this.renderSim(state);
      return;
    }
    const gl = this.gl;
    const prog = this.getProgram(state.effect.id, state.effect.fragment);
    gl.useProgram(prog);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniform(prog, "u_img"), 0);
    gl.uniform2f(this.uniform(prog, "u_resolution"), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.uniform(prog, "u_viewScale"), state.viewScale);
    gl.uniform1f(this.uniform(prog, "u_rotate"), state.rotate);
    gl.uniform1f(this.uniform(prog, "u_offset"), state.offset);
    gl.uniform1f(this.uniform(prog, "u_fogR"), state.fogR);
    gl.uniform1f(this.uniform(prog, "u_fogSoft"), state.fogSoft);
    gl.uniform1f(this.uniform(prog, "u_fogStr"), state.fogStr);
    gl.uniform3f(this.uniform(prog, "u_win"), state.winX, state.winY, state.winSize);

    for (const p of state.effect.params) {
      const v = state.params[p.key] ?? p.default;
      gl.uniform1f(this.uniform(prog, "u_" + p.key), v);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- 反応拡散などのシミュレーション系 ---
  private renderSim(state: RenderState) {
    const gl = this.gl;
    const sim = state.effect.sim!;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    this.ensureSimTargets(w, h);

    if (this.simDirty) {
      this.seedSim(state.effect.id, sim.seedFragment);
      this.simDirty = false;
    }

    const steps = Math.max(1, Math.round(state.params.steps ?? 8));
    this.stepSim(state, sim.stepFragment, steps);

    // 表示パス: 状態テクスチャ(unit1)+ 元画像(unit0)で着色
    const prog = this.getProgram(state.effect.id, state.effect.fragment);
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniform(prog, "u_img"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.simTex![this.simCur]);
    gl.uniform1i(this.uniform(prog, "u_state"), 1);
    for (const p of state.effect.params) {
      gl.uniform1f(this.uniform(prog, "u_" + p.key), state.params[p.key] ?? p.default);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  private ensureSimTargets(w: number, h: number) {
    if (this.simTex && this.simW === w && this.simH === h) return;
    const gl = this.gl;
    if (this.simTex) this.simTex.forEach((t) => gl.deleteTexture(t));
    if (this.simFbo) this.simFbo.forEach((f) => gl.deleteFramebuffer(f));
    this.simW = w;
    this.simH = h;
    const tex = [0, 1].map(() => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.simInternal, w, h, 0, gl.RGBA, this.simType, null);
      return t;
    }) as [WebGLTexture, WebGLTexture];
    const fbo = tex.map((t) => {
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    }) as [WebGLFramebuffer, WebGLFramebuffer];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.simTex = tex;
    this.simFbo = fbo;
    this.simCur = 0;
    this.simDirty = true;
  }

  private seedSim(effectId: string, seedFragment: string) {
    const gl = this.gl;
    const prog = this.getProgram(effectId + "::seed", seedFragment);
    gl.useProgram(prog);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.simFbo![0]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniform(prog, "u_img"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.simCur = 0;
  }

  private stepSim(state: RenderState, stepFragment: string, n: number) {
    const gl = this.gl;
    const prog = this.getProgram(state.effect.id + "::step", stepFragment);
    gl.useProgram(prog);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.uniform2f(this.uniform(prog, "u_texel"), 1 / this.simW, 1 / this.simH);
    gl.uniform1f(this.uniform(prog, "u_feed"), state.params.feed ?? 0.054);
    gl.uniform1f(this.uniform(prog, "u_kill"), state.params.kill ?? 0.062);
    for (let i = 0; i < n; i++) {
      const src = this.simCur;
      const dst = 1 - src;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.simFbo![dst]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.simTex![src]);
      gl.uniform1i(this.uniform(prog, "u_state"), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.simCur = dst;
    }
  }

  get ready() {
    return this.hasImage;
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.canvas as HTMLCanvasElement;
  }
}
