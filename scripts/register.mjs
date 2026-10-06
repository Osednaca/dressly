import { register } from "node:module";

/**
 * Registers the project's `@/` alias + extensionless-import resolver so scripts and
 * tests can load the TypeScript source directly under Node's native type stripping.
 */
register(new URL("./loader.mjs", import.meta.url));
