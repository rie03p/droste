import { useRef } from "react";

type Props = {
  onImage: (img: HTMLImageElement) => void;
};

export function ImageUploader({ onImage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      onImage(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div
      className="uploader"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handleFile(e.dataTransfer.files[0]);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <span>画像をドラッグ&ドロップ / クリックして選択</span>
    </div>
  );
}
