import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SCREENSHOT_BYTES, validateScreenshotFile } from "../src/features/screenshot/validation.ts";
import { loadScreenshot } from "../src/features/screenshot/loadScreenshot.ts";

const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
const jpegHeader = [255, 216, 255, 224];
const webpHeader = [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80];

for (const [name, mime, bytes, expected] of [
  ["screen.PNG", "image/png", pngHeader, "PNG"],
  ["screen.jpg", "image/jpeg", jpegHeader, "JPEG"],
  ["screen.jpeg", "image/jpeg", jpegHeader, "JPEG"],
  ["screen.webp", "image/webp", webpHeader, "WEBP"],
] as const) {
  test(`accepts matching extension, MIME and signature for ${name}`, async () => {
    assert.equal(await validateScreenshotFile(new File([new Uint8Array(bytes)], name, { type: mime })), expected);
  });
}

test("allows missing MIME only with a supported extension and matching signature", async () => {
  assert.equal(await validateScreenshotFile(new File([new Uint8Array(pngHeader)], "screen.png")), "PNG");
});

test("rejects unsupported extension, MIME, renamed content, empty and truncated files", async () => {
  for (const file of [
    new File([new Uint8Array(pngHeader)], "png", { type: "image/png" }),
    new File([new Uint8Array(pngHeader)], "screen.svg", { type: "image/png" }),
    new File([new Uint8Array(pngHeader)], "screen.png", { type: "text/plain" }),
    new File([new Uint8Array(jpegHeader)], "screen.png", { type: "image/png" }),
    new File(["not an image"], "screen.webp", { type: "image/webp" }),
    new File([], "screen.png", { type: "image/png" }),
    new File([new Uint8Array([137, 80])], "screen.png", { type: "image/png" }),
  ]) {
    await assert.rejects(validateScreenshotFile(file));
  }
});

test("accepts the exact size limit and rejects one byte over it", async () => {
  const bytes = new Uint8Array(MAX_SCREENSHOT_BYTES);
  bytes.set(pngHeader);
  assert.equal(await validateScreenshotFile(new File([bytes], "screen.png", { type: "image/png" })), "PNG");
  await assert.rejects(validateScreenshotFile(new File([bytes, "x"], "screen.png", { type: "image/png" })), /10 MB/);
});

test("checks size before attempting a read", async () => {
  const file = new File([new Uint8Array(MAX_SCREENSHOT_BYTES + 1)], "screen.png");
  file.slice = () => { throw new Error("Must not read an oversized file"); };
  await assert.rejects(validateScreenshotFile(file), /10 MB/);
});

test("rejects cancelled selection before allocating an object URL", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadScreenshot(new File([new Uint8Array(pngHeader)], "screen.png"), controller.signal), { name: "AbortError" });
});

test("decoding failures and cancellation revoke their temporary object URLs", async (context) => {
  let pendingImage: FakeImage | undefined;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_value: string) { pendingImage = this; }
    removeAttribute() {}
  }
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  Object.defineProperty(globalThis, "Image", { configurable: true, value: FakeImage });
  context.after(() => {
    if (originalImage) Object.defineProperty(globalThis, "Image", originalImage);
    else Reflect.deleteProperty(globalThis, "Image");
  });
  const create = context.mock.method(URL, "createObjectURL", () => "blob:test");
  const revoke = context.mock.method(URL, "revokeObjectURL", () => {});
  const file = new File([new Uint8Array(pngHeader)], "screen.png");

  const failed = loadScreenshot(file, new AbortController().signal);
  const failureAssertion = assert.rejects(failed, /decodificar/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(pendingImage);
  pendingImage.onerror?.();
  await failureAssertion;
  assert.equal(revoke.mock.callCount(), 1);

  const controller = new AbortController();
  const cancelled = loadScreenshot(file, controller.signal);
  const cancellationAssertion = assert.rejects(cancelled, { name: "AbortError" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await cancellationAssertion;
  assert.equal(create.mock.callCount(), 2);
  assert.equal(revoke.mock.callCount(), 2);
});
