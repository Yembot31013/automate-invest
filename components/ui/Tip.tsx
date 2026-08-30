"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";

type TipProps = {
  label: string;
  children: ReactNode;
  side?: Side;
  className?: string;
  as?: "span" | "div";
};

const GAP = 12;
const PAD = 12;
/** Park off-screen until measured so the tip never flashes over the trigger. */
const HIDDEN_STYLE: CSSProperties = {
  position: "fixed",
  top: 0,
  left: -9999,
  visibility: "hidden",
  pointerEvents: "none",
};

function overlapsAnchor(
  anchor: DOMRect,
  top: number,
  left: number,
  width: number,
  height: number,
): boolean {
  const tipRight = left + width;
  const tipBottom = top + height;
  return !(
    tipRight < anchor.left - 2 ||
    left > anchor.right + 2 ||
    tipBottom < anchor.top - 2 ||
    top > anchor.bottom + 2
  );
}

function placeTooltip(
  anchor: DOMRect,
  tip: DOMRect,
  preferred: Side,
): { top: number; left: number; side: Side } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = tip.width;
  const th = tip.height;

  const candidates: Side[] = [
    preferred,
    ...(["bottom", "top", "right", "left"] as Side[]).filter(
      (s) => s !== preferred,
    ),
  ];

  for (const side of candidates) {
    let top = 0;
    let left = 0;

    if (side === "top") {
      top = anchor.top - th - GAP;
      left = anchor.left + anchor.width / 2 - tw / 2;
    } else if (side === "bottom") {
      top = anchor.bottom + GAP;
      left = anchor.left + anchor.width / 2 - tw / 2;
    } else if (side === "left") {
      top = anchor.top + anchor.height / 2 - th / 2;
      left = anchor.left - tw - GAP;
    } else {
      top = anchor.top + anchor.height / 2 - th / 2;
      left = anchor.right + GAP;
    }

    // Keep in viewport on the free axis only — never pull tip over the trigger.
    if (side === "top" || side === "bottom") {
      left = Math.min(Math.max(PAD, left), vw - tw - PAD);
    } else {
      top = Math.min(Math.max(PAD, top), vh - th - PAD);
    }

    const inView =
      top >= PAD - 1 &&
      left >= PAD - 1 &&
      top + th <= vh - PAD + 1 &&
      left + tw <= vw - PAD + 1;

    if (!inView) continue;
    if (overlapsAnchor(anchor, top, left, tw, th)) continue;

    return { top, left, side };
  }

  // Last resort: below the anchor, shifted into view, still avoiding overlap.
  let top = anchor.bottom + GAP;
  let left = Math.min(
    Math.max(PAD, anchor.left + anchor.width / 2 - tw / 2),
    vw - tw - PAD,
  );
  if (top + th > vh - PAD) {
    top = Math.max(PAD, anchor.top - th - GAP);
  }
  if (overlapsAnchor(anchor, top, left, tw, th)) {
    top = Math.min(vh - th - PAD, anchor.bottom + GAP);
  }
  return { top, left, side: "bottom" };
}

/** Hover/focus tooltip portaled to body — never clipped by overflow parents. */
export function Tip({
  label,
  children,
  side = "top",
  className = "",
  as: Tag = "span",
}: TipProps) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_STYLE);

  useEffect(() => {
    setMounted(true);
  }, []);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const tipEl = tipRef.current;
    if (!anchor || !tipEl) return;
    // Measure with visibility hidden but laid out
    const tip = tipEl.getBoundingClientRect();
    const next = placeTooltip(anchor, tip.width ? tip : { ...tip, width: tipEl.offsetWidth, height: tipEl.offsetHeight }, side);
    setStyle({
      position: "fixed",
      top: next.top,
      left: next.left,
      visibility: "visible",
      pointerEvents: "none",
    });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) return;
    // Double rAF so tip has real dimensions before place
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => reposition());
    });
    return () => cancelAnimationFrame(id);
  }, [open, label, reposition]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  const show = () => {
    setStyle(HIDDEN_STYLE);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setStyle(HIDDEN_STYLE);
  };

  return (
    <>
      <Tag
        ref={anchorRef as never}
        className={`tip-anchor ${className}`.trim()}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => {
          if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
            show();
          }
        }}
        onMouseLeave={hide}
        onFocus={(e) => {
          // Keyboard only — avoids sticky tips when tapping disabled Send on mobile.
          if (e.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={hide}
      >
        {children}
      </Tag>
      {mounted &&
        open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="tip-float"
            style={style}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
