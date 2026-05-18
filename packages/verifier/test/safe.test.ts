import { describe, expect, it } from "vitest";
import { buildIntent } from "@safe-git/core";
import { verifySafeApproval } from "../src/index.js";

describe("verifySafeApproval", () => {
  it("rejects expired approvals", () => {
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
    const result = verifySafeApproval({
      intent: built.intent,
      intentHash: built.intentHash,
      proposalId: "prop_1",
      nowUnixSeconds: 11,
      proof: {
        safeAddress: "0x0000000000000000000000000000000000000001",
        chainId: 1,
        safeMessageHash: built.safeMessageHash,
        approvalStatus: "dev_approved"
      }
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "safe.approval")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "safe.deadline")?.passed).toBe(false);
  });

  it("accepts dev approvals only when explicitly allowed", () => {
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
      deadlineUnixSeconds: 20
    });
    const result = verifySafeApproval({
      intent: built.intent,
      intentHash: built.intentHash,
      proposalId: "prop_1",
      nowUnixSeconds: 11,
      allowDevApproval: true,
      proof: {
        safeAddress: "0x0000000000000000000000000000000000000001",
        chainId: 1,
        safeMessageHash: built.safeMessageHash,
        approvalStatus: "dev_approved"
      }
    });
    expect(result.ok).toBe(true);
  });
});
