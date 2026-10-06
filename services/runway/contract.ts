/**
 * Provider-neutral animation contract (P2).
 *
 * Runway is strictly optional and never critical: it can only ever add motion to a
 * look that already exists, and its failure can never affect the completed outfit.
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

export interface RunwayEngine {
  readonly provider: "runway";
  submit(request: RunwayRequest): Promise<RunwayHandle>;
  poll(handle: RunwayHandle): Promise<RunwayState>;
}
