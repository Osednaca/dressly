import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { UPLOAD_DIR, ensureDirs, readDataFile, writeDataFile } from "@/lib/storage/files";
import { readMediaBytes } from "@/lib/storage/media";
import { createSession, getSession, mutateSession } from "@/lib/session/store";
import { isSupabaseStorage, supabaseRequest } from "@/lib/storage/supabase";
import { GET as getMedia } from "@/app/api/media/[...segments]/route";

const names = ["DRESSLY_STORAGE_BACKEND", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET", "VERCEL"] as const;
function withCloud() {
  const previous = names.map((name) => process.env[name]);
  process.env.DRESSLY_STORAGE_BACKEND = "supabase";
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.SUPABASE_STORAGE_BUCKET = "dressly-private";
  delete process.env.VERCEL;
  return () => { names.forEach((name, i) => { const value = previous[i]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }); };
}

test("cloud media uses private object path and propagates backend errors", async () => {
  const restore = withCloud();
  const originalFetch = globalThis.fetch;
  const objects = new Map<string, Uint8Array>();
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("apikey"), "sb_secret_test");
      assert.equal(headers.has("authorization"), false);
      const isWrite = init?.method === "POST";
      assert.ok(url.pathname.startsWith(isWrite ? "/storage/v1/object/dressly-private/uploads/" : "/storage/v1/object/authenticated/dressly-private/uploads/"));
      const key = url.pathname.replace("/object/authenticated/", "/object/");
      if (isWrite) { objects.set(key, new Uint8Array(init.body as Uint8Array)); return new Response("{}", { status: 200 }); }
      const bytes = objects.get(key);
      return bytes ? new Response(new Uint8Array(bytes)) : new Response("missing", { status: 404 });
    };
    await ensureDirs();
    await writeDataFile(UPLOAD_DIR, "photo.png", Buffer.from("image bytes"));
    assert.equal((await readDataFile(UPLOAD_DIR, "photo.png")).toString(), "image bytes");
    assert.equal((await readMediaBytes("/api/media/uploads/photo.png"))?.bytes.toString(), "image bytes");
    await assert.rejects(readDataFile(UPLOAD_DIR, "missing.png"), /HTTP 404/);
    assert.equal(await readMediaBytes("/api/media/uploads/missing.png"), null);
    const missing = await getMedia(new Request("http://localhost/api/media/uploads/missing.png"), { params: Promise.resolve({ segments: ["uploads", "missing.png"] }) });
    assert.equal(missing.status, 404);
    await assert.rejects(writeDataFile(UPLOAD_DIR, "../outside", "x"), /unsafe file name/);
    globalThis.fetch = async () => new Response("confidential provider detail", { status: 503 });
    await assert.rejects(readMediaBytes("/api/media/uploads/photo.png"), /HTTP 503/);
    await assert.rejects(getSession("ses_failed"), /HTTP 503/);
    const unavailable = await getMedia(new Request("http://localhost/api/media/uploads/photo.png"), { params: Promise.resolve({ segments: ["uploads", "photo.png"] }) });
    assert.equal(unavailable.status, 500);
    assert.ok(!(await unavailable.text()).includes("confidential provider detail"));
    process.env.SUPABASE_SECRET_KEY = "legacy.jwt.key";
    globalThis.fetch = async (_input, init) => { assert.equal(new Headers(init?.headers).get("authorization"), "Bearer legacy.jwt.key"); return new Response("[]"); };
    await supabaseRequest("/rest/v1/dressly_sessions");
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("Vercel must have explicit shared storage and complete server credentials", async () => {
  const restore = withCloud();
  try {
    process.env.VERCEL = "1";
    delete process.env.DRESSLY_STORAGE_BACKEND;
    assert.throws(() => isSupabaseStorage(), /requires DRESSLY_STORAGE_BACKEND/);
    process.env.DRESSLY_STORAGE_BACKEND = "supabase";
    delete process.env.SUPABASE_SECRET_KEY;
    await assert.rejects(supabaseRequest("/rest/v1/dressly_sessions"), /requires SUPABASE_URL and SUPABASE_SECRET_KEY/);
  } finally { restore(); }
});

test("separate server processes observe and safely update the same session", async () => {
  const restore = withCloud();
  const originalFetch = globalThis.fetch;
  let row: { id: string; data: any; revision: number } | null = null;
  let casConflicts = 0;
  let initialReads = 0;
  let releaseReads!: () => void;
  const readBarrier = new Promise<void>((resolve) => { releaseReads = resolve; });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      const data = JSON.parse(body);
      row = { id: data.id, data: data.data, revision: 0 };
      res.end("[]");
    } else if (req.method === "GET") {
      if (initialReads < 2) {
        initialReads += 1;
        if (initialReads === 2) releaseReads();
        await readBarrier;
      }
      res.end(JSON.stringify(row ? [row] : []));
    } else if (req.method === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const revision = Number(url.searchParams.get("revision")?.replace("eq.", ""));
      if (!row || row.revision !== revision) { casConflicts += 1; res.end("[]"); return; }
      const data = JSON.parse(body);
      row = { ...row, data: data.data, revision: data.revision };
      res.end(JSON.stringify([row]));
    } else { res.statusCode = 405; res.end("{}"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const local = `http://127.0.0.1:${address.port}`;
  // Replace only the synthetic Supabase origin with an isolated loopback server.
  globalThis.fetch = (input, init) => originalFetch(local + new URL(String(input)).pathname + new URL(String(input)).search, init);
  try {
    const created = await createSession(null);
    const code = `
      const realFetch = globalThis.fetch;
      globalThis.fetch = (url, init) => { const u = new URL(String(url)); return realFetch(process.env.DRESSLY_TEST_LOCAL + u.pathname + u.search, init); };
      const { mutateSession } = await import('./lib/session/store.ts');
      await mutateSession(process.env.DRESSLY_TEST_SESSION, async s => { await new Promise(r => setTimeout(r, 100)); return { ...s, budget: (s.budget || 0) + 1 }; });
    `;
    function child() {
      return new Promise<void>((resolve, reject) => {
        const proc = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "--import", "./scripts/register.mjs", "--input-type=module", "-e", code], {
          cwd: process.cwd(), env: { ...process.env, DRESSLY_TEST_LOCAL: local, DRESSLY_TEST_SESSION: created.id }, stdio: ["ignore", "ignore", "pipe"],
        });
        let errors = ""; proc.stderr.on("data", (chunk) => { errors += chunk; });
        proc.on("error", reject); proc.on("close", (status) => status === 0 ? resolve() : reject(new Error(errors)));
      });
    }
    await Promise.all([child(), child()]);
    const result = await getSession(created.id);
    assert.equal(result?.budget, (created.budget || 0) + 2);
    assert.ok(casConflicts >= 1, "overlapping writes must retry instead of losing updates");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
