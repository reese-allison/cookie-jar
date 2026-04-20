import { useMemo, useState } from "react";

const MAX_IMPORT = 500;

interface BulkImportFormProps {
  onSubmit: (texts: string[]) => Promise<void> | void;
}

function parseLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function BulkImportForm({ onSubmit }: BulkImportFormProps) {
  const [raw, setRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const lines = useMemo(() => parseLines(raw), [raw]);
  const overLimit = lines.length > MAX_IMPORT;
  const canSubmit = lines.length > 0 && !overLimit && !submitting;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(lines);
      setRaw("");
      setFeedback(`Added ${lines.length} notes`);
    } catch (_err) {
      setFeedback("Import failed — try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="bulk-import" onSubmit={handleSubmit}>
      <label htmlFor="bulk-import-textarea" className="bulk-import__label">
        One note per line. Up to {MAX_IMPORT}.
      </label>
      <textarea
        id="bulk-import-textarea"
        className="bulk-import__textarea"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        placeholder={"Pick a restaurant\nPlan a camping trip\nCall mom"}
        disabled={submitting}
      />
      <div className="bulk-import__footer">
        <span
          className={`bulk-import__count${overLimit ? " bulk-import__count--over" : ""}`}
          aria-live="polite"
        >
          {lines.length} notes ready
          {overLimit && ` — over the ${MAX_IMPORT} limit`}
        </span>
        <button type="submit" className="bulk-import__submit" disabled={!canSubmit}>
          {submitting ? "Importing…" : `Import ${lines.length || ""}`.trim()}
        </button>
      </div>
      {feedback && (
        <p className="bulk-import__feedback" role="status">
          {feedback}
        </p>
      )}
    </form>
  );
}
