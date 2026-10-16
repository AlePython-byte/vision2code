import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AnalysisResponseSchema, analysisClientTimeoutMs } from "@vision2code/contracts";
import { AnalysisClientError, createAnalysisClient } from "../src/features/analysis/analysisClient.ts";
import { createAnalysisModel } from "../src/features/analysis/analysisModel.ts";
import { en, es, messageKeys } from "../src/features/preferences/resources.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";

const uiSchema: unknown = JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const result = AnalysisResponseSchema.parse({ requestId: "fidelity-test", uiSchema });
const screenshot = (): Screenshot => {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "capture.png", { type: "image/png" });
  return { file, name: "capture.png", size: file.size, format: "PNG", width: 640, height: 480, url: "blob:test" };
};
const signal = () => new AbortController().signal;

test("the selected mode travels in the analysis request; without one the field is not sent", async () => {
  const sent: (string | null)[] = [];
  const client = createAnalysisClient(undefined, async (_url, options) => {
    sent.push((options?.body as FormData).get("fidelity") as string | null);
    return Response.json(result);
  });
  for (const fidelity of ["fast", "balanced", "precise"] as const) await client(screenshot(), signal(), { fidelity });
  await client(screenshot(), signal());
  assert.deepEqual(sent, ["fast", "balanced", "precise", null]);
});

test("the analysis model sends the mode captured when analysis started, not a later choice", async () => {
  const sent: (string | null)[] = [];
  const model = createAnalysisModel(createAnalysisClient(undefined, async (_url, options) => {
    sent.push((options?.body as FormData).get("fidelity") as string | null);
    return Response.json(result);
  }));
  model.setScreenshot(screenshot());
  await model.analyze({ fidelity: "precise" });
  await model.analyze({});
  assert.deepEqual(sent, ["precise", "balanced"], "an analysis without an explicit mode is balanced");
  assert.equal(model.getSnapshot().context?.fidelity, "balanced");
});

test("precise waits longer than balanced, which waits longer than fast", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const fidelity of ["fast", "balanced", "precise"] as const) {
    let abortSignal: AbortSignal | undefined;
    const client = createAnalysisClient(undefined, async (_url, options) => {
      abortSignal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT"))));
    });
    const request = assert.rejects(client(screenshot(), signal(), { fidelity }), /tardó demasiado/);
    context.mock.timers.tick(analysisClientTimeoutMs(fidelity) - 1);
    assert.equal(abortSignal?.aborted, false, `${fidelity}: still waiting`);
    context.mock.timers.tick(1);
    await request;
    assert.equal(abortSignal?.aborted, true, fidelity);
  }
  assert.ok(analysisClientTimeoutMs("fast") < analysisClientTimeoutMs("balanced") && analysisClientTimeoutMs("balanced") < analysisClientTimeoutMs("precise"));
});

test("truncated output and unsupported settings are clear, localized errors that never expire the session", async () => {
  for (const [code, key] of [["AI_OUTPUT_TRUNCATED", "analysisTruncated"], ["AI_SETTINGS_UNSUPPORTED", "analysisSettingsUnsupported"]] as const) {
    let expired = 0;
    const client = createAnalysisClient(undefined, async () => Response.json(
      { error: { code, message: "mensaje del servidor", requestId: "req-1" } }, { status: 502 }), { getAccessToken: async () => "token", onUnauthorized: () => { expired++; } });
    const error = await client(screenshot(), signal(), { fidelity: "precise" }).catch((reason: unknown) => reason);
    assert.ok(error instanceof AnalysisClientError);
    assert.equal(error.code, code);
    assert.equal(error.message, es[key], "the fixed Spanish message, never the provider's");
    assert.equal(messageKeys[error.message], key, "it maps to a resource key, so English works too");
    assert.ok(en[key].length > 0 && !/openai|provider|token/i.test(es[key] + en[key]));
    assert.equal(expired, 0, `${code} must not expire the session`);
  }
});

test("the mode descriptions tell the truth about time and cost (ES/EN)", () => {
  assert.match(es.fidelityPreciseDesc, /tarda más y consume más/);
  assert.match(en.fidelityPreciseDesc, /takes longer and costs more/);
  assert.match(es.fidelityFastDesc, /más rápido y económico/);
  assert.match(en.fidelityFastDesc, /cheaper/);
  for (const text of [es.fidelityFastDesc, es.fidelityBalancedDesc, es.fidelityPreciseDesc, en.fidelityFastDesc, en.fidelityBalancedDesc, en.fidelityPreciseDesc]) {
    assert.doesNotMatch(text, /metadat/i);
  }
});
