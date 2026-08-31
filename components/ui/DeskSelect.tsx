"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type DeskSelectOption<T extends string = string> = {
  value: T;
  label: string;
  hint?: string;
};

type DeskSelectProps<T extends string> = {
  id?: string;
  value: T;
  options: Array<DeskSelectOption<T>>;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  onChange: (value: T) => void;
};

/** Custom listbox select — desk-styled, no native `<select>`. */
export function DeskSelect<T extends string>({
  id,
  value,
  options,
  disabled = false,
  placeholder = "Choose…",
  "aria-label": ariaLabel,
  onChange,
}: DeskSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);

    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, options, value]);

  function pick(next: T) {
    onChange(next);
    setOpen(false);
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setHighlight(Math.max(0, options.length - 1));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[highlight];
      if (opt) pick(opt.value);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`desk-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`}
    >
      <button
        id={id}
        type="button"
        className="desk-select-trigger soft-field"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className={`desk-select-value ${selected ? "" : "is-placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <span className="desk-select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={listId}
          className="desk-select-menu fade-up"
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${listId}-opt-${highlight}`}
          onKeyDown={onListKey}
          ref={(el) => {
            el?.focus();
          }}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isActive = index === highlight;
            return (
              <button
                key={opt.value}
                id={`${listId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`desk-select-option ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(opt.value)}
              >
                <span className="desk-select-option-label">{opt.label}</span>
                {opt.hint ? (
                  <span className="desk-select-option-hint">{opt.hint}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
