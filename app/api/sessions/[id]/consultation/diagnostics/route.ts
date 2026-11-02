export const dynamic = "force-dynamic";

import { computeChangeFingerprint } from "@/lib/agent/consultation-aggregator";
import {
  ensureDemoCustomerPhoto,
  ingestConsultationTranscript,
  reconnectSessionConsultation,
} from "@/lib/agent/consultation-orchestrator";
import {
  pollConsultationDesign,
  startConsultationDesign,
} from "@/lib/agent/consultation-runway";
import { startConsultationTryOn } from "@/lib/agent/consultation-tryon";
import type {
  ConsultationDiagnosticAction,
  ConsultationDiagnosticRequest,
  ConsultationDiagnosticResponse,
} from "@/lib/api-types";
import { env } from "@/lib/env";
import { publishConsultationEvent } from "@/lib/server/consultation-events";
import { logConsultationMilestone } from "@/lib/server/consultation-logger";
import {
  addProposedSuggestion,
  appendConsultationActivity,
  applyChangesToBagState,
  initConsultation,
  recordDecision,
  setConsultationBotStatus,
} from "@/lib/session/reducer";
import { getSession, mutateSession } from "@/lib/session/store";
import {
  DESIGN_FIELD_LABELS,
  type DecisionRecord,
  type DesignFieldDiff,
  type ProposedDesignChange,
  type StylingSession,
} from "@/lib/types";
import { newId, nowIso } from "@/lib/util/id";
import { understandConsultationUtterance } from "@/services/gemini/consultation";
import {
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  SimulatedMeetAudioSource,
} from "@/services/meeting-bot/audio-source";
import { meetingBotClient } from "@/services/meeting-bot/client";
import { buildGeminiConsultationSetupMessage } from "@/services/meeting-bot/gemini-stream";
import { runwayImageEngine } from "@/services/runway";

type Context = { params: Promise<{ id: string }> };

const VALID_ACTIONS = new Set<ConsultationDiagnosticAction>([
  "test_bot_join",
  "reconnect_bot",
  "test_audio_capture",
  "test_gemini_stream",
  "simulate_transcript",
  "simulate_suggestion",
  "test_runway_revision",
  "test_youcam_vto",
]);

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function ensureConsultationInitialized(
  sessionId: string,
): Promise<StylingSession | null> {
  const existing = await getSession(sessionId);
  if (!existing) return null;
  if (existing.consultation) return existing;
  return mutateSession(sessionId, (session) =>
    initConsultation(session, {
      meetingUrl: "demo://local-consultation",
      consentConfirmed: true,
    }),
  );
}

function buildNextDiagnosticDiff(session: StylingSession): DesignFieldDiff[] {
  const state = session.consultation!.designState;
  if (state.hardwareColor.toLowerCase() !== "gold") {
    return [
      {
        field: "hardwareColor",
        label: DESIGN_FIELD_LABELS.hardwareColor,
        previousValue: state.hardwareColor,
        proposedValue: "gold",
      },
    ];
  }
  if (state.size.toLowerCase() !== "small") {
    return [
      {
        field: "size",
        label: DESIGN_FIELD_LABELS.size,
        previousValue: state.size,
        proposedValue: "small",
      },
    ];
  }
  if (state.strapType.toLowerCase() !== "crossbody") {
    return [
      {
        field: "strapType",
        label: DESIGN_FIELD_LABELS.strapType,
        previousValue: state.strapType,
        proposedValue: "crossbody",
      },
    ];
  }
  const nextColor =
    state.primaryColor.toLowerCase() === "espresso brown"
      ? "burgundy"
      : "espresso brown";
  return [
    {
      field: "primaryColor",
      label: DESIGN_FIELD_LABELS.primaryColor,
      previousValue: state.primaryColor,
      proposedValue: nextColor,
    },
  ];
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as ConsultationDiagnosticRequest | null;
    if (!body || typeof body.action !== "string" || !VALID_ACTIONS.has(body.action)) {
      return jsonResponse({ error: "Invalid consultation diagnostic action" }, 400);
    }

    const initialSession = await ensureConsultationInitialized(id);
    if (!initialSession || !initialSession.consultation) {
      return jsonResponse({ error: "Consultation session not found" }, 404);
    }

    switch (body.action) {
      case "test_bot_join": {
        const health = await meetingBotClient.getHealth();
        const workerConnected = Boolean(health?.ok);
        const chromiumFound = health?.chromiumFound ?? false;
        const ffmpegFound = health?.ffmpegFound ?? false;

        const updated = workerConnected ? initialSession : await mutateSession(id, (session) =>
          setConsultationBotStatus(session, "FAILED", {
            error: "Bot worker unavailable; no meeting audio is being captured.",
            activityText: "Bot worker unavailable; no meeting audio is being captured.",
          }),
        );

        const finalSession = updated ?? initialSession;
        await publishConsultationEvent(id, {
          type: "bot.status",
          status: finalSession.consultation?.botStatus ?? "FAILED",
          consultationStatus: finalSession.consultation?.status ?? "LIVE",
          message: workerConnected ? "Bot worker reachable; meeting join was not verified." : "Bot worker unavailable; no meeting audio is being captured.",
          timestamp: nowIso(),
          session: finalSession,
        });

        const response: ConsultationDiagnosticResponse = {
          ok: workerConnected,
          action: "test_bot_join",
          summary: workerConnected ? "Bot worker reachable; this check does not join a meeting." : "Bot worker unavailable; no meeting audio is being captured.",
          details: {
            workerConnected,
            chromiumFound,
            ffmpegFound,
            audioBackend: health?.audioBackend ?? env.meetingAudioBackend,
            botStatus: finalSession.consultation?.botStatus ?? "FAILED",
          },
          session: finalSession,
        };
        return jsonResponse(response);
      }

      case "reconnect_bot": {
        const reconnected = await reconnectSessionConsultation(id);
        const finalSession = reconnected ?? initialSession;
        const response: ConsultationDiagnosticResponse = {
          ok: Boolean(reconnected) && finalSession.consultation?.botStatus !== "FAILED",
          action: "reconnect_bot",
          summary: `Bot status: ${finalSession.consultation?.botStatus ?? "FAILED"}.`,
          details: {
            botStatus: finalSession.consultation?.botStatus ?? "FAILED",
            consultationStatus: finalSession.consultation?.status ?? "LIVE",
          },
          session: finalSession,
        };
        return jsonResponse(response);
      }

      case "test_audio_capture": {
        const workerDiag = await meetingBotClient.runAudioDiagnostic(250);
        let sourceKind: "worker" | "simulated" = "worker";
        let resolvedDiag = workerDiag;

        if (!resolvedDiag) {
          sourceKind = "simulated";
          const sim = new SimulatedMeetAudioSource({
            intervalMs: 60,
            emitImmediately: true,
          });
          await sim.start();
          await new Promise((resolve) => setTimeout(resolve, 250));
          await sim.stop();
          resolvedDiag = {
            ok: sim.chunksEmitted > 0,
            sampleRate: PCM_SAMPLE_RATE,
            channels: PCM_CHANNELS,
            chunksEmitted: sim.chunksEmitted,
            bytesTotal: sim.bytesEmitted,
            durationMs: 250,
            providerName: sim.providerName,
          };
        }

        const diag = resolvedDiag;

        logConsultationMilestone("audio capture started", {
          sessionId: id,
          diagnostic: true,
          sampleRate: diag.sampleRate,
          channels: diag.channels,
          chunksEmitted: diag.chunksEmitted,
          bytesTotal: diag.bytesTotal,
        });

        const updated = await mutateSession(id, (session) =>
          appendConsultationActivity(
            session,
            "bot",
            `Audio capture diagnostic: ${diag.chunksEmitted} chunks (${diag.bytesTotal} bytes) at ${diag.sampleRate} Hz mono s16le PCM`,
          ),
        );
        const finalSession = updated ?? initialSession;
        await publishConsultationEvent(id, {
          type: "consultation.updated",
          session: finalSession,
        });

        const response: ConsultationDiagnosticResponse = {
          ok: diag.ok && diag.chunksEmitted > 0,
          action: "test_audio_capture",
          summary: `Emitted ${diag.chunksEmitted} PCM frames (${diag.bytesTotal} bytes) at ${diag.sampleRate} Hz mono s16le (${sourceKind}).`,
          details: {
            sampleRate: diag.sampleRate,
            channels: diag.channels,
            chunksEmitted: diag.chunksEmitted,
            bytesTotal: diag.bytesTotal,
            source: sourceKind,
          },
          session: finalSession,
        };
        return jsonResponse(response);
      }

      case "test_gemini_stream": {
        const sampleUtterance =
          body.text?.trim() || "Could the hardware be brushed gold?";
        const understanding = await understandConsultationUtterance(
          sampleUtterance,
          initialSession.consultation.designState,
          initialSession.consultation.versions,
        );
        const setupMsg = buildGeminiConsultationSetupMessage(env.geminiLiveModel);

        logConsultationMilestone("Gemini connected", {
          sessionId: id,
          diagnostic: true,
          provider: understanding.provider,
          model: understanding.model,
          liveModel: setupMsg.setup.model,
        });

        const updated = await mutateSession(id, (session) =>
          appendConsultationActivity(
            session,
            "speech",
            `Gemini diagnostic (${understanding.provider}/${understanding.model}): extracted ${understanding.extraction.changes.length} modification(s) at ${Math.round(understanding.extraction.confidence * 100)}% confidence`,
          ),
        );
        const finalSession = updated ?? initialSession;
        await publishConsultationEvent(id, {
          type: "consultation.updated",
          session: finalSession,
        });

        const response: ConsultationDiagnosticResponse = {
          ok: true,
          action: "test_gemini_stream",
          summary: `Gemini (${understanding.provider} · ${understanding.model}) parsed "${sampleUtterance}" → ${understanding.extraction.summary} (${Math.round(understanding.extraction.confidence * 100)}%). Live WS model: ${setupMsg.setup.model}.`,
          details: {
            provider: understanding.provider,
            model: understanding.model,
            liveModel: setupMsg.setup.model,
            liveAudioTranscriptionEnabled: Boolean(
              setupMsg.setup.inputAudioTranscription,
            ),
            extraction: understanding.extraction,
          },
          session: finalSession,
        };
        return jsonResponse(response);
      }

      case "simulate_transcript": {
        const text =
          body.text?.trim() || "I like it, but can we make the hardware silver?";
        const turn = await ingestConsultationTranscript(id, {
          text,
          isFinal: true,
          immediate: true,
        });
        if (!turn) {
          return jsonResponse({ error: "Could not ingest simulated transcript" }, 500);
        }

        const decisionLabel =
          turn.decision?.consultationAction?.decision ??
          (turn.duplicated ? "DUPLICATE_SKIPPED" : "PROCESSED");
        const response: ConsultationDiagnosticResponse = {
          ok: true,
          action: "simulate_transcript",
          summary: turn.suggestion
            ? `Transcript "${text}" → JEV ${decisionLabel} → Suggestion ${turn.suggestion.changes.map((c) => `${c.label}: ${c.previousValue} → ${c.proposedValue}`).join(", ")}.`
            : `Transcript "${text}" → ${decisionLabel}.`,
          details: {
            duplicated: turn.duplicated,
            jevDecision: turn.decision?.consultationAction?.decision ?? null,
            suggestionId: turn.suggestion?.id ?? null,
            confidence: turn.extraction?.confidence ?? null,
          },
          session: turn.session,
          job: turn.autoJob,
          blocked: turn.blocked,
        };
        return jsonResponse(response);
      }

      case "simulate_suggestion": {
        const changes =
          body.changes && body.changes.length > 0
            ? body.changes
            : buildNextDiagnosticDiff(initialSession);
        const fingerprint = computeChangeFingerprint(changes);
        const suggestionId = newId("sug");
        const excerpt =
          body.text?.trim() ||
          `Can we change ${changes.map((c) => `${c.label.toLowerCase()} to ${c.proposedValue}`).join(" and ")}?`;

        let createdSuggestion: ProposedDesignChange | null = null;
        let createdDecision: DecisionRecord | null = null;

        const updated = await mutateSession(id, (session) => {
          const decision: DecisionRecord = {
            id: newId("dec"),
            createdAt: nowIso(),
            iteration: session.decisions.length + 1,
            styleDistribution: [
              { label: "minimal", probability: 0.56 },
              { label: "evening", probability: 0.44 },
            ],
            consultationAction: {
              decision: "PROPOSE_CHANGE",
              confidence: 0.96,
              distribution: [
                { label: "PROPOSE_CHANGE", probability: 0.96 },
                { label: "IGNORE", probability: 0.04 },
              ],
            },
            productEvaluation: changes.map((c) => ({
              label: `${c.label}: ${c.proposedValue}`,
              probability: 0.96,
            })),
            reason: "Diagnostic simulated suggestion ready for human-in-the-loop approval.",
            provider: "fallback",
            model: env.jevModel,
          };
          createdDecision = decision;
          const withDec = recordDecision(session, decision);
          const withSug = addProposedSuggestion(withDec, {
            id: suggestionId,
            transcriptExcerpt: excerpt,
            confidence: 0.96,
            jevAction: "PROPOSE_CHANGE",
            jevReason: decision.reason,
            provider: "fallback",
            changes,
            fingerprint,
          });
          createdSuggestion =
            withSug.consultation?.pendingSuggestions.find(
              (s) => s.id === suggestionId,
            ) ?? null;
          return withSug;
        });

        const finalSession = updated ?? initialSession;
        if (createdSuggestion && createdDecision) {
          const sug: ProposedDesignChange = createdSuggestion;
          logConsultationMilestone("suggestion detected", {
            sessionId: id,
            diagnostic: true,
            suggestionId: sug.id,
            confidence: sug.confidence,
            fields: sug.changes.map((c) => c.field),
          });
          await publishConsultationEvent(id, {
            type: "suggestion.created",
            suggestion: sug,
            decision: createdDecision,
            session: finalSession,
          });
        }

        const response: ConsultationDiagnosticResponse = {
          ok: Boolean(createdSuggestion),
          action: "simulate_suggestion",
          summary: `Injected pending suggestion (${changes.map((c) => `${c.label}: ${c.previousValue} → ${c.proposedValue}`).join(", ")}) for [Ignore] / [Edit] / [Apply] verification.`,
          details: {
            suggestionId,
            changes,
          },
          session: finalSession,
        };
        return jsonResponse(response);
      }

      case "test_runway_revision": {
        const changes =
          body.changes && body.changes.length > 0
            ? body.changes
            : buildNextDiagnosticDiff(initialSession);
        const previousState = structuredClone(
          initialSession.consultation.designState,
        );
        const nextState = applyChangesToBagState(previousState, changes);

        const stateUpdatedSession =
          (await mutateSession(id, (session) => {
            if (!session.consultation) return session;
            return {
              ...session,
              consultation: {
                ...session.consultation,
                designState: structuredClone(nextState),
              },
            };
          })) ?? initialSession;

        const designRes = await startConsultationDesign(stateUpdatedSession, {
          changes,
          nextState,
          previousState,
        });

        let finalSession = designRes.session;
        let finalJob = designRes.job;

        if (
          finalJob &&
          runwayImageEngine({ allowFallbackWhenDisabled: true }).provider === "mock"
        ) {
          const polled = await pollConsultationDesign(finalJob.id);
          if (polled) {
            finalJob = polled.job;
            finalSession =
              (await getSession(id)) ?? polled.session ?? designRes.session;
          }
        }

        const latestVer = finalSession.consultation?.versions.at(-1);
        const response: ConsultationDiagnosticResponse = {
          ok: Boolean(finalJob && !designRes.blocked),
          action: "test_runway_revision",
          summary: designRes.blocked
            ? `Runway revision blocked: ${designRes.blocked.message}`
            : `Runway Nano Banana 2.1 revision triggered (${changes.map((c) => `${c.label}: ${c.previousValue} → ${c.proposedValue}`).join(", ")}). Latest version: ${latestVer?.label ?? "pending"}.`,
          details: {
            jobId: finalJob?.id ?? null,
            provider: finalJob?.provider ?? null,
            versionCount: finalSession.consultation?.versions.length ?? 1,
            latestVersionId: latestVer?.id ?? null,
            latestVersionLabel: latestVer?.label ?? null,
          },
          session: finalSession,
          job: finalJob,
          blocked: designRes.blocked,
        };
        return jsonResponse(response);
      }

      case "test_youcam_vto": {
        let sessionForVto = initialSession;
        if (!sessionForVto.userPhotoPath) {
          await ensureDemoCustomerPhoto(id);
          sessionForVto = (await getSession(id)) ?? initialSession;
        }

        const vtoRes = await startConsultationTryOn(sessionForVto);
        const response: ConsultationDiagnosticResponse = {
          ok: Boolean(vtoRes.job && !vtoRes.blocked),
          action: "test_youcam_vto",
          summary: vtoRes.blocked
            ? `YouCam VTO blocked (${vtoRes.blocked.code}): ${vtoRes.blocked.message}`
            : `YouCam Virtual Try-On started (job ${vtoRes.job?.id ?? "n/a"}) using ${sessionForVto.userPhotoPath}.`,
          details: {
            jobId: vtoRes.job?.id ?? null,
            provider: vtoRes.job?.provider ?? null,
            userPhotoPath: sessionForVto.userPhotoPath,
            versionId:
              vtoRes.session.consultation?.currentDesignVersionId ?? null,
          },
          session: vtoRes.session,
          job: vtoRes.job,
          blocked: vtoRes.blocked,
        };
        return jsonResponse(response);
      }
    }
  } catch (error) {
    console.error("[dressly] consultation diagnostics failed:", error);
    return jsonResponse(
      { error: "Something went wrong on our side. Please try again." },
      500,
    );
  }
}
