/** The Dressly wordmark: a drawn hanger turning into the "D" of the brand. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-3 ${className}`}>
      <svg
        viewBox="0 0 30 30"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="translate-y-[2px]"
      >
        <path d="M15 4.5a2.6 2.6 0 0 1 2.6 2.6c0 1.5-1.2 2.1-2.6 2.9" />
        <path d="M15 10L3.5 17.5c-1 .7-.5 2.5.8 2.5h21.4c1.3 0 1.8-1.8.8-2.5L15 10Z" />
      </svg>
      <span
        style={{ fontFamily: "var(--font-display)", letterSpacing: "0.34em" }}
        className="text-[20px] leading-none uppercase"
      >
        Dressly
      </span>
    </span>
  );
}
