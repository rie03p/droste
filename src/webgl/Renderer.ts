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
export class Renderer {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private uniformCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private texture: WebGLTexture;
  private hasImage = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 が利用できません");
    this.gl = gl;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Droste/Escher は座標を基本領域 [0,1]² に畳んでから参照するので端は CLAMP で十分
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 1x1 のプレースホルダ(gruvbox bg0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 40, 255]));
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
  }

  private getProgram(effect: Effect): WebGLProgram {
    let prog = this.programs.get(effect.id);
    if (prog) return prog;
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compile(gl.FRAGMENT_SHADER, effect.fragment);
    prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("link error: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.programs.set(effect.id, prog);
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
    const gl = this.gl;
    const prog = this.getProgram(state.effect);
    gl.useProgram(prog);

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

  get ready() {
    return this.hasImage;
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.canvas as HTMLCanvasElement;
  }
}
