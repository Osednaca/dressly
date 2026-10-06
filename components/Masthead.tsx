import { Wordmark } from "@/components/Logo";

/** Site header. Deliberately quiet: the fitting room is the star. */
export function Masthead() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-chrome/10 bg-background/60 px-6 py-4 backdrop-blur-xl md:px-10">
      <Wordmark />
      <p className="overline hidden text-muted sm:block">Your AI personal stylist</p>
    </header>
  );
}
