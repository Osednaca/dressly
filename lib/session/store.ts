import type { StylingSession } from "@/lib/types";
import { SESSION_DIR, readJsonFile, writeJsonFile } from "@/lib/storage/files";
import { newId } from "@/lib/util/id";
import { createSessionRecord } from "@/lib/session/reducer";
import { isSupabaseStorage, supabaseRequest } from "@/lib/storage/supabase";
import { assertSafeName } from "@/lib/storage/files";

/**
 * Server-owned session state.
 *
 * The browser is a thin view: it holds a session id and nothing authoritative.
 * State lives in memory for speed and is mirrored to disk so a dev-server reload
 * during a demo does not destroy the session.
 *
 * A single process is assumed — this is a hackathon app, not a distributed system,
 * and pretending otherwise would add failure modes without adding value.
 */
const memory = new Map<string, StylingSession>();

/** Serializes writes per session so two in-flight turns cannot interleave. */
const locks = new Map<string, Promise<unknown>>();

function sessionFile(id: string): string {
  return `${id}.json`;
}

interface SessionRow { id: string; data: StylingSession; revision: number }
const SESSION_TABLE = "/rest/v1/dressly_sessions";

async function cloudSession(id: string): Promise<SessionRow | null> {
  const safe = assertSafeName(id);
  const response = await supabaseRequest(`${SESSION_TABLE}?id=eq.${encodeURIComponent(safe)}&select=id,data,revision`);
  const rows = await response.json() as SessionRow[];
  return rows[0] ?? null;
}

export async function createSession(userPhotoPath: string | null): Promise<StylingSession> {
  const session = createSessionRecord(newId("ses"), userPhotoPath);
  await persist(session);
  return session;
}

export async function getSession(id: string): Promise<StylingSession | null> {
  if (isSupabaseStorage()) return (await cloudSession(id))?.data ?? null;
  const cached = memory.get(id);
  if (cached) return cached;
  const fromDisk = await readJsonFile<StylingSession>(SESSION_DIR, sessionFile(id));
  if (fromDisk) memory.set(id, fromDisk);
  return fromDisk;
}

export async function persist(session: StylingSession): Promise<void> {
  if (isSupabaseStorage()) {
    // Persist is used for creation; subsequent writes must use mutateSession so
    // they cannot overwrite a concurrent revision without a compare-and-swap.
    await supabaseRequest(SESSION_TABLE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assertSafeName(session.id), data: session }),
    });
    return;
  }
  memory.set(session.id, session);
  await writeJsonFile(SESSION_DIR, sessionFile(session.id), session);
}

/**
 * Read-modify-write under a per-session lock. Every mutation goes through here so
 * a slow YouCam poll can never clobber a concurrent chat turn.
 */
export async function mutateSession(
  id: string,
  mutator: (session: StylingSession) => StylingSession | Promise<StylingSession>,
): Promise<StylingSession | null> {
  if (isSupabaseStorage()) {
    // The callback may be retried after a concurrent write. It must not perform
    // external side effects; each attempt computes its result from a fresh row.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const row = await cloudSession(id);
      if (!row) return null;
      const next = await mutator(row.data);
      const safe = assertSafeName(id);
      const response = await supabaseRequest(`${SESSION_TABLE}?id=eq.${encodeURIComponent(safe)}&revision=eq.${row.revision}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ data: next, revision: row.revision + 1 }),
      });
      const updated = await response.json() as SessionRow[];
      if (updated.length) return updated[0]!.data;
    }
    throw new Error("Session update conflict: retry limit exceeded");
  }
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await getSession(id);
      if (!current) return null;
      const next = await mutator(current);
      await persist(next);
      return next;
    });

  // The chain must never reject, or the next turn would inherit the failure.
  const guarded = run.catch(() => undefined);
  locks.set(id, guarded);

  try {
    return await run;
  } finally {
    if (locks.get(id) === guarded) locks.delete(id);
  }
}

export async function listSessions(): Promise<string[]> {
  if (isSupabaseStorage()) {
    const response = await supabaseRequest(`${SESSION_TABLE}?select=id`);
    const rows = await response.json() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
  return [...memory.keys()];
}
