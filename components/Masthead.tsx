import { Wordmark } from "@/components/Logo";

/** Site header. Deliberately quiet: the fitting room is the star. */
export function Masthead() {
  return (
    <header className="relative z-10 flex items-center justify-between border-b border-line px-6 py-4 md:px-10">
      <Wordmark />
      <p className="overline hidden text-muted sm:block">Your AI personal stylist</p>
    </header>
  );
}
