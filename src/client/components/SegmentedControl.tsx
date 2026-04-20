import type { ReactNode } from "react";

interface Option<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<V extends string> {
  label: string;
  value: V;
  options: Option<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
}

export function SegmentedControl<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SegmentedControlProps<V>) {
  return (
    <div
      className="segmented-control"
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA composite radiogroup pattern — segmented visual needs button base
          <button
            type="button"
            key={opt.value}
            className={`segmented-control__option${
              selected ? " segmented-control__option--selected" : ""
            }`}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const idx = options.findIndex((o) => o.value === value);
                const prev = options[(idx - 1 + options.length) % options.length];
                onChange(prev.value);
              } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const idx = options.findIndex((o) => o.value === value);
                const next = options[(idx + 1) % options.length];
                onChange(next.value);
              }
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
