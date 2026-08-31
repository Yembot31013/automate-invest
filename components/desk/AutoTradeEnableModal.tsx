"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { Spinner } from "@/components/ui/Feedback";
import {
  AUTO_TRADE_DISCLAIMER,
  AUTO_TRADE_QUIZ,
  correctQuizOptionId,
  type QuizAnswers,
} from "@/lib/desk-settings";

type AutoTradeEnableModalProps = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Resolves true when Auto-trade was enabled; false keeps the quiz step for retry. */
  onEnable: (payload: {
    agreed: boolean;
    quizAnswers: QuizAnswers;
  }) => Promise<boolean>;
};

type Step = "disclaimer" | "success" | number;

/** Multi-step: disclaimer → teach-back quiz → success (user closes). */
export function AutoTradeEnableModal({
  open,
  busy = false,
  error = null,
  onCancel,
  onEnable,
}: AutoTradeEnableModalProps) {
  const [mounted, setMounted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  /** Question ids where the user has made a first pick (feedback unlocked). */
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [step, setStep] = useState<Step>("disclaimer");
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const agreeId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setAgreed(false);
    setAnswers({});
    setRevealed({});
    setStep("disclaimer");
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, submitting, onCancel]);

  if (!mounted || !open) return null;

  const quizCount = AUTO_TRADE_QUIZ.length;
  const quizIndex = typeof step === "number" ? step : -1;
  const question = quizIndex >= 0 ? AUTO_TRADE_QUIZ[quizIndex] : null;
  const isLastQuiz = quizIndex === quizCount - 1;
  const selectedId = question ? answers[question.id] : undefined;
  const correctId = question ? correctQuizOptionId(question) : null;
  const correctOption = question?.options.find((o) => o.correct) ?? null;
  const feedbackOpen = question ? Boolean(revealed[question.id]) : false;
  const pickedCorrect =
    Boolean(selectedId) && Boolean(correctId) && selectedId === correctId;
  const canAdvance = feedbackOpen && pickedCorrect;
  const locked = busy || submitting;

  const stepLabel =
    step === "success"
      ? "Done"
      : step === "disclaimer"
        ? `Step 1 of ${quizCount + 1}`
        : `Step ${quizIndex + 2} of ${quizCount + 1}`;

  const title =
    step === "success"
      ? "Auto-trade is on"
      : step === "disclaimer"
        ? "How Auto works"
        : "Quick check";

  function pickOption(questionId: string, optionId: string) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setRevealed((prev) => ({ ...prev, [questionId]: true }));
  }

  async function goNextQuiz() {
    if (!canAdvance || locked) return;
    if (isLastQuiz) {
      setSubmitting(true);
      try {
        const ok = await onEnable({ agreed, quizAnswers: answers });
        if (ok) setStep("success");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep(quizIndex + 1);
  }

  return createPortal(
    <div
      className="modal-overlay fade-up"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget || locked) return;
        if (step === "success") onCancel();
      }}
    >
      <div
        className="modal-card auto-trade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="auto-trade-modal-head">
          <div className="min-w-0">
            <p className="font-mono-label">Auto-trade</p>
            <h3 id={titleId} className="modal-title">
              {title}
            </h3>
          </div>
          <p className="auto-trade-step-count">{stepLabel}</p>
        </div>

        {step !== "success" ? (
          <div className="auto-trade-stepper" aria-hidden="true">
            <span
              className={`auto-trade-step-dot ${step === "disclaimer" ? "is-active" : "is-done"}`}
            />
            {AUTO_TRADE_QUIZ.map((q, i) => (
              <span
                key={q.id}
                className={`auto-trade-step-dot ${
                  quizIndex === i
                    ? "is-active"
                    : quizIndex > i
                      ? "is-done"
                      : ""
                }`}
              />
            ))}
          </div>
        ) : null}

        <div className="modal-body auto-trade-modal-body">
          {step === "success" ? (
            <div className="auto-trade-success" role="status">
              <p className="auto-trade-success-kicker">You’re all set</p>
              <p className="auto-trade-success-copy">
                Auto can sell positions you already own and buy dips only from
                your watchlist. Attention mail still pings you when something
                needs a look. Turn Auto off anytime from the desk.
              </p>
            </div>
          ) : step === "disclaimer" ? (
            <div className="auto-trade-disclaimer">
              <p className="auto-trade-disclaimer-copy">{AUTO_TRADE_DISCLAIMER}</p>
              <div className="auto-trade-agree">
                <button
                  type="button"
                  id={agreeId}
                  role="switch"
                  aria-checked={agreed}
                  disabled={locked}
                  className={`desk-switch ${agreed ? "is-on" : ""}`}
                  onClick={() => setAgreed((v) => !v)}
                >
                  <span className="desk-switch-knob" aria-hidden="true" />
                </button>
                <label htmlFor={agreeId} className="auto-trade-agree-label">
                  I get it — Auto helps, it’s not flawless, and I’m cool leaving
                  it on (I can turn it off anytime).
                </label>
              </div>
            </div>
          ) : question ? (
            <div className="auto-trade-quiz" aria-disabled={locked || undefined}>
              <p className="auto-trade-quiz-prompt">{question.prompt}</p>
              <div
                className="auto-trade-options"
                role="radiogroup"
                aria-label={question.prompt}
              >
                {question.options.map((opt) => {
                  const selected = selectedId === opt.id;
                  let toneClass = "";
                  if (selected) {
                    if (feedbackOpen && !opt.correct) toneClass = "is-wrong";
                    else if (feedbackOpen && opt.correct)
                      toneClass = "is-correct";
                    else toneClass = "is-selected";
                  } else if (feedbackOpen && !pickedCorrect && opt.correct) {
                    toneClass = "is-answer-hint";
                  }
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={locked}
                      className={`auto-trade-option ${toneClass}`}
                      onClick={() => pickOption(question.id, opt.id)}
                    >
                      <span
                        className={`auto-trade-radio ${selected ? "is-selected" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="auto-trade-option-text">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {feedbackOpen && correctOption ? (
                <div
                  className={`auto-trade-teach ${pickedCorrect ? "is-ok" : "is-miss"}`}
                  role="status"
                >
                  <p className="auto-trade-teach-eyebrow">
                    {pickedCorrect
                      ? "Nice — that’s it"
                      : "Not that one — here’s the answer"}
                  </p>
                  {!pickedCorrect ? (
                    <p className="auto-trade-teach-answer">
                      <strong>Correct:</strong> {correctOption.label}
                    </p>
                  ) : null}
                  <p className="auto-trade-teach-body">
                    {question.explainCorrect}
                  </p>
                  {!pickedCorrect ? (
                    <p className="auto-trade-teach-hint">
                      Tap the correct option above to continue.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {error && step !== "success" ? (
            <p
              className="mt-4 text-sm font-semibold text-[var(--orange)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="modal-actions">
          {step === "success" ? (
            <button type="button" className="btn-primary" onClick={onCancel}>
              Done
            </button>
          ) : step === "disclaimer" ? (
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={locked}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={locked || !agreed}
                onClick={() => setStep(0)}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={locked}
                onClick={() => {
                  if (quizIndex <= 0) setStep("disclaimer");
                  else setStep(quizIndex - 1);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={locked || !canAdvance}
                onClick={() => {
                  void goNextQuiz();
                }}
              >
                {submitting && isLastQuiz ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner size="sm" label="Enabling" />
                    Enabling…
                  </span>
                ) : isLastQuiz ? (
                  "Enable Auto-trade"
                ) : (
                  "Next"
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
