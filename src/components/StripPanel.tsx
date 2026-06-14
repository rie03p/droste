import { useEffect, useRef, useState } from "react";

type Props = {
  strip: HTMLCanvasElement; // 焼き込んだ log 帯
  replaced: HTMLImageElement | null; // 差し替え(編集後)の帯。あればこちらを使う
  onReplace: (img: HTMLImageElement | null) => void;
};

const PW = 240; // プレビュー幅

// log 帯(中間画像)のプレビュー・書き出し・差し替え。
// 帯は横(対数半径, 周期 lnf)・縦(角度, 2π)ともにタイルする。横の継ぎ目を
// 外部ツールで均す → 差し替え、で「端を繋ぐ編集」ができる。
// 横タイルしたもの = inverse log-polar(ドロステ化)する前の画像。
export function StripPanel(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState(2); // 横タイル数(シーム確認 & inverse前画像)
  const { strip, replaced } = props;
  const src: CanvasImageSource = replaced ?? strip;
  const sw = replaced ? replaced.naturalWidth : strip.width;
  const sh = replaced ? replaced.naturalHeight : strip.height;
  const ph = Math.max(1, Math.round((PW * sh) / sw)); // 1周期ぶんの高さ

  // プレビューは PW×ph の枠に tiles 個を横に詰めて描く。タイル境界が
  // 右端→左端のシーム。ここが繋がっていれば巻き戻しても継ぎ目が出ない。
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, PW, ph);
    const tw = PW / tiles;
    for (let i = 0; i < tiles; i++) ctx.drawImage(src, i * tw, 0, tw, ph);
  }, [src, ph, tiles]);

  // n 周期ぶんを実寸で横タイルした canvas を作る
  const makeTiled = (n: number) => {
    const c = document.createElement("canvas");
    c.width = sw * n;
    c.height = sh;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < n; i++) ctx.drawImage(src, i * sw, 0, sw, sh);
    return c;
  };

  const save = (n: number, name: string) => {
    const a = document.createElement("a");
    a.href = makeTiled(n).toDataURL("image/png");
    a.download = name;
    a.click();
  };

  const upload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      props.onReplace(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className="strip-panel">
      <span className="field-label">log 帯（中間画像 / inverse前）</span>
      <p className="desc">
        元画像を log-polar に焼いた帯。横=対数半径(1周期=lnf)、縦=角度(2π)。
        「1周期を保存」→外部で横の継ぎ目を均す→「差し替え」で端を繋ぐ編集。
        タイル数を上げると右端↔左端のシームを確認でき、その横タイル画像が inverse 前の画像。
      </p>
      <canvas ref={ref} width={PW} height={ph} className="strip-preview" />
      <label className="slider">
        <span className="slider-label">
          横タイル数
          <em>{tiles}</em>
        </span>
        <input type="range" min={1} max={4} step={1} value={tiles} onChange={(e) => setTiles(+e.target.value)} />
      </label>
      <div className="strip-actions">
        <button onClick={() => save(1, `logstrip-${Date.now()}.png`)}>1周期を保存</button>
        <button onClick={() => save(tiles, `logstrip-tiled-x${tiles}-${Date.now()}.png`)}>
          inverse前(×{tiles})を保存
        </button>
        <label className="strip-upload">
          編集後を差し替え
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {replaced && <button onClick={() => props.onReplace(null)}>焼き直しに戻す</button>}
      </div>
    </div>
  );
}
