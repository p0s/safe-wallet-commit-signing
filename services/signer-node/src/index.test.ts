import { describe, expect, it } from "vitest";
import { buildIntent } from "@safe-git/core";
import { selectReplacementSigner, transitionSession, verifySignerTask } from "./index.js";

describe("transitionSession", () => {
  it("burns selected nonce commitments on abort", () => {
    const state = transitionSession(
      {
        status: "round1_open",
        selectedSigners: ["signer-a", "signer-b"],
        burnedNonceCommitments: [],
        audit: []
      },
      { type: "abort", reason: "invalid share" }
    );
    expect(state.status).toBe("failed");
    expect(state.burnedNonceCommitments).toEqual(["signer-a", "signer-b"]);
  });

  it("replaces a failed signer while burning that signer's nonce commitment", () => {
    const state = selectReplacementSigner(
      {
        status: "round1_open",
        selectedSigners: ["signer-a", "signer-b"],
        burnedNonceCommitments: [],
        audit: []
      },
      "signer-b",
      ["signer-a", "signer-b", "signer-c"]
    );
    expect(state.status).toBe("round1_open");
    expect(state.selectedSigners).toEqual(["signer-a", "signer-c"]);
    expect(state.burnedNonceCommitments).toEqual(["signer-b"]);
  });
});

describe("verifySignerTask", () => {
  it("rejects missing Safe approval and expired deadlines", () => {
    const built = buildIntent({
      repoHost: "github.com",
      repoOwner: "p0s",
      repoName: "safe-wallet-commit-signing",
      targetRef: "refs/heads/main",
      expectedParentOid: "04b871796dc0420f8e7561a895b52484b701d51a",
      treeOid: "eebfed94e75e7760540d1485c740902590a00332",
      diffText: "",
      fileChanges: [],
      commitMessage: "Update",
      author: { name: "A", email: "a@example.com", unixSeconds: 1770000000, timezone: "+0000" },
      committer: { name: "B", email: "b@example.com", unixSeconds: 1770000000, timezone: "+0000" },
      signingKeyId: "safegit-dev-1",
      signingKeyFingerprint: "SHA256:test",
      safeAddress: "0x0000000000000000000000000000000000000001",
      chainId: 1,
      nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
      deadlineUnixSeconds: 10
    });
    const result = verifySignerTask(
      {
        sessionId: "sess_1",
        proposalId: "prop_1",
        phase: "round1_open",
        intent: built.intent,
        intentHash: built.intentHash,
        safeProof: {
          safeAddress: "0x0000000000000000000000000000000000000001",
          chainId: 1,
          safeMessageHash: built.safeMessageHash,
          approvalStatus: "missing"
        }
      },
      {
        nodeName: "signer-a",
        allowedRepo: "p0s/safe-wallet-commit-signing",
        allowedRef: "refs/heads/main",
        allowedSafeAddress: "0x0000000000000000000000000000000000000001",
        allowedChainId: 1,
        signingKeyId: "safegit-dev-1",
        signingKeyFingerprint: "SHA256:test"
      }
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "safe.approval")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "safe.deadline")?.passed).toBe(false);
  });
});
