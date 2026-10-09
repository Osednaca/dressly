import assert from "node:assert/strict";
import test from "node:test";
import { getProduct } from "@/lib/catalog/products";
import { createSessionRecord, placeProduct } from "@/lib/session/reducer";
import { LIVE_TOOL_NAMES, buildLiveSetup } from "@/services/gemini/live";

test("the Live setup is audio-out, transcribed, and exposes exactly the stylist tools", () => {
  const setup = buildLiveSetup(createSessionRecord("s_live", null), "gemini-3.8-live");
  assert.equal(setup.model, "models/gemini-3.8-live");
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.ok(setup.inputAudioTranscription);
  assert.ok(setup.outputAudioTranscription);
  const names = setup.tools.flatMap((tool) => tool.functionDeclarations.map((fn) => fn.name));
  assert.deepEqual(names, [...LIVE_TOOL_NAMES]);
});

test("the Live prompt carries the session state but never the shopper photo", () => {
  const top = getProduct("top_001");
  assert.ok(top);
  const session = placeProduct(
    { ...createSessionRecord("s_live", "/api/media/uploads/photo_secret.jpg"), occasion: "rooftop dinner" },
    top,
  );
  const prompt = buildLiveSetup(session, "gemini-3.8-live").systemInstruction.parts[0]?.text ?? "";
  assert.match(prompt, /rooftop dinner/);
  assert.match(prompt, /Linen Resort Shirt/);
  assert.doesNotMatch(prompt, /photo_secret/);
});
