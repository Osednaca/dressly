"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Sparkle } from "@/components/icons";
import { DresslyGlass } from "@/components/shaders/DresslyGlass";
import type { Suggestion } from "@/lib/api-types";
import type { ChatMessage } from "@/lib/types";
import { toWav } from "@/lib/client/audio";

interface ChatPanelProps {
  messages: ChatMessage[];
  suggestions: Suggestion[];
  busy: boolean;
  onSend: (message: string) => void;
  /** Which engine parsed the latest message, so the panel can show it honestly. */
  understanding?: { provider: "gemini" | "fallback"; model: string; note: string } | null;
  /** Server transcription, used when the browser's own speech recognition can't work. */
  onTranscribe?: (audio: Blob) => Promise<string>;
}

const MAX_RECORDING_MS = 30_000;

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Brave ships webkitSpeechRecognition but has no Google speech backend, so it always fails. */
function isBrave(): boolean {
  return typeof navigator !== "undefined" && "brave" in navigator;
}

/** A minimal speech-recognition surface, typed locally so no DOM lib is required. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
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

function voiceErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it for this site in your browser settings.";
    case "audio-capture":
      return "No microphone was found.";
    case "no-speech":
      return "I didn't catch that — try again.";
    case "network":
      return "Voice input needs a network connection.";
    case "aborted":
      return "";
    default:
      return "Voice input failed. You can type instead.";
  }
}

/**
 * The stylist conversation: natural language in, a decision and a look out.
 *
 * Voice prefers the browser's own Web Speech API. When that is missing or its speech
 * service is unreachable (Brave, Firefox, embedded webviews), the clip is recorded and
 * transcribed server-side by Gemini instead. Either way the result lands in the text
 * box for the shopper to review before sending.
 */
export function ChatPanel({
  messages,
  suggestions,
  busy,
  onSend,
  understanding,
  onTranscribe,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const serverVoice = useRef(false);

  useEffect(() => {
    const browserVoice = getRecognition() !== null;
    const recordable = Boolean(onTranscribe) && canRecord();
    serverVoice.current = recordable && (isBrave() || !browserVoice);
    setVoiceSupported(browserVoice || recordable);
  }, [onTranscribe]);

  useEffect(
    () => () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
      if (recordTimer.current) clearTimeout(recordTimer.current);
      recognitionRef.current?.stop();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const flashVoiceMessage = (message: string) => {
    if (!message) return;
    setVoiceMessage(message);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setVoiceMessage(null), 7000);
  };

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
  };

  const appendTranscript = (transcript: string) =>
    setText((current) => (current ? `${current} ${transcript}` : transcript));

  const startRecording = async () => {
    if (!onTranscribe || !canRecord()) {
      flashVoiceMessage("Voice input isn't supported in this browser. You can type instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      flashVoiceMessage(
        error instanceof DOMException && error.name === "NotFoundError"
          ? "No microphone was found."
          : "Microphone access is blocked. Allow it for this site in your browser settings.",
      );
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (recordTimer.current) clearTimeout(recordTimer.current);
      recorderRef.current = null;
      setListening(false);
      if (chunks.length === 0) return;
      setTranscribing(true);
      try {
        const audio = await toWav(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        const transcript = (await onTranscribe(audio)).trim();
        if (transcript) appendTranscript(transcript);
        else flashVoiceMessage("I didn't catch that — try again.");
      } catch (error) {
        flashVoiceMessage(error instanceof Error ? error.message : "Transcription failed. You can type instead.");
      } finally {
        setTranscribing(false);
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setListening(true);
    setVoiceMessage(null);
    recordTimer.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_RECORDING_MS);
  };

  const toggleVoice = () => {
    if (listening) {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      else recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    if (serverVoice.current) {
      void startRecording();
      return;
    }
    const recognition = getRecognition();
    if (!recognition) {
      setVoiceSupported(false);
      flashVoiceMessage("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    recognitionRef.current = recognition;
    recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage(null);
    };
    recognition.onresult = (event) => appendTranscript(event.results[0][0].transcript);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event?.error === "network" && onTranscribe && canRecord()) {
        serverVoice.current = true;
        void startRecording();
        return;
      }
      flashVoiceMessage(voiceErrorMessage(event?.error));
    };
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      flashVoiceMessage("Voice input could not start. Check microphone permissions.");
    }
  };

  const voiceDisabled = busy || transcribing || voiceSupported === false;

  return (
    <DresslyGlass shaderSheen className="flex min-h-0 flex-col">
      <header className="relative z-10 flex items-center justify-between border-b border-chrome/10 px-5 py-3">
        <p className="overline text-muted">Stylist</p>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {understanding ? (
            <span
              title={understanding.note || `Understood by ${understanding.model}`}
              className={`rounded-full border px-2 py-0.5 ${
                understanding.provider === "gemini"
                  ? "border-sage/50 text-sage"
                  : "border-chrome/20 text-muted"
              }`}
            >
              {understanding.provider === "gemini" ? understanding.model : "keywords"}
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <Sparkle width={13} height={13} /> agentic
          </span>
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

        {listening ? (
          <p className="mb-2 flex items-center gap-2 text-[12px] text-accent-soft">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" /> Listening… speak now
          </p>
        ) : transcribing ? (
          <p className="mb-2 flex items-center gap-2 text-[12px] text-accent-soft">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" /> Transcribing…
          </p>
        ) : voiceMessage ? (
          <p className="mb-2 text-[12px] text-error">{voiceMessage}</p>
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
            disabled={busy}
            placeholder={busy ? "Working on your look…" : "Tell Dressly what you think…"}
            className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[3px] border border-chrome/15 bg-black/25 px-3.5 py-3 text-[14px] text-text-primary outline-none transition placeholder:text-muted focus:border-accent/70 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={toggleVoice}
            disabled={voiceDisabled}
            title={
              voiceSupported === false
                ? "Voice input is not supported in this browser — type instead"
                : "Voice input"
            }
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            className={`flex h-[46px] w-[46px] items-center justify-center rounded-[3px] border transition disabled:opacity-40 ${
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
