import { useEffect, useRef } from "react";
import { Renderer } from "../webgl/Renderer";
import type { Effect } from "../effects";

type Props = {
  image: TexImageSource | null;
  effect: Effect;
  params: Record<string, number>;
  viewScale: number;
  rotate: number; // 手動の基準回転
  animateZoom: boolean;
  zoomSpeed: number; // 周期/秒
  animateRotate: boolean;
  rotateSpeed: number; // 回転/秒
  resolution: number; // 描画解像度(px、正方形)
  onReady?: (r: Renderer) => void;
};

const TAU = Math.PI * 2;

export function ShaderCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const zoomPhaseRef = useRef(0); // u_offset
  const rotPhaseRef = useRef(0); // 追加回転
  // 最新の props をフレームループから参照するための ref
  const stateRef = useRef(props);
  stateRef.current = props;

  // 初期化
  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new Renderer(canvas);
    rendererRef.current = r;
    props.onReady?.(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画像更新
  useEffect(() => {
    if (props.image && rendererRef.current) {
      rendererRef.current.setImage(props.image);
    }
  }, [props.image]);

  // 描画ループ
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      const s = stateRef.current;
      const r = rendererRef.current;
      if (r) {
        const period = s.effect.animPeriod(s.params);
        if (s.animateZoom) {
          zoomPhaseRef.current = (zoomPhaseRef.current + dt * s.zoomSpeed * period) % period;
        }
        if (s.animateRotate) {
          rotPhaseRef.current = (rotPhaseRef.current + dt * s.rotateSpeed * TAU) % TAU;
        }
        r.render({
          effect: s.effect,
          params: s.params,
          viewScale: s.viewScale,
          rotate: s.rotate + rotPhaseRef.current,
          offset: zoomPhaseRef.current,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={props.resolution}
      height={props.resolution}
      className="shader-canvas"
    />
  );
}
