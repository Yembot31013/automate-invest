"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DISCORD_INVITE_URL,
  ONBOARDING_STEPS,
  markOnboardingComplete,
} from "@/lib/onboarding";

type OnboardingModalProps = {
  open: boolean;
  onClose: () => void;
};

/** First-visit tour for testers — short steps, hero-matching art. */
export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const total = ONBOARDING_STEPS.length;
  const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];
  const isLast = step >= total - 1;

  const finish = useCallback(() => {
    markOnboardingComplete();
    onClose();
  }, [onClose]);

  const goNext = useCallback(() => {
    if (step >= total - 1) {
      finish();
      return;
    }
    setStep((s) => Math.min(s + 1, total - 1));
  }, [finish, step, total]);

  const goBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => primaryRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, finish, goNext, goBack]);

  if (!mounted || !open || !current) return null;

  return createPortal(
    <div
      className="modal-overlay fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
    >
      <div
        className="modal-card onboard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="onboard-top">
          <p className="font-mono-label">
            {step + 1} / {total}
          </p>
          {!isLast ? (
            <button
              type="button"
              className="btn-ghost onboard-skip"
              onClick={finish}
            >
              Skip
            </button>
          ) : (
            <span className="onboard-skip-slot" aria-hidden="true" />
          )}
        </header>

        <div className="onboard-art">
          <Image
            key={current.imageSrc}
            src={current.imageSrc}
            alt={current.imageAlt}
            width={720}
            height={720}
            priority={step === 0}
            className="onboard-art-img"
          />
        </div>

        <div className="onboard-copy">
          <p className="font-mono-label onboard-eyebrow">{current.eyebrow}</p>
          <h3 id={titleId} className="onboard-title">
            {current.title}
          </h3>
          <p className="onboard-body">{current.body}</p>
        </div>

        <footer className="onboard-footer">
          <div className="onboard-dots" aria-hidden="true">
            {ONBOARDING_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`onboard-dot ${i === step ? "is-active" : ""}`}
              />
            ))}
          </div>

          {isLast ? (
            <div className="onboard-actions onboard-actions-final">
              <button
                ref={primaryRef}
                type="button"
                className="btn-primary onboard-cta"
                onClick={finish}
              >
                Enter the desk
              </button>
              <div className="onboard-actions-row">
                <button type="button" className="btn-ghost" onClick={goBack}>
                  Back
                </button>
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost"
                >
                  Join Discord
                </a>
              </div>
            </div>
          ) : (
            <div className="onboard-actions">
              {step > 0 ? (
                <button type="button" className="btn-ghost" onClick={goBack}>
                  Back
                </button>
              ) : (
                <span className="onboard-actions-spacer" />
              )}
              <button
                ref={primaryRef}
                type="button"
                className="btn-primary"
                onClick={goNext}
              >
                Next
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
