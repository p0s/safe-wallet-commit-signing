import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSignerRequestAuth } from "./auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireSignerRequestAuth", () => {
  it("accepts node-specific HMAC auth and binds the raw body", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SAFE_GIT_ENV", "production");
    vi.stubEnv("SIGNER_NODE_KEYS", "signer-a=secret-a");
    const rawBody = JSON.stringify({ signerNodeId: "signer-a", share: "public" });
    const headers = signerHeaders({
      method: "POST",
      path: "/api/signer/sessions/sess_1/round2-share",
      rawBody,
      nodeId: "signer-a",
      nodeSecret: "secret-a"
    });
    const request = new Request("https://example.test/api/signer/sessions/sess_1/round2-share", {
      method: "POST",
      headers
    });

    expect(requireSignerRequestAuth(request, rawBody)).toBeNull();
    expect(requireSignerRequestAuth(request, `${rawBody}\n`)).not.toBeNull();
  });
});

function signerHeaders(input: {
  method: string;
  path: string;
  rawBody: string;
  nodeId: string;
  nodeSecret: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  const message = [input.method, input.path, timestamp, bodyHash].join("\n");
  return {
    "x-safegit-signer-id": input.nodeId,
    "x-safegit-timestamp": timestamp,
    "x-safegit-signature": `sha256=${createHmac("sha256", input.nodeSecret).update(message).digest("hex")}`
  };
}
