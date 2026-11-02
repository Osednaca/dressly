import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runWithProviderConfig(mock: boolean) {
  const source = `
    const { runwayImageEngine } = await import('./services/runway/index.ts');
    const { tryOnEngine } = await import('./services/youcam/index.ts');
    for (const get of [() => runwayImageEngine({allowFallbackWhenDisabled:true}), () => tryOnEngine({allowFallbackWhenDisabled:true})]) {
      try { get(); process.exitCode = 1; } catch (error) { if (!/mock|disabled|not configured/i.test(error.message)) process.exitCode = 2; }
    }
  `;
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "--import", "./scripts/register.mjs", "--input-type=module", "-e", source], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: "test",
      DRESSLY_STORAGE_BACKEND: "supabase",
      DRESSLY_MOCK_EXTERNAL_APIS: mock ? "true" : "false",
      RUNWAY_ENABLED: "false",
    },
  });
}

test("serverless mode rejects process-local mocks and disabled provider fallback", () => {
  for (const mock of [true, false]) {
    const result = runWithProviderConfig(mock);
    assert.equal(result.status, 0, result.stderr);
  }
});
