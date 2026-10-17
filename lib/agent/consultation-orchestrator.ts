import sharp from "sharp";
import {
  clearConsultationDebounce,
  computeChangeFingerprint,
  enqueueConsultationUtterance,
  isDuplicateProposal,
  isDuplicateTranscript,
  pruneRedundantChanges,
} from "@/lib/agent/consultation-aggregator";
import {
  pollConsultationDesign,
  startConsultationDesign,
} from "@/lib/agent/consultation-runway";
import { startConsultationTryOn } from "@/lib/agent/consultation-tryon";
import type {
  ConsultationResponse,
  IngestTranscriptRequest,
  StartConsultationRequest,
  SuggestionActionRequest,
  SuggestionActionResponse,
  TranscriptTurnResponse,
  UpdateConsultationRequest,
} from "@/lib/api-types";
import { env } from "@/lib/env";
import { publishConsultationEvent } from "@/lib/server/consultation-events";
import { logConsultationMilestone } from "@/lib/server/consultation-logger";
import {
  actOnProposedSuggestion,
  addProposedSuggestion,
  appendConsultationActivity,
  appendTranscriptSegment,
  endConsultation,
  initConsultation,
  recordDecision,
  restoreDesignVersion,
  setConsultationBotStatus,
  setConsultationStatus,
  updateConsultationSettings,
} from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import { UPLOAD_DIR, writeDataFile } from "@/lib/storage/files";
import { mediaUrl } from "@/lib/storage/media";
import type {
  BagDesignState,
  DecisionRecord,
  DesignFieldDiff,
  ProposedDesignChange,
  StylingSession,
  TranscriptSegment,
} from "@/lib/types";
import { newId, nowIso } from "@/lib/util/id";
import { understandConsultationUtterance } from "@/services/gemini/consultation";
import { buildConsultationJevSignals, decideConsultation } from "@/services/jev";
import { meetingBotClient } from "@/services/meeting-bot/client";
import { DEFAULT_BOT_DISPLAY_NAME } from "@/services/meeting-bot/contract";
import { runwayImageEngine } from "@/services/runway";

export const DEMO_CUSTOMER_PORTRAIT_FILE = "demo_customer_portrait.png";

export function renderDemoCustomerPortraitSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f5f0e8"/>
      <stop offset="65%" stop-color="#ebe3d5"/>
      <stop offset="100%" stop-color="#dfd4c2"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="32%" r="48%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#ebe3d5" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="coat" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#221e1b"/>
      <stop offset="100%" stop-color="#141210"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#bg)"/>
  <rect width="900" height="1200" fill="url(#halo)"/>
  <!-- Studio floor line -->
  <line x1="120" y1="1080" x2="780" y2="1080" stroke="#c8bca8" stroke-width="1.5"/>
  <!-- Editorial mannequin / silhouette portrait -->
  <ellipse cx="450" cy="245" rx="68" ry="84" fill="#d6b99b"/>
  <rect x="424" y="315" width="52" height="54" rx="18" fill="#cfaea0"/>
  <!-- Tailored dark atelier coat & shoulders -->
  <path d="M275 430 C295 372 365 352 450 352 C535 352 605 372 625 430 L665 820 L235 820 Z" fill="url(#coat)"/>
  <!-- Silk ivory lapel / blouse -->
  <path d="M405 352 L450 485 L495 352 Z" fill="#f3ede2"/>
  <!-- Tailored trousers / skirt column -->
  <rect x="315" y="810" width="270" height="270" rx="8" fill="#1b1816"/>
  <!-- Arms positioned naturally for shoulder / crossbody handbag framing -->
  <path d="M278 430 C235 520 228 650 250 760 L296 755 C284 655 290 545 316 462 Z" fill="#1d1917"/>
  <path d="M622 430 C665 520 672 650 650 760 L604 755 C616 655 610 545 584 462 Z" fill="#1d1917"/>
</svg>`;
}

/**
 * Writes a clean 900x1200 editorial studio silhouette/portrait PNG to `UPLOAD_DIR`
 * (`demo_customer_portrait.png`) and optionally attaches it to the session when
 * `session.userPhotoPath` is null so YouCam VTO can run in demo/diagnostic mode
 * without failing on `PHOTO_REQUIRED`.
 */
export async function ensureDemoCustomerPhoto(sessionId?: string): Promise<string> {
  const svg = renderDemoCustomerPortraitSvg();
  const pngBuffer = await sharp(Buffer.from(svg, "utf8"), { density: 144 })
    .resize(900, 1200, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeDataFile(UPLOAD_DIR, DEMO_CUSTOMER_PORTRAIT_FILE, pngBuffer);
  const photoUrl = mediaUrl("uploads", DEMO_CUSTOMER_PORTRAIT_FILE);

  if (sessionId) {
    await mutateSession(sessionId, (session) => {
      if (session.userPhotoPath) return session;
      return {
        ...session,
        userPhotoPath: photoUrl,
      };
    });
  }

  return photoUrl;
}

function buildBotCallbackUrl(sessionId: string): string {
  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000").replace(
    /\/+$/,
    "",
  );
  return `${appBase}/api/sessions/${encodeURIComponent(sessionId)}/consultation/bot-event`;
}

export async function startSessionConsultation(
  sessionId: string,
  req: StartConsultationRequest,
): Promise<ConsultationResponse | null> {
  if (env.consultationDemoMode) {
    await ensureDemoCustomerPhoto(sessionId);
  }

  const initialized = await mutateSession(sessionId, (session) =>
    initConsultation(session, {
      meetingUrl: req.meetingUrl,
      consentConfirmed: req.consentConfirmed,
      initialDesignState: req.initialDesignState,
      initialImageUrl: req.initialImageUrl,
      autoApply: req.autoApply ?? false,
      autoApplyThreshold: env.consultationAutoApplyThreshold,
      autoTryOn: req.autoTryOn ?? false,
    }),
  );

  if (!initialized || !initialized.consultation) return null;

  logConsultationMilestone("consultation started", {
    sessionId,
    consultationId: initialized.consultation.id,
    meetingUrl: initialized.consultation.meetingUrl,
    demoMode: env.consultationDemoMode,
  });

  const botOutcome = await meetingBotClient.startSession({
    consultationSessionId: sessionId,
    meetingUrl: req.meetingUrl,
    botDisplayName: DEFAULT_BOT_DISPLAY_NAME,
    callbackUrl: buildBotCallbackUrl(sessionId),
  });

  logConsultationMilestone("bot launched", {
    sessionId,
    workerConnected: botOutcome.workerConnected,
    botStatus: botOutcome.status,
    botDisplayName: DEFAULT_BOT_DISPLAY_NAME,
  });

  const activityText = botOutcome.workerConnected
    ? botOutcome.message
    : "Dressly AI Assistant listening to consultation";

  const updated = await mutateSession(sessionId, (session) =>
    setConsultationBotStatus(session, botOutcome.status, {
      error: botOutcome.status === "FAILED" ? botOutcome.message : null,
      activityText,
    }),
  );

  if (!updated || !updated.consultation) return null;

  publishConsultationEvent(sessionId, {
    type: "bot.status",
    status: updated.consultation.botStatus,
    consultationStatus: updated.consultation.status,
    message: activityText,
    timestamp: nowIso(),
    session: updated,
  });

  return {
    session: updated,
    bot: {
      status: updated.consultation.botStatus,
      workerConnected: botOutcome.workerConnected,
      message: botOutcome.message,
    },
  };
}

export async function patchSessionConsultation(
  sessionId: string,
  req: UpdateConsultationRequest,
): Promise<StylingSession | null> {
  const updated = await mutateSession(sessionId, (session) =>
    updateConsultationSettings(session, req),
  );
  if (!updated) return null;

  publishConsultationEvent(sessionId, {
    type: "consultation.updated",
    session: updated,
  });
  return updated;
}

export async function endSessionConsultation(
  sessionId: string,
): Promise<StylingSession | null> {
  clearConsultationDebounce(sessionId);
  await meetingBotClient.stopSession(sessionId);
  const updated = await mutateSession(sessionId, (session) => endConsultation(session));
  if (!updated) return null;

  logConsultationMilestone("consultation ended", {
    sessionId,
    versionsCreated: updated.consultation?.versions.length ?? 0,
  });

  publishConsultationEvent(sessionId, {
    type: "consultation.ended",
    session: updated,
  });
  return updated;
}

export async function reconnectSessionConsultation(
  sessionId: string,
): Promise<StylingSession | null> {
  const existing = await getSession(sessionId);
  if (!existing || !existing.consultation) return null;

  const botOutcome = await meetingBotClient.reconnectSession(sessionId);
  logConsultationMilestone("bot launched", {
    sessionId,
    reconnected: true,
    workerConnected: botOutcome.workerConnected,
    botStatus: botOutcome.status,
  });

  const updated = await mutateSession(sessionId, (session) => {
    if (!session.consultation) return session;
    const base =
      session.consultation.status === "ENDED" || session.consultation.status === "FAILED"
        ? {
            ...session,
            consultation: {
              ...session.consultation,
              status: "RECONNECTING" as const,
              endedAt: undefined,
            },
          }
        : session;
    return setConsultationBotStatus(base, botOutcome.status, {
      error: botOutcome.status === "FAILED" ? botOutcome.message : null,
      activityText: botOutcome.message,
    });
  });
  if (!updated || !updated.consultation) return null;

  publishConsultationEvent(sessionId, {
    type: "bot.status",
    status: updated.consultation.botStatus,
    consultationStatus: updated.consultation.status,
    message: botOutcome.message,
    timestamp: nowIso(),
    session: updated,
  });

  return updated;
}

async function processFinalUtteranceImmediate(
  sessionId: string,
  req: IngestTranscriptRequest,
): Promise<TranscriptTurnResponse | null> {
  const initialSession = await getSession(sessionId);
  if (!initialSession || !initialSession.consultation) return null;

  const text = req.text.trim();
  if (!text) {
    return {
      session: initialSession,
      duplicated: true,
      extraction: null,
      decision: null,
      suggestion: null,
      autoJob: null,
      blocked: null,
    };
  }

  if (isDuplicateTranscript(text, initialSession.consultation.transcript)) {
    return {
      session: initialSession,
      duplicated: true,
      extraction: null,
      decision: null,
      suggestion: null,
      autoJob: null,
      blocked: null,
    };
  }

  let appendedSegment: TranscriptSegment | null = null;
  const afterTranscriptSession = await mutateSession(sessionId, (session) => {
    const next = appendTranscriptSegment(session, {
      id: req.id,
      text,
      isFinal: true,
      timestamp: req.timestamp,
    });
    const tr = next.consultation?.transcript ?? [];
    appendedSegment = tr[tr.length - 1] ?? null;
    return next;
  });

  if (!afterTranscriptSession || !afterTranscriptSession.consultation) return null;

  if (appendedSegment) {
    publishConsultationEvent(sessionId, {
      type: "transcript.final",
      segment: appendedSegment,
      session: afterTranscriptSession,
    });
  }

  const consultation = afterTranscriptSession.consultation;
  const understanding = await understandConsultationUtterance(
    text,
    consultation.designState,
    consultation.versions,
  );
  const extraction = understanding.extraction;
  const diffs = pruneRedundantChanges(extraction.changes, consultation.designState);

  const jevPrep = buildConsultationJevSignals(extraction, diffs, consultation, {
    utterance: text,
    hasUserPhoto: Boolean(afterTranscriptSession.userPhotoPath),
  });
  const jevOutcome = await decideConsultation(jevPrep.request, jevPrep.signals);
  const action = jevOutcome.result.decision;

  let createdDecision: DecisionRecord | null = null;
  let createdSuggestion: ProposedDesignChange | null = null;
  let duplicateProposal = false;

  const afterDecisionSession = await mutateSession(sessionId, (session) => {
    if (!session.consultation) return session;
    let next = session;

    const decision: DecisionRecord = {
      id: newId("dec"),
      createdAt: nowIso(),
      iteration: next.decisions.length + 1,
      styleDistribution: [
        { label: "minimal", probability: 0.56 },
        { label: "evening", probability: 0.44 },
      ],
      consultationAction: {
        decision: action,
        confidence: jevOutcome.result.confidence,
        distribution: jevOutcome.result.distribution,
      },
      productEvaluation:
        diffs.length > 0
          ? diffs.map((d) => ({
              label: `${d.label}: ${d.proposedValue}`,
              probability: jevOutcome.result.confidence,
            }))
          : [{ label: action, probability: jevOutcome.result.confidence }],
      reason: jevOutcome.result.reason,
      provider: jevOutcome.provider,
      model: jevOutcome.result.model,
    };

    createdDecision = decision;
    next = recordDecision(next, decision);

    if (extraction.isRelevantFashionSpeech) {
      next = appendConsultationActivity(
        next,
        "speech",
        `Client/meeting utterance: "${text}"`,
      );
    }

    switch (action) {
      case "IGNORE":
        return next;

      case "ASK_CLARIFICATION": {
        const question =
          extraction.clarificationQuestion ??
          "Which detail would you like to adjust next — color, hardware, size, or strap?";
        return appendConsultationActivity(
          next,
          "speech",
          `Dressly requested clarification: ${question}`,
        );
      }

      case "RETURN_TO_PREVIOUS_VERSION": {
        const versions = next.consultation!.versions;
        const targetVer = extraction.targetVersionNumber
          ? versions.find((v) => v.version === extraction.targetVersionNumber)
          : versions.length >= 2
            ? versions[versions.length - 2]
            : versions[0];
        if (targetVer) {
          return restoreDesignVersion(next, targetVer.id);
        }
        return next;
      }

      case "FINALIZE_DESIGN": {
        const currentVer = next.consultation!.versions.find(
          (v) => v.id === next.consultation!.currentDesignVersionId,
        );
        const verNum = currentVer?.version ?? next.consultation!.versions.length;
        return appendConsultationActivity(
          next,
          "session",
          `Design finalized at V${verNum}`,
        );
      }

      case "TRY_ON_CURRENT_DESIGN": {
        const currentVer = next.consultation!.versions.find(
          (v) => v.id === next.consultation!.currentDesignVersionId,
        );
        const verNum = currentVer?.version ?? next.consultation!.versions.length;
        return appendConsultationActivity(
          next,
          "tryon",
          `Customer requested virtual try-on for V${verNum}`,
        );
      }

      case "PROPOSE_CHANGE": {
        const currentDiffs = pruneRedundantChanges(
          extraction.changes,
          next.consultation!.designState,
        );
        if (currentDiffs.length === 0) {
          duplicateProposal = true;
          return next;
        }
        const fingerprint = computeChangeFingerprint(currentDiffs);
        if (isDuplicateProposal(fingerprint, next.consultation!)) {
          duplicateProposal = true;
          return next;
        }

        const suggestionId = newId("sug");
        next = addProposedSuggestion(next, {
          id: suggestionId,
          transcriptExcerpt: text,
          confidence: extraction.confidence,
          jevAction: "PROPOSE_CHANGE",
          jevReason: jevOutcome.result.reason,
          provider: jevOutcome.provider,
          changes: currentDiffs,
          fingerprint,
        });
        createdSuggestion =
          next.consultation?.pendingSuggestions.find((s) => s.id === suggestionId) ??
          null;
        return next;
      }
    }
  });

  if (!afterDecisionSession || !afterDecisionSession.consultation) return null;

  if (createdSuggestion && createdDecision) {
    const detected: ProposedDesignChange = createdSuggestion;
    logConsultationMilestone("suggestion detected", {
      sessionId,
      suggestionId: detected.id,
      confidence: detected.confidence,
      jevAction: detected.jevAction,
      fields: detected.changes.map((c) => c.field),
    });
    publishConsultationEvent(sessionId, {
      type: "suggestion.created",
      suggestion: detected,
      decision: createdDecision,
      session: afterDecisionSession,
    });

    const con = afterDecisionSession.consultation;
    const suggestionToAutoApply: ProposedDesignChange = createdSuggestion;
    if (con.autoApply && extraction.confidence >= con.autoApplyThreshold) {
      const autoApplied = await handleSuggestionAction(sessionId, suggestionToAutoApply.id, {
        action: "apply",
      });
      if (autoApplied) {
        return {
          session: autoApplied.session,
          duplicated: false,
          extraction,
          decision: createdDecision,
          suggestion: autoApplied.suggestion ?? suggestionToAutoApply,
          autoJob: autoApplied.job,
          blocked: autoApplied.blocked,
        };
      }
    }
  } else if (action === "TRY_ON_CURRENT_DESIGN") {
    const tryOnRes = await startConsultationTryOn(afterDecisionSession);
    return {
      session: tryOnRes.session,
      duplicated: false,
      extraction,
      decision: createdDecision,
      suggestion: null,
      autoJob: tryOnRes.job,
      blocked: tryOnRes.blocked,
    };
  } else if (action !== "IGNORE") {
    publishConsultationEvent(sessionId, {
      type: "consultation.updated",
      session: afterDecisionSession,
    });
  }

  return {
    session: afterDecisionSession,
    duplicated: duplicateProposal,
    extraction,
    decision: createdDecision,
    suggestion: createdSuggestion,
    autoJob: null,
    blocked: null,
  };
}

export async function ingestConsultationTranscript(
  sessionId: string,
  req: IngestTranscriptRequest,
): Promise<TranscriptTurnResponse | null> {
  const existing = await getSession(sessionId);
  if (!existing || !existing.consultation) return null;

  if (req.isFinal === false) {
    let partialSeg: TranscriptSegment | null = null;
    const updated = await mutateSession(sessionId, (session) => {
      const next = appendTranscriptSegment(session, {
        id: req.id,
        text: req.text,
        isFinal: false,
        timestamp: req.timestamp,
      });
      const tr = next.consultation?.transcript ?? [];
      partialSeg = tr[tr.length - 1] ?? null;
      return next;
    });
    if (!updated) return null;
    if (partialSeg) {
      publishConsultationEvent(sessionId, {
        type: "transcript.partial",
        segment: partialSeg,
        session: updated,
      });
    }
    return {
      session: updated,
      duplicated: false,
      extraction: null,
      decision: null,
      suggestion: null,
      autoJob: null,
      blocked: null,
    };
  }

  if (req.immediate === false) {
    let flushedResult: TranscriptTurnResponse | null = null;
    await enqueueConsultationUtterance(sessionId, req.text, async (mergedText) => {
      flushedResult = await processFinalUtteranceImmediate(sessionId, {
        ...req,
        text: mergedText,
        isFinal: true,
        immediate: true,
      });
    });
    if (flushedResult) return flushedResult;
    const latest = await getSession(sessionId);
    if (!latest) return null;
    return {
      session: latest,
      duplicated: false,
      queued: true,
      extraction: null,
      decision: null,
      suggestion: null,
      autoJob: null,
      blocked: null,
    };
  }

  return processFinalUtteranceImmediate(sessionId, req);
}

export async function handleSuggestionAction(
  sessionId: string,
  suggestionId: string,
  req: SuggestionActionRequest,
): Promise<SuggestionActionResponse | null> {
  let actedSuggestion: ProposedDesignChange | null = null;
  let appliedChanges: DesignFieldDiff[] = [];
  let previousState: BagDesignState | null = null;

  const afterActionSession = await mutateSession(sessionId, (session) => {
    if (session.consultation) {
      previousState = structuredClone(session.consultation.designState);
    }
    const res = actOnProposedSuggestion(
      session,
      suggestionId,
      req.action,
      req.editedChanges,
    );
    actedSuggestion = res.suggestion;
    appliedChanges = res.appliedChanges;
    if (req.action !== "ignore" && res.suggestion) {
      return setConsultationStatus(res.session, "GENERATING_DESIGN");
    }
    return res.session;
  });

  if (!afterActionSession || !afterActionSession.consultation) return null;

  if (!actedSuggestion) {
    return {
      session: afterActionSession,
      suggestion: null,
      job: null,
      blocked: null,
    };
  }

  const resolvedSuggestion: ProposedDesignChange = actedSuggestion;

  publishConsultationEvent(sessionId, {
    type: "suggestion.updated",
    suggestion: resolvedSuggestion,
    session: afterActionSession,
  });

  if (req.action === "ignore") {
    return {
      session: afterActionSession,
      suggestion: resolvedSuggestion,
      job: null,
      blocked: null,
    };
  }

  logConsultationMilestone("suggestion approved", {
    sessionId,
    suggestionId: resolvedSuggestion.id,
    action: req.action,
    fields: appliedChanges.map((c) => c.field),
  });

  const nextState = afterActionSession.consultation.designState;
  const prevState = previousState ?? nextState;

  const designRes = await startConsultationDesign(afterActionSession, {
    suggestionId: resolvedSuggestion.id,
    changes: appliedChanges,
    nextState,
    previousState: prevState,
  });

  if (!designRes.job) {
    return {
      session: designRes.session,
      suggestion: resolvedSuggestion,
      job: null,
      blocked: designRes.blocked,
    };
  }

  if (runwayImageEngine({ allowFallbackWhenDisabled: true }).provider === "mock") {
    const polled = await pollConsultationDesign(
      designRes.job.id,
      async (sess, ver) => (await startConsultationTryOn(sess, ver.id)).job,
    );
    if (polled) {
      const latestSession = await getSession(sessionId);
      return {
        session: latestSession ?? polled.session ?? designRes.session,
        suggestion: resolvedSuggestion,
        job: polled.followUpJob ?? polled.job,
        blocked: designRes.blocked,
      };
    }
  }

  return {
    session: designRes.session,
    suggestion: resolvedSuggestion,
    job: designRes.job,
    blocked: designRes.blocked,
  };
}

export async function restoreSessionDesignVersion(
  sessionId: string,
  versionId: string,
): Promise<StylingSession | null> {
  const updated = await mutateSession(sessionId, (session) =>
    restoreDesignVersion(session, versionId),
  );
  if (!updated) return null;

  publishConsultationEvent(sessionId, {
    type: "consultation.updated",
    session: updated,
  });
  return updated;
}
