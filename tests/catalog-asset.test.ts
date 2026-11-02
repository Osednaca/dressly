import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "@/next.config";
import { readPublicAsset } from "@/lib/agent/consultation-runway";

test("catalog seed is readable by the provider and traced into API functions", async () => {
  const asset = await readPublicAsset("/catalog/consultation-bag-v1.png");
  assert.equal(asset.contentType, "image/png");
  assert.ok(asset.bytes.length > 1000);
  assert.deepEqual(nextConfig.outputFileTracingIncludes?.["/api/**/*"], ["./public/catalog/**/*"]);
});

test("consultation references cannot escape the catalog to read server files", async () => {
  for (const candidate of ["/catalog/../../.env", "/catalog/..%2f..%2f.env", "/catalog/../secret.png", "/etc/passwd"]) {
    await assert.rejects(readPublicAsset(candidate), /Invalid catalog image path/);
  }
});
