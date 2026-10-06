import type { ReactNode, SVGProps } from "react";

/** Thin-line icon set, drawn on a 24px grid to match the editorial restraint. */
type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Sparkle = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />
    <path d="M18.5 15.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
  </Base>
);

export const Send = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12l16-8-6 16-3-6-7-2Z" />
  </Base>
);

export const Mic = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Base>
);

export const Check = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Base>
);

export const Plus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const Heart = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 7a4 4 0 0 1 7 3.7C19 15.6 12 20 12 20Z" />
  </Base>
);

export const X = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const ChevronDown = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9l6 6 6-6" />
  </Base>
);

export const ArrowLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Base>
);

export const Wand = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 19l9-9M14 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM19 12l.7 1.5L21 14l-1.3.5L19 16l-.7-1.5L17 14l1.3-.5L19 12Z" />
  </Base>
);

export const Refresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </Base>
);

export const Play = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 5l11 7-11 7V5Z" />
  </Base>
);

export const Bag = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 8h14l-1 12H6L5 8Z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Base>
);

export const Upload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </Base>
);

export const Camera = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z" />
    <circle cx="12" cy="13" r="3.2" />
  </Base>
);

export const Layers = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5Z" />
    <path d="M3 13l9 5 9-5" />
  </Base>
);
