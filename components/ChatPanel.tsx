"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Sparkle } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import type { Suggestion } from "@/lib/api-types";
import type { LiveCaptions } from "@/lib/client/use-live-stylist";
import type { LiveStatus } from "@/lib/client/live";
import type { ChatMessage } from "@/lib/types";

interface LiveControls {
  status: LiveStatus;
  error: string | null;
  captions: LiveCaptions;
  active: boolean;
  onToggle: () => void;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  suggestions: Suggestion[];
  busy: boolean;
  onSend: (message: string) => void;
  /** The Gemini Live voice session. */
  live: LiveControls;
}

/**
 * The stylist conversation: natural language in, a decision and a look out.
 *
 * The mic opens a live spoken conversation with the stylist (Gemini Live). The stylist
 * answers by voice and drives the same styling turn — and therefore the same try-on —
 * as typing does. Typed messages during a live session go to the live stylist.
 */
export function ChatPanel({ messages, suggestions, busy, onSend, live }: ChatPanelProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const inputLocked = busy && !live.active;

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || inputLocked) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <DresslyGlass shaderSheen className="flex min-h-0 flex-col">
      <header className="relative z-10 flex items-center justify-between border-b border-chrome/10 px-5 py-3">
        <p className="overline text-muted">Stylist</p>
        <Sparkle width={13} height={13} className="text-muted" />
      </header>

      <div ref={listRef} className="thin-scroll flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <p className="text-sm text-muted">
            Describe the occasion and Dressly will choose the first piece.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`animate-fade flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[85%] rounded-[3px] px-3.5 py-2.5 text-[14px] leading-snug ${
                  message.role === "user"
                    ? "bg-ink text-paper"
                    : "border border-chrome/12 bg-white/[0.04] text-text-primary"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
            Dressly is working…
          </div>
        ) : null}
      </div>

      <div className="border-t border-chrome/10 px-4 pb-4 pt-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.message}
              type="button"
              disabled={inputLocked}
              onClick={() => submit(suggestion.message)}
              className={`rounded-full border px-3 py-1.5 text-[12px] transition disabled:opacity-50 ${
                suggestion.primary
                  ? "border-accent/60 bg-accent/5 text-accent hover:bg-accent/10"
                  : "border-line text-ink-soft hover:border-accent hover:text-accent"
              }`}
            >
              {suggestion.label}
            </button>
          ))}
        </div>

        {live.status === "connecting" ? (
          <p className="mb-2 flex items-center gap-2 text-[12px] text-accent-soft">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" /> Connecting to your
            stylist…
          </p>
        ) : live.status === "live" ? (
          <div className="mb-2 space-y-1 rounded-[3px] border border-accent/30 bg-accent/5 px-3 py-2 text-[12px]">
            <p className="flex items-center gap-2 text-accent-soft">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" /> Live — just talk.
              Tap the mic to end.
            </p>
            {live.captions.user ? (
              <p className="text-text-secondary">
                <span className="text-muted">You: </span>
                {live.captions.user}
              </p>
            ) : null}
            {live.captions.dressly ? (
              <p className="text-text-primary">
                <span className="text-muted">Dressly: </span>
                {live.captions.dressly}
              </p>
            ) : null}
          </div>
        ) : live.error ? (
          <p className="mb-2 text-[12px] text-error">{live.error}</p>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(text);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(text);
              }
            }}
            rows={1}
            disabled={inputLocked}
            placeholder={inputLocked ? "Working on your look…" : "Tell Dressly what you think…"}
            className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[3px] border border-chrome/15 bg-black/25 px-3.5 py-3 text-[14px] text-text-primary outline-none transition placeholder:text-muted focus:border-accent/70 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={live.onToggle}
            title={live.active ? "End the live conversation" : "Talk live with your stylist"}
            aria-label={live.active ? "End live conversation" : "Start live conversation"}
            aria-pressed={live.active}
            className={`flex h-[46px] w-[46px] items-center justify-center rounded-[3px] border transition ${
              live.active
                ? "border-accent bg-accent/15 text-accent-soft"
                : "border-chrome/15 text-ink-soft hover:border-accent/70"
            }`}
          >
            <Mic width={17} height={17} />
          </button>
          <button
            type="submit"
            disabled={inputLocked || text.trim().length === 0}
            aria-label="Send message"
            className="sheen flex h-[46px] w-[46px] items-center justify-center rounded-[3px] border border-chrome/20 bg-ink text-paper transition hover:bg-accent hover:text-night disabled:border-chrome/10 disabled:bg-white/[0.04] disabled:text-muted"
          >
            <Send width={17} height={17} />
          </button>
        </form>
      </div>
    </DresslyGlass>
  );
}
