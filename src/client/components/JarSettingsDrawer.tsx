import type {
  JarAppearance,
  JarConfig,
  NoteVisibility,
  OnLeaveBehavior,
  PullVisibility,
} from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { useDrawer } from "../hooks/useDrawer";
import { BulkImportForm } from "./BulkImportForm";
import { SegmentedControl } from "./SegmentedControl";

interface JarSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  jarId: string;
  name: string;
  appearance: JarAppearance;
  config: JarConfig;
  /** How many notes are currently pulled — disables the bulk-reset buttons when zero. */
  pulledNoteCount?: number;
  onSaved: () => void;
  /** Owner-only: flip every pulled note back to in_jar. */
  onReturnAll?: () => void;
  /** Owner-only: discard every pulled note. */
  onDiscardAll?: () => void;
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
  pulledNoteCount = 0,
  onSaved,
  onReturnAll,
  onDiscardAll,
}: JarSettingsDrawerProps) {
  const [localName, setLocalName] = useState(name);
  const [localLabel, setLocalLabel] = useState(appearance.label ?? "");
  // Sealed-reveal slider needs local state so a drag doesn't emit one PATCH
  // per step (used to hit the per-socket rate limiter at ~12 PATCHes/drag,
  // silently 429, and leave the slider feeling frozen). Save once on commit.
  const [localReveal, setLocalReveal] = useState<number>(config.sealedRevealCount ?? 1);
  const drawerRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);

  useDrawer(drawerRef, open, onClose);

  // Sync local state only on the open → true transition, so we reflect the
  // latest authoritative state when the drawer is freshly opened. Syncing on
  // every prop change (including `appearance.label` and `name`) would clobber
  // the user's unsaved typing whenever an unrelated setting's save round-trips
  // back through the socket.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setLocalName(name);
      setLocalLabel(appearance.label ?? "");
    }
    wasOpen.current = open;
  }, [open, name, appearance.label]);

  // Keep the slider in sync with authoritative server state when the server
  // updates out from under us (another user changed it, or our own commit
  // came back). Safe because the user has released the control by then.
  useEffect(() => {
    setLocalReveal(config.sealedRevealCount ?? 1);
  }, [config.sealedRevealCount]);

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
                  Reveal at {localReveal} {localReveal === 1 ? "pull" : "pulls"}
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={localReveal}
                  onChange={(e) => setLocalReveal(Number(e.target.value))}
                  onPointerUp={() => {
                    if (localReveal !== (config.sealedRevealCount ?? 1)) {
                      void saveConfig({ sealedRevealCount: localReveal });
                    }
                  }}
                  onKeyUp={(e) => {
                    // Keyboard users commit on arrow/Home/End release.
                    if (
                      e.key.startsWith("Arrow") ||
                      e.key === "Home" ||
                      e.key === "End" ||
                      e.key === "PageUp" ||
                      e.key === "PageDown"
                    ) {
                      if (localReveal !== (config.sealedRevealCount ?? 1)) {
                        void saveConfig({ sealedRevealCount: localReveal });
                      }
                    }
                  }}
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

            <div className="jar-settings-field">
              <span className="jar-settings-field__label">When someone leaves</span>
              <SegmentedControl<OnLeaveBehavior>
                label="When someone leaves"
                value={config.onLeaveBehavior ?? "return"}
                options={[
                  { value: "return", label: "Return notes" },
                  { value: "discard", label: "Discard notes" },
                ]}
                onChange={(v) => saveConfig({ onLeaveBehavior: v })}
              />
              <span className="jar-settings-field__hint">
                What happens to their pulled notes when a member leaves the room.
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
              <label className="jar-settings-toggle">
                <input
                  type="checkbox"
                  checked={config.locked ?? false}
                  onChange={(e) => saveConfig({ locked: e.target.checked })}
                />
                <span>
                  Lock jar
                  <span className="jar-settings-toggle__hint">
                    Blocks new notes + discards. Pulls + returns still work.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <AccessSection
            config={config}
            onSave={(allowedEmails) => saveConfig({ allowedEmails })}
          />

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

          <ResetPulledSection
            pulledNoteCount={pulledNoteCount}
            onReturnAll={onReturnAll}
            onDiscardAll={onDiscardAll}
          />
        </div>
      </aside>
    </>
  );
}

/**
 * Owner-facing allowlist editor. One email per line, case-insensitive. When
 * the list is non-empty, the jar becomes "private + invite only" — the
 * server's canAccessJar gates GET /api/jars/:id, room:join, and room-creation
 * to this list plus the owner. Empty list = default access rules (owner only
 * if private, everyone if public/template).
 *
 * Commits on blur to match the Name + Label fields. The sanitizer on the
 * server normalizes (lowercases + dedupes) the list before persisting, so
 * typos caught server-side just show the usual save error.
 */
function AccessSection({
  config,
  onSave,
}: {
  config: JarConfig;
  onSave: (emails: string[]) => void;
}) {
  const existing = (config.allowedEmails ?? []).join("\n");
  const [local, setLocal] = useState(existing);

  // Re-seed the textarea when the authoritative list changes from elsewhere
  // (e.g. a co-owner edits in another tab). The `existing` key captures both
  // count and contents.
  useEffect(() => {
    setLocal(existing);
  }, [existing]);

  const parse = (raw: string): string[] =>
    raw
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);

  const commit = () => {
    const next = parse(local);
    const nextSorted = [...next].sort();
    const existingSorted = [...(config.allowedEmails ?? [])].sort();
    if (nextSorted.join("\n") === existingSorted.join("\n")) return;
    onSave(next);
  };

  return (
    <section className="jar-settings-section">
      <h3 className="jar-settings-section__title">Access</h3>
      <p className="jar-settings-section__hint">
        One email per line. When anyone is on this list, the jar is invite-only — only you and
        people on the list can view, join, or create rooms for it. Leave empty for the default
        access rules.
      </p>
      <textarea
        className="jar-settings-allowlist"
        value={local}
        placeholder={"alice@example.com\nbob@example.com"}
        rows={4}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
      />
    </section>
  );
}

function ResetPulledSection({
  pulledNoteCount,
  onReturnAll,
  onDiscardAll,
}: {
  pulledNoteCount: number;
  onReturnAll?: () => void;
  onDiscardAll?: () => void;
}) {
  if (!onReturnAll && !onDiscardAll) return null;
  const hint =
    pulledNoteCount > 0
      ? `${pulledNoteCount} note${pulledNoteCount === 1 ? "" : "s"} currently pulled.`
      : "Nothing is pulled right now.";
  return (
    <section className="jar-settings-section">
      <h3 className="jar-settings-section__title">Reset pulled notes</h3>
      <p className="jar-settings-section__hint">{hint}</p>
      <div className="jar-settings-reset-actions">
        {onReturnAll && (
          <button
            type="button"
            className="btn--ghost jar-settings-reset-actions__btn"
            onClick={onReturnAll}
            disabled={pulledNoteCount === 0}
          >
            Return all
          </button>
        )}
        {onDiscardAll && (
          <button
            type="button"
            className="btn--ghost jar-settings-reset-actions__btn jar-settings-reset-actions__btn--danger"
            onClick={onDiscardAll}
            disabled={pulledNoteCount === 0}
          >
            Discard all
          </button>
        )}
      </div>
    </section>
  );
}
