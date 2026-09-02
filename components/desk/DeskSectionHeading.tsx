"use client";

import { useState } from "react";

import { DeskSectionGuideModal } from "@/components/desk/DeskSectionGuideModal";
import { Tip } from "@/components/ui/Tip";
import {
  DESK_SECTION_GUIDES,
  type DeskSectionId,
} from "@/lib/desk-section-guides";

type DeskSectionHeadingProps = {
  sectionId: DeskSectionId;
  title: string;
  subtitle?: string;
  className?: string;
  /** Thin rule above section (Structure, Triggers). */
  divider?: boolean;
};

function InfoIcon() {
  return (
    <svg
      className="desk-section-info-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="8.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 9v5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="6.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Sidebar section title with info modal — typographic, not card chrome. */
export function DeskSectionHeading({
  sectionId,
  title,
  subtitle,
  className = "",
  divider = false,
}: DeskSectionHeadingProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const guide = DESK_SECTION_GUIDES[sectionId];

  return (
    <>
      <div
        className={`desk-section-head desk-section-head--${sectionId} ${
          divider ? "desk-section-head--divider" : ""
        } ${className}`.trim()}
      >
        <Tip label={`What is ${title}?`} as="span">
          <button
            type="button"
            className="desk-section-info"
            aria-label={`About ${title}`}
            onClick={() => setGuideOpen(true)}
          >
            <InfoIcon />
          </button>
        </Tip>
        <h2 className="desk-section-title">{title}</h2>
      </div>
      {subtitle ? <p className="desk-section-sub">{subtitle}</p> : null}
      <DeskSectionGuideModal
        open={guideOpen}
        guide={guide}
        onClose={() => setGuideOpen(false)}
      />
    </>
  );
}
