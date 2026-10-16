import type { YouCamGarmentCategory } from "@/lib/types";

/**
 * Provider-neutral try-on contract.
 *
 * The orchestrator and the API routes only ever see these types. Whether the pixels
 * come from YouCam or from the development mock is a wiring decision made in one
 * place, and the result carries its own provenance so the UI can never mislabel it.
 */

export interface TryOnRequest {
  /** The body to dress. For chained try-on this is the previous result, not the photo. */
  personImage: Buffer;
  personContentType: string;
  /** The garment reference image. */
  garmentImage: Buffer;
  garmentContentType: string;
  garmentCategory: YouCamGarmentCategory;
  /** Only meaningful for `full_body` / `lower_body`. */
  changeShoes: boolean;
  /** Catalog id, carried through for logging and look bookkeeping. */
  garmentId: string;
  /** Display name, used only by the development mock's caption. */
  garmentName: string;
  /** YouCam S2S v2.0 task endpoint discriminator (`cloth-v4` default, or `bag`). */
  taskKind?: "cloth-v4" | "bag";
  /** Target gender hint used by `/s2s/v2.0/task/bag`. */
  gender?: "female" | "male";
  /** Style preset used by `/s2s/v2.0/task/bag`. */
  bagStyle?: string;
}

export interface TryOnHandle {
  id: string;
  provider: "youcam" | "mock";
  taskKind?: "cloth-v4" | "bag";
}

export type TryOnState =
  | { status: "pending"; provider: TryOnHandle["provider"]; id: string }
  | {
      status: "success";
      provider: TryOnHandle["provider"];
      id: string;
      image: Buffer;
      contentType: string;
    }
  | {
      status: "failed";
      provider: TryOnHandle["provider"];
      id: string;
      message: string;
      retryable: boolean;
    };

export interface TryOnEngine {
  readonly provider: TryOnHandle["provider"];
  submit(request: TryOnRequest): Promise<TryOnHandle>;
  poll(handle: TryOnHandle): Promise<TryOnState>;
}
