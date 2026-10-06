import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Minimal ESM resolver for running the project's TypeScript directly with Node's
 * native type stripping.
 *
 * It exists for exactly two reasons, both of which Node's loader does not do on its
 * own: resolve the `@/` path alias used throughout the source, and resolve the
 * extensionless relative imports that TypeScript allows but ESM does not.
 */
const root = (process.env.DRESSLY_ROOT || process.cwd()).replace(/\\/g, "/").replace(/\/+$/, "");

function existingFile(url) {
  try {
    const filePath = fileURLToPath(url);
    return existsSync(filePath) && statSync(filePath).isFile() ? url : null;
  } catch {
    return null;
  }
}

export async function resolve(specifier, context, nextResolve) {
  const candidates = [];
  if (specifier.startsWith("@/")) {
    const base = `file:///${root.replace(/^\/+/, "")}/${specifier.slice(2)}`;
    candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = new URL(specifier, context.parentURL).href;
    candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`);
  }

  for (const candidate of candidates) {
    const resolved = existingFile(candidate);
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
