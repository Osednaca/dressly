import type { StylingSession } from "@/lib/types";
import { SESSION_DIR, readJsonFile, writeJsonFile } from "@/lib/storage/files";
import { newId } from "@/lib/util/id";
import { createSessionRecord } from "@/lib/session/reducer";

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

export async function createSession(userPhotoPath: string | null): Promise<StylingSession> {
  const session = createSessionRecord(newId("ses"), userPhotoPath);
  memory.set(session.id, session);
  await persist(session);
  return session;
}

export async function getSession(id: string): Promise<StylingSession | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  const fromDisk = await readJsonFile<StylingSession>(SESSION_DIR, sessionFile(id));
  if (fromDisk) memory.set(id, fromDisk);
  return fromDisk;
}

export async function persist(session: StylingSession): Promise<void> {
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
  return [...memory.keys()];
}
