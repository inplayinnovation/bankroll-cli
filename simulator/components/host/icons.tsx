import type { ReactNode } from "react";

// The sidebar's small icons and the button that holds one, in the manner of a
// design tool's panels: a glyph alone, named for assistive technology, that
// lights up under the pointer.

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const Glyph = ({ children }: { children: ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const PlusIcon = () => (
  <Glyph>
    <path d="M7 2.5v9M2.5 7h9" />
  </Glyph>
);

export const XIcon = () => (
  <Glyph>
    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
  </Glyph>
);

export const PencilIcon = () => (
  <Glyph>
    <path d="M9.5 2.5l2 2L5 11l-2.7.7.7-2.7z" />
  </Glyph>
);

/** A circle with a line through it: what a console calls clearing. */
export const ClearIcon = () => (
  <Glyph>
    <circle cx="7" cy="7" r="4.6" />
    <path d="M3.8 3.8l6.4 6.4" />
  </Glyph>
);
