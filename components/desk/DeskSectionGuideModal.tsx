"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DeskSectionGuide } from "@/lib/desk-section-guides";

type DeskSectionGuideModalProps = {
  open: boolean;
  guide: DeskSectionGuide;
  onClose: () => void;
};

/** Explains Watchlist / Structure / Triggers in plain language. */
export function DeskSectionGuideModal({
  open,
  guide,
  onClose,
}: DeskSectionGuideModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => closeRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="modal-overlay fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-card desk-guide-modal desk-guide-modal--${guide.id}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="desk-guide-header">
          <div className="desk-guide-header-top">
            <p className="font-mono-label">{guide.eyebrow}</p>
            <button
              type="button"
              className="btn-ghost desk-guide-close"
              aria-label="Close"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <h3 id={titleId} className="modal-title desk-guide-title">
            {guide.title}
          </h3>
          <p className="desk-guide-summary">{guide.summary}</p>
        </header>

        <div className="desk-guide-scroll">
          {guide.blocks.map((block) => (
            <section key={block.heading} className="desk-guide-section">
              <h4 className="desk-guide-section-title">{block.heading}</h4>
              <p className="desk-guide-section-body">{block.body}</p>
              {block.bullets?.length ? (
                <ul className="desk-guide-list">
                  {block.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <section className="desk-guide-section desk-guide-section--example">
            <h4 className="desk-guide-section-title">{guide.example.title}</h4>
            <p className="desk-guide-section-body">{guide.example.body}</p>
          </section>

          <section className="desk-guide-section desk-guide-section--last">
            <h4 className="desk-guide-section-title">How it fits the desk</h4>
            <p className="desk-guide-section-body">{guide.compare}</p>
          </section>
        </div>

        <footer className="desk-guide-footer">
          <button
            ref={closeRef}
            type="button"
            className="btn-primary desk-guide-cta"
            onClick={onClose}
          >
            Got it
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
