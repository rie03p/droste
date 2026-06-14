import { useEffect, useRef } from "react";

type Props = {
  strip: HTMLCanvasElement; // 焼き込んだ log 帯
  replaced: HTMLImageElement | null; // 差し替え(編集後)の帯。あればこちらを使う
  onReplace: (img: HTMLImageElement | null) => void;
};

const PW = 240; // プレビュー幅

// log 帯(中間画像)のプレビュー・書き出し・差し替え。
// 帯は横(対数半径, 周期 lnf)・縦(角度, 2π)ともにタイルする。横の継ぎ目を
// 外部ツールで均す → 差し替え、で「端を繋ぐ編集」ができる。
export function StripPanel(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { strip, replaced } = props;
  const src: CanvasImageSource = replaced ?? strip;
  const sw = replaced ? replaced.naturalWidth : strip.width;
  const sh = replaced ? replaced.naturalHeight : strip.height;
  const ph = Math.max(1, Math.round((PW * sh) / sw));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, PW, ph);
    ctx.drawImage(src, 0, 0, PW, ph);
  }, [src, ph]);

  const download = () => {
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d")!.drawImage(src, 0, 0);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `logstrip-${Date.now()}.png`;
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
      <span className="field-label">log 帯（中間画像）</span>
      <p className="desc">
        元画像を log-polar の帯に焼いたもの。横=対数半径(1周期=lnf)、縦=角度(2π)で両方向にタイルする。
        ダウンロードして横の継ぎ目を均し、差し替えると「端を繋ぐ編集」ができる。
      </p>
      <canvas ref={ref} width={PW} height={ph} className="strip-preview" />
      <div className="strip-actions">
        <button onClick={download}>帯を保存 (PNG)</button>
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
