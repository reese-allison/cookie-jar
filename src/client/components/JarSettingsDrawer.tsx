import type { JarAppearance, JarConfig, NoteVisibility, PullVisibility } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { BulkImportForm } from "./BulkImportForm";
import { SegmentedControl } from "./SegmentedControl";

interface JarSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  jarId: string;
  name: string;
  appearance: JarAppearance;
  config: JarConfig;
  onSaved: () => void;
}

async function patchJar(
  jarId: string,
  patch: { name?: string; appearance?: JarAppearance; config?: JarConfig },
): Promise<void> {
  const res = await fetch(`/api/jars/${jarId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}

async function bulkImport(jarId: string, texts: string[]): Promise<void> {
  const res = await fetch("/api/notes/bulk-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ jarId, texts }),
  });
  if (!res.ok) throw new Error(`bulk import failed: ${res.status}`);
}

export function JarSettingsDrawer({
  open,
  onClose,
  jarId,
  name,
  appearance,
  config,
  onSaved,
}: JarSettingsDrawerProps) {
  const [localName, setLocalName] = useState(name);
  const [localLabel, setLocalLabel] = useState(appearance.label ?? "");
  const drawerRef = useRef<HTMLDivElement>(null);

  // Sync local state when opening (so we always reflect the latest authoritative state)
  useEffect(() => {
    if (open) {
      setLocalName(name);
      setLocalLabel(appearance.label ?? "");
    }
  }, [open, name, appearance.label]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async (patch: Parameters<typeof patchJar>[1]) => {
    try {
      await patchJar(jarId, patch);
      onSaved();
    } catch (err) {
      console.error("save failed", err);
    }
  };

  const saveAppearance = (next: Partial<JarAppearance>) =>
    save({ appearance: { ...appearance, ...next } });
  const saveConfig = (next: Partial<JarConfig>) => save({ config: { ...config, ...next } });

  return (
    <>
      <div
        className="jar-settings-scrim"
        aria-hidden="true"
        onClick={onClose}
        role="presentation"
      />
      <aside
        ref={drawerRef}
        className="jar-settings-drawer"
        role="dialog"
        aria-label="Jar settings"
      >
        <header className="jar-settings-drawer__header">
          <h2 className="jar-settings-drawer__title">Jar settings</h2>
          <button
            type="button"
            className="jar-settings-drawer__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <div className="jar-settings-drawer__body">
          {/* Identity */}
          <section className="jar-settings-section">
            <h3 className="jar-settings-section__title">Identity</h3>
            <label className="jar-settings-field">
              <span className="jar-settings-field__label">Name</span>
              <input
                type="text"
                value={localName}
                maxLength={100}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={() => {
                  const trimmed = localName.trim();
                  if (trimmed && trimmed !== name) void save({ name: trimmed });
                }}
              />
            </label>
            <label className="jar-settings-field">
              <span className="jar-settings-field__label">Label</span>
              <input
                type="text"
                value={localLabel}
                maxLength={60}
                placeholder="e.g. Date Night Ideas"
                onChange={(e) => setLocalLabel(e.target.value)}
                onBlur={() => {
                  if (localLabel !== (appearance.label ?? "")) {
                    void saveAppearance({ label: localLabel || undefined });
                  }
                }}
              />
              <span className="jar-settings-field__hint">Optional, shows below the jar.</span>
            </label>
          </section>

          {/* Visibility */}
          <section className="jar-settings-section">
            <h3 className="jar-settings-section__title">Visibility</h3>
            <div className="jar-settings-field">
              <span className="jar-settings-field__label">Note visibility</span>
              <SegmentedControl<NoteVisibility>
                label="Note visibility"
                value={config.noteVisibility ?? "open"}
                options={[
                  { value: "open", label: "Open" },
                  { value: "sealed", label: "Sealed" },
                ]}
                onChange={(v) => saveConfig({ noteVisibility: v })}
              />
              <span className="jar-settings-field__hint">
                Sealed holds pulls until the reveal count is hit.
              </span>
            </div>

            {config.noteVisibility === "sealed" && (
              <label className="jar-settings-field">
                <span className="jar-settings-field__label">
                  Reveal at {config.sealedRevealCount ?? 1}{" "}
                  {config.sealedRevealCount === 1 ? "pull" : "pulls"}
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={config.sealedRevealCount ?? 1}
                  onChange={(e) => saveConfig({ sealedRevealCount: Number(e.target.value) })}
                />
              </label>
            )}

            <div className="jar-settings-field">
              <span className="jar-settings-field__label">Pull visibility</span>
              <SegmentedControl<PullVisibility>
                label="Pull visibility"
                value={config.pullVisibility ?? "shared"}
                options={[
                  { value: "shared", label: "Shared" },
                  { value: "private", label: "Private" },
                ]}
                onChange={(v) => saveConfig({ pullVisibility: v })}
              />
              <span className="jar-settings-field__hint">
                Private hides pulled notes from other members.
              </span>
            </div>

            <div className="jar-settings-field-group">
              <label className="jar-settings-toggle">
                <input
                  type="checkbox"
                  checked={config.showAuthors ?? false}
                  onChange={(e) => saveConfig({ showAuthors: e.target.checked })}
                />
                <span>Show who wrote each note</span>
              </label>
              <label className="jar-settings-toggle">
                <input
                  type="checkbox"
                  checked={config.showPulledBy ?? false}
                  onChange={(e) => saveConfig({ showPulledBy: e.target.checked })}
                />
                <span>Show who pulled each note</span>
              </label>
            </div>
          </section>

          {/* Notes */}
          <section className="jar-settings-section">
            <h3 className="jar-settings-section__title">Notes</h3>
            <BulkImportForm
              onSubmit={async (texts) => {
                await bulkImport(jarId, texts);
                onSaved();
              }}
            />
          </section>
        </div>
      </aside>
    </>
  );
}
