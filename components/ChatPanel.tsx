"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Sparkle } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import type { Suggestion } from "@/lib/api-types";
import type { ChatMessage } from "@/lib/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  suggestions: Suggestion[];
  busy: boolean;
  onSend: (message: string) => void;
}

/** A minimal speech-recognition surface, typed locally so no DOM lib is required. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** The stylist conversation: natural language in, a decision and a look out. */
export function ChatPanel({ messages, suggestions, busy, onSend }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
  };

  const toggleVoice = () => {
    const recognition = getRecognition();
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }
    recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText((current) => (current ? `${current} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  return (
    <DresslyGlass shaderSheen className="flex min-h-0 flex-col">
      <header className="relative z-10 flex items-center justify-between border-b border-chrome/10 px-5 py-3">
        <p className="overline text-muted">Stylist</p>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <Sparkle width={13} height={13} /> agentic
        </span>
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
              disabled={busy}
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
            disabled={busy}
            placeholder={busy ? "Working on your look…" : "Tell Dressly what you think…"}
            className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[3px] border border-chrome/15 bg-black/25 px-3.5 py-3 text-[14px] text-text-primary outline-none transition placeholder:text-muted focus:border-accent/70 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={toggleVoice}
            disabled={busy}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            className={`flex h-[46px] w-[46px] items-center justify-center rounded-[3px] border transition disabled:opacity-50 ${
              listening
                ? "border-accent bg-accent/10 text-accent-soft"
                : "border-chrome/15 text-ink-soft hover:border-accent/70"
            }`}
          >
            <Mic width={17} height={17} />
          </button>
          <button
            type="submit"
            disabled={busy || text.trim().length === 0}
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
