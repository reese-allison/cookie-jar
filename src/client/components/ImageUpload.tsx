import { useRef, useState } from "react";

interface ImageUploadProps {
  label: string;
  value?: string;
  onUpload: (url: string) => void;
  onRemove?: () => void;
  accept?: string;
}

type UploadState = "idle" | "uploading" | "error";

async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/uploads", {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const data: { url: string } = await res.json();
  return data.url;
}

export function ImageUpload({
  label,
  value,
  onUpload,
  onRemove,
  accept = "image/png,image/jpeg,image/webp,image/gif",
}: ImageUploadProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setErrorMsg(null);
    setState("uploading");
    try {
      const url = await uploadFile(file);
      onUpload(url);
      setState("idle");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const classNames = [
    "image-upload",
    isDragOver ? "image-upload--drag-over" : "",
    value ? "image-upload--uploaded" : "",
    state === "error" ? "image-upload--error" : "",
    state === "uploading" ? "image-upload--uploading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames}>
      {value ? (
        <>
          <img src={value} alt="" className="image-upload__thumb" />
          <div className="image-upload__actions">
            <button type="button" className="image-upload__btn" onClick={pickFile}>
              Replace
            </button>
            {onRemove && (
              <button
                type="button"
                className="image-upload__btn image-upload__btn--danger"
                onClick={onRemove}
                aria-label={`Remove ${label}`}
              >
                Remove
              </button>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="image-upload__drop"
          onClick={pickFile}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={onDrop}
          aria-label={label}
        >
          {state === "uploading" ? (
            <span className="image-upload__status">Uploading…</span>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
                className="image-upload__icon"
              >
                <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" strokeLinecap="round" />
              </svg>
              <span className="image-upload__label">Drop or click</span>
            </>
          )}
        </button>
      )}
      {errorMsg && (
        <p className="image-upload__error" role="alert">
          {errorMsg}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
