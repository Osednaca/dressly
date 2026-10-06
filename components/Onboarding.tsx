"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, Upload, X } from "@/components/icons";

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
    <div className="relative z-10 mx-auto grid max-w-[1500px] gap-10 px-6 py-10 md:grid-cols-[1.05fr_0.95fr] md:px-10 md:py-16 lg:gap-20">
      <section className="animate-rise flex flex-col justify-center">
        <p className="overline mb-5 text-accent">YouCam · JEV · Gemini</p>
        <h1 className="text-[clamp(2.6rem,6vw,4.6rem)] leading-[0.98]">
          Don&rsquo;t browse
          <br />
          hundreds of products.
          <br />
          <em className="text-accent">Be dressed.</em>
        </h1>
        <p className="mt-7 max-w-md text-[16px] text-ink-soft">
          Tell Dressly where you&rsquo;re going, what you want, or how you want to feel. The AI
          stylist selects the pieces, tries them on your photo, and refines the outfit as you talk.
        </p>
        <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
          {[
            ["35", "curated pieces"],
            ["Real", "virtual try-on"],
            ["Live", "agent decisions"],
          ].map(([value, label]) => (
            <div key={label}>
              <dt style={{ fontFamily: "var(--font-display)" }} className="text-3xl">
                {value}
              </dt>
              <dd className="overline mt-1 text-muted">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="animate-rise" style={{ animationDelay: "120ms" }}>
        <div className="rounded-[3px] border border-line bg-card p-6 shadow-[0_30px_60px_-40px_rgba(24,21,16,0.5)] md:p-8">
          <p className="overline text-muted">Step one</p>
          <h2 className="mt-2 text-2xl">Your full-body photo</h2>

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
              <div className="relative overflow-hidden rounded-[2px] border border-line bg-night">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Your photo" className="h-[320px] w-full object-contain" />
                <button
                  type="button"
                  onClick={() => {
                    accept(null);
                    setFile(null);
                    setPreview(null);
                  }}
                  className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white backdrop-blur"
                  aria-label="Remove photo"
                >
                  <X width={16} height={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className={`flex h-[320px] w-full flex-col items-center justify-center gap-3 rounded-[2px] border border-dashed text-center transition ${
                  dragging ? "border-accent bg-accent/5" : "border-line-strong bg-paper/40 hover:border-accent"
                }`}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line-strong text-accent">
                  <Upload width={20} height={20} />
                </span>
                <span className="text-sm text-ink-soft">
                  Drop a full-body photo, or click to choose
                </span>
                <span className="overline text-muted">JPG · PNG · up to 12MB</span>
              </button>
            )}
          </div>

          <p className="overline mt-6 text-muted">Step two</p>
          <h2 className="mt-2 text-2xl">What are you dressing for?</h2>
          <label htmlFor="occasion" className="sr-only">
            What are you dressing for
          </label>
          <textarea
            id="occasion"
            value={occasion}
            onChange={(event) => setOccasion(event.target.value)}
            rows={3}
            placeholder="Rooftop dinner tonight — elegant, but not too formal."
            className="mt-4 w-full resize-none rounded-[2px] border border-line bg-paper/50 p-3.5 text-[15px] outline-none transition focus:border-accent"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setOccasion(example)}
                className="rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-accent hover:text-accent"
              >
                {example.length > 42 ? `${example.slice(0, 40)}…` : example}
              </button>
            ))}
          </div>

          {error ? <p className="mt-4 text-sm text-accent">{error}</p> : null}

          <button
            type="button"
            disabled={busy || !file || occasion.trim().length === 0}
            onClick={() => onBegin({ file, occasion: occasion.trim() })}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-[2px] bg-ink px-6 py-3.5 text-[13px] font-semibold uppercase tracking-[0.18em] text-paper transition hover:bg-accent disabled:bg-line-strong disabled:text-paper"
          >
            {busy ? "Preparing your fitting room…" : "Begin styling"}
            {!busy ? <Camera width={17} height={17} /> : null}
          </button>
          <p className="mt-3 text-center text-[11px] text-muted">
            Your photo is used only for virtual try-on. It is never sent to the language model.
          </p>
        </div>
      </section>
    </div>
  );
}
