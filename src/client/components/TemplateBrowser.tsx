import type { Jar } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

interface TemplateBrowserProps {
  onClone: (jarId: string) => void;
  isCloning: boolean;
}

export function TemplateBrowser({ onClone, isCloning }: TemplateBrowserProps) {
  const [templates, setTemplates] = useState<Jar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/jars/templates/list");
      if (res.ok) {
        setTemplates(await res.json());
      }
    } catch {
      // Silently fail
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen && templates.length === 0) {
      loadTemplates();
    }
  }, [isOpen, templates.length, loadTemplates]);

  return (
    <div className="template-browser">
      <button type="button" className="template-browser__toggle" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? "Hide templates" : "Browse templates"}
      </button>

      {isOpen && (
        <div className="template-browser__list">
          {isLoading && <p className="template-browser__loading">Loading...</p>}
          {!isLoading && templates.length === 0 && (
            <p className="template-browser__empty">No templates available</p>
          )}
          {templates.map((t) => (
            <div key={t.id} className="template-card">
              <span className="template-card__name">{t.name}</span>
              <button
                type="button"
                className="template-card__clone"
                onClick={() => onClone(t.id)}
                disabled={isCloning}
              >
                {isCloning ? "Cloning..." : "Use this"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
