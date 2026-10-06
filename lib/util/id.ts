import { randomUUID } from "node:crypto";

/** Short, sortable-ish opaque id. Prefixed so logs and disk files are readable. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** RFC3339 timestamp. Every persisted record uses this exact shape. */
export function nowIso(): string {
  return new Date().toISOString();
}
