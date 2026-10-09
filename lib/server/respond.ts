import { NextResponse } from "next/server";

/**
 * Thin helpers so every route returns the same JSON shape and never leaks a stack
 * trace to the browser. Errors are explicit and, where relevant, retryable.
 */
export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** The real cause is logged server-side; the shopper only ever sees a plain message. */
export function serverError(error: unknown): NextResponse {
  console.error("[dressly] request failed:", error);
  return NextResponse.json(
    { error: "Something went wrong on our side. Please try again." },
    { status: 500 },
  );
}
