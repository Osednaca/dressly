import sharp from "sharp";
import {
  clearConsultationDebounce,
  computeChangeFingerprint,
  enqueueConsultationUtterance,
  isDuplicateProposal,
  isDuplicateTranscript,
  pruneRedundantChanges,
} from "@/lib/agent/consultation-aggregator";
import type {
  ConsultationResponse,
  IngestTranscriptRequest,
  JobView,
  StartConsultationRequest,
  SuggestionActionRequest,
  SuggestionActionResponse,
  TranscriptTurnResponse,
  UpdateConsultationRequest,
} from "@/lib/api-types";
import { renderStudioBagSvg } from "@/lib/catalog/bag-svg";
import { env } from "@/lib/env";
import { publishConsultationEvent } from "@/lib/server/consultation-events";
import {
  actOnProposedSuggestion,
  addProposedSuggestion,
  appendConsultationActivity,
  appendTranscriptSegment,
  endConsultation,
  initConsultation,
  recordDecision,
  recordDesignVersion,
  restoreDesignVersion,
  setConsultationBotStatus,
  setConsultationStatus,
  updateConsultationSettings,
} from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import { RESULT_DIR, writeDataFile } from "@/lib/storage/files";
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

function capitalize(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function summarizeChangesForLabel(changes: DesignFieldDiff[]): string {
  if (changes.length === 0) return "Revision";
  const first = changes[0]!;
  switch (first.field) {
    case "hardwareColor":
      return `${capitalize(first.proposedValue)} hardware`;
    case "size":
      return `${capitalize(first.proposedValue)} silhouette`;
    case "strapType":
    case "strapLength":
      return first.proposedValue.toLowerCase().includes("crossbody")
        ? "Crossbody strap"
        : `${capitalize(first.proposedValue)} strap`;
    case "primaryColor":
      return `${capitalize(first.proposedValue)} leather`;
    case "material":
    case "texture":
      return `${capitalize(first.proposedValue)} finish`;
    default:
      return `${capitalize(first.proposedValue)} ${first.label.toLowerCase()}`;
  }
}

function summarizeChangesForDescription(changes: DesignFieldDiff[]): string {
  if (changes.length === 0) return "Updated bespoke bag design";
  return changes
    .map((c) => `${c.label.toLowerCase()}: ${c.previousValue ?? "—"} → ${c.proposedValue}`)
    .join(", ");
}

export async function startSessionConsultation(
  sessionId: string,
  req: StartConsultationRequest,
): Promise<ConsultationResponse | null> {
  const updated = await mutateSession(sessionId, (session) => {
    let next = initConsultation(session, {
      meetingUrl: req.meetingUrl,
      consentConfirmed: req.consentConfirmed,
      initialDesignState: req.initialDesignState,
      initialImageUrl: req.initialImageUrl,
      autoApply: req.autoApply ?? false,
      autoApplyThreshold: env.consultationAutoApplyThreshold,
      autoTryOn: req.autoTryOn ?? false,
    });
    next = setConsultationBotStatus(next, "LISTENING", {
      activityText: "Dressly AI Assistant listening to consultation",
    });
    return next;
  });

  if (!updated || !updated.consultation) return null;

  publishConsultationEvent(sessionId, {
    type: "bot.status",
    status: updated.consultation.botStatus,
    consultationStatus: updated.consultation.status,
    message: "Dressly AI Assistant listening to consultation",
    timestamp: nowIso(),
    session: updated,
  });

  return {
    session: updated,
    bot: {
      status: updated.consultation.botStatus,
      workerConnected: false,
      message: "Dressly AI Assistant active and listening.",
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
  const updated = await mutateSession(sessionId, (session) => endConsultation(session));
  if (!updated) return null;

  publishConsultationEvent(sessionId, {
    type: "consultation.ended",
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
    publishConsultationEvent(sessionId, {
      type: "suggestion.created",
      suggestion: createdSuggestion,
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

async function renderDesignVersionPng(
  designState: BagDesignState,
  versionLabel: string,
): Promise<{ versionId: string; imageUrl: string }> {
  const versionId = newId("ver");
  const fileName = `design_${versionId}.png`;
  const svg = renderStudioBagSvg(designState, { versionLabel });
  const pngBuffer = await sharp(Buffer.from(svg, "utf8"), { density: 180 })
    .resize(896, 1200, { fit: "cover" })
    .png({ compressionLevel: 8 })
    .toBuffer();

  await writeDataFile(RESULT_DIR, fileName, pngBuffer);
  return {
    versionId,
    imageUrl: mediaUrl("results", fileName),
  };
}

export async function handleSuggestionAction(
  sessionId: string,
  suggestionId: string,
  req: SuggestionActionRequest,
): Promise<SuggestionActionResponse | null> {
  let actedSuggestion: ProposedDesignChange | null = null;
  let appliedChanges: DesignFieldDiff[] = [];

  const afterActionSession = await mutateSession(sessionId, (session) => {
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

  const updatedState = afterActionSession.consultation.designState;
  const nextVersionNum = afterActionSession.consultation.versions.length + 1;
  const shortLabel = summarizeChangesForLabel(appliedChanges);
  const fullLabel = `V${nextVersionNum} ${shortLabel}`;
  const summaryText = summarizeChangesForDescription(appliedChanges);

  const rendered = await renderDesignVersionPng(updatedState, fullLabel);

  let createdVersion = afterActionSession.consultation.versions[0]!;
  const finalSession = await mutateSession(sessionId, (session) => {
    const recorded = recordDesignVersion(session, {
      id: rendered.versionId,
      imageUrl: rendered.imageUrl,
      label: shortLabel,
      summary: summaryText,
      sourceSuggestionId: resolvedSuggestion.id,
      designState: updatedState,
    });
    createdVersion = recorded.version;
    return recorded.session;
  });

  if (!finalSession) return null;

  const job: JobView = {
    id: newId("job"),
    kind: "consultation_design",
    status: "success",
    provider: env.mockExternalApis || !env.runwayApiKey ? "mock" : "runway",
    step: `${createdVersion.label} ready`,
  };

  publishConsultationEvent(sessionId, {
    type: "design.generation.completed",
    version: createdVersion,
    job,
    session: finalSession,
  });

  return {
    session: finalSession,
    suggestion: resolvedSuggestion,
    job,
    blocked: null,
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
