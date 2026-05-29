import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveModelUrl } from "../../../app/lib/handwriting/loader";

const MANIFEST_URL = "/data/recognizer-manifest.json";
const MODEL_URL = "/data/kanji-recognizer.onnx";

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input)))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveModelUrl", () => {
  it("appends the manifest version as a cache-busting query string", async () => {
    stubFetch((url) => {
      expect(url).toBe(MANIFEST_URL);
      return new Response(
        JSON.stringify({
          schema: "recognizer-manifest@1",
          model: "kanji-recognizer.onnx",
          version: "abc123def456",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    expect(await resolveModelUrl()).toBe(`${MODEL_URL}?v=abc123def456`);
  });

  it("falls back to the bare URL when the manifest is missing (404)", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    expect(await resolveModelUrl()).toBe(MODEL_URL);
  });

  it("falls back to the bare URL when the manifest fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await resolveModelUrl()).toBe(MODEL_URL);
  });

  it("falls back when the manifest has no usable version field", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            schema: "recognizer-manifest@1",
            model: "kanji-recognizer.onnx",
          }),
          { status: 200 },
        ),
    );
    expect(await resolveModelUrl()).toBe(MODEL_URL);
  });
});
