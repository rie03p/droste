import { VERTEX_SHADER, LOGSTRIP_BAKE_FRAGMENT } from "../effects";

export type BakeParams = {
  zoomF: number; // f = 1/size
  winX: number; // 窓中心 cx
  winY: number; // 窓中心 cy(テクスチャ座標。App 側で 1-cy 済みを渡す)
  winSize: number; // 窓サイズ size
};

// 元画像を log-polar の「帯」テクスチャへ焼き込む専用レンダラ。
// 自前のオフスクリーン canvas に描くので、その canvas をそのまま
// プレビュー描画・PNG 書き出し・他レンダラのテクスチャ源に使える。
export class LogStripBaker {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 が利用できません");
    this.gl = gl;

    const vs = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compile(gl.FRAGMENT_SHADER, LOGSTRIP_BAKE_FRAGMENT);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("link error: " + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

  private uniform(name: string): WebGLUniformLocation | null {
    if (this.uniforms.has(name)) return this.uniforms.get(name)!;
    const loc = this.gl.getUniformLocation(this.program, name);
    this.uniforms.set(name, loc);
    return loc;
  }

  // src を帯(w×h)へ焼き、その canvas を返す。返り値は呼び出しごとに同じ canvas(再利用)。
  bake(src: TexImageSource, p: BakeParams, w: number, h: number): HTMLCanvasElement {
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;

    // 元画像をアップロード(メインレンダラと同じく上下反転して右上がりに揃える)
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniform("u_img"), 0);
    gl.uniform2f(this.uniform("u_resolution"), w, h);
    gl.uniform1f(this.uniform("u_zoomF"), p.zoomF);
    gl.uniform3f(this.uniform("u_win"), p.winX, p.winY, p.winSize);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}
