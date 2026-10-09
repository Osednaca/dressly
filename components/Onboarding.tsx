"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, Upload, X } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";

interface OnboardingProps {
  busy: boolean;
  error: string | null;
  onBegin: (input: { file: File | null; occasion: string }) => void;
}

const EXAMPLES = [
  "I have a rooftop dinner tonight. Something elegant but not too formal.",
  "A smart-casual date on Saturday.",
  "A day at the office, polished but comfortable.",
  "A relaxed weekend trip.",
];

/** First contact: one photo and one sentence. That is the entire brief. */
export function Onboarding({ busy, error, onBegin }: OnboardingProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [occasion, setOccasion] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback((next: File | null) => {
    if (!next) return;
    if (!next.type.startsWith("image/")) return;
    setFile(next);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(next);
    });
  }, []);

  return (
    <div className="relative z-10 mx-auto grid max-w-[1500px] gap-12 px-6 py-12 md:grid-cols-[1.05fr_0.95fr] md:px-10 md:py-20 lg:gap-24">
      <section className="animate-rise flex flex-col justify-center">
        <p className="overline mb-6 text-accent-soft">YouCam · Gemini</p>
        <h1 className="text-[clamp(2.8rem,6.4vw,5rem)] leading-[0.96] text-text-primary">
          Don&rsquo;t browse
          <br />
          hundreds of products.
          <br />
          <em className="chrome-text not-italic">Be dressed.</em>
        </h1>
        <p className="mt-8 max-w-md text-[16px] text-text-secondary">
          Tell Dressly where you&rsquo;re going, what you want, or how you want to feel. The AI
          stylist selects the pieces, tries them on your photo, and refines the outfit as you talk.
        </p>
        <dl className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-chrome/12 pt-7">
          {[
            ["35", "curated pieces"],
            ["Real", "virtual try-on"],
            ["Live", "agent decisions"],
          ].map(([value, label]) => (
            <div key={label}>
              <dt style={{ fontFamily: "var(--font-display)" }} className="text-3xl text-text-primary">
                {value}
              </dt>
              <dd className="overline mt-1 text-muted">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="animate-rise" style={{ animationDelay: "120ms" }}>
        <DresslyGlass tone="strong" className="p-6 shadow-[0_60px_140px_-70px_rgba(0,0,0,0.95)] md:p-8">
          <p className="overline text-muted">Step one</p>
          <h2 className="mt-2 text-2xl text-text-primary">Your full-body photo</h2>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files[0] ?? null);
            }}
            className="mt-5"
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => accept(event.target.files?.[0] ?? null)}
            />
            {preview ? (
              <div className="relative overflow-hidden rounded-[4px] border border-chrome/15 bg-night">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Your photo" className="h-[320px] w-full object-contain" />
                <button
                  type="button"
                  onClick={() => {
                    accept(null);
                    setFile(null);
                    setPreview(null);
                  }}
                  className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white backdrop-blur transition hover:bg-black/80"
                  aria-label="Remove photo"
                >
                  <X width={16} height={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={`group relative flex h-[320px] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-[4px] border border-dashed text-center transition duration-300 ${
                  dragging
                    ? "border-accent bg-accent/10"
                    : "border-chrome/25 bg-white/[0.02] hover:border-accent/70 hover:bg-accent/[0.06]"
                }`}
              >
                <span className="pointer-events-none absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100">
                  <span className="absolute -inset-16 bg-[radial-gradient(40%_40%_at_50%_40%,rgba(200,132,90,0.22),transparent_70%)]" />
                </span>
                <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-chrome/25 text-accent-soft transition group-hover:border-accent/70">
                  <Upload width={20} height={20} />
                </span>
                <span className="relative text-sm text-text-secondary">
                  Drop a full-body photo, or click to choose
                </span>
                <span className="overline relative text-muted">JPG · PNG · up to 12MB</span>
              </button>
            )}
          </div>

          <p className="overline mt-7 text-muted">Step two</p>
          <h2 className="mt-2 text-2xl text-text-primary">What are you dressing for?</h2>
          <label htmlFor="occasion" className="sr-only">
            What are you dressing for
          </label>
          <textarea
            id="occasion"
            value={occasion}
            onChange={(event) => setOccasion(event.target.value)}
            rows={3}
            placeholder="Rooftop dinner tonight — elegant, but not too formal."
            className="mt-4 w-full resize-none rounded-[3px] border border-chrome/15 bg-black/25 p-3.5 text-[15px] text-text-primary outline-none transition placeholder:text-muted focus:border-accent/70"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setOccasion(example)}
                className="rounded-full border border-chrome/15 px-3 py-1.5 text-[12px] text-text-secondary transition hover:border-accent/70 hover:text-accent-soft"
              >
                {example.length > 42 ? `${example.slice(0, 40)}…` : example}
              </button>
            ))}
          </div>

          {error ? <p className="mt-4 text-sm text-error">{error}</p> : null}

          <button
            type="button"
            disabled={busy || !file || occasion.trim().length === 0}
            onClick={() => onBegin({ file, occasion: occasion.trim() })}
            className="sheen mt-7 flex w-full items-center justify-center gap-2 rounded-[3px] border border-chrome/20 bg-ink px-6 py-4 text-[13px] font-semibold uppercase tracking-[0.18em] text-paper transition duration-300 hover:bg-accent hover:text-night disabled:border-chrome/10 disabled:bg-white/[0.04] disabled:text-muted"
          >
            {busy ? "Preparing your fitting room…" : "Begin styling"}
            {!busy ? <Camera width={17} height={17} /> : null}
          </button>
          <p className="mt-3 text-center text-[11px] text-muted">
            Your photo is used only for virtual try-on. It is never sent to the language model.
          </p>
        </DresslyGlass>
      </section>
    </div>
  );
}
