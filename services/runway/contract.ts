import type { BagDesignState } from "@/lib/types";

/**
 * Provider-neutral Runway animation (P2) and Live Consultation image generation contract.
 *
 * Runway `gen4_turbo` animates an existing look; Runway `nano_banana_2.1` renders
 * reference-anchored studio product revisions during Live Design Consultations.
 */

export interface RunwayHandle {
  id: string;
  provider: "runway";
}

export interface RunwayRequest {
  image: Buffer;
  imageContentType: string;
  promptText: string;
  durationSeconds?: number;
}

export type RunwayState =
  | { status: "pending"; provider: "runway"; id: string }
  | {
      status: "success";
      provider: "runway";
      id: string;
      video: Buffer;
      contentType: string;
    }
  | {
      status: "failed";
      provider: "runway";
      id: string;
      message: string;
      retryable: boolean;
    };

export interface RunwayReferenceImage {
  image: Buffer;
  contentType: string;
  tag: string; // 3-16 chars, ^[a-zA-Z][a-zA-Z0-9_]{2,15}$
}

export interface RunwayImageRequest {
  promptText: string;
  model?: string; // defaults to env.runwayImageModel ("nano_banana_2.1")
  ratio?: string; // defaults to env.runwayImageRatio ("896:1200")
  thinkingLevel?: "minimal" | "medium" | "high";
  outputCount?: number;
  referenceImages?: RunwayReferenceImage[];
  targetState?: BagDesignState; // used by mock/offline engine to render matching handbag PNG
  versionLabel?: string;
}

export type RunwayImageState =
  | { status: "pending"; progress?: number }
  | { status: "success"; image: Buffer; contentType: string }
  | { status: "failed"; message: string; retryable: boolean };

export interface RunwayImageEngine {
  readonly provider: "runway" | "mock";
  submitImage(request: RunwayImageRequest): Promise<RunwayHandle>;
  pollImage(handle: RunwayHandle): Promise<RunwayImageState>;
}

export interface RunwayEngine extends RunwayImageEngine {
  readonly provider: "runway";
  submit(request: RunwayRequest): Promise<RunwayHandle>;
  poll(handle: RunwayHandle): Promise<RunwayState>;
  submitImage(request: RunwayImageRequest): Promise<RunwayHandle>;
  pollImage(handle: RunwayHandle): Promise<RunwayImageState>;
}
