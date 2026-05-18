import { describe, expect, it } from "vitest";
import {
  NonceRegistry,
  NULL_PARENT_OID,
  buildIntent,
  buildUnsignedCommitPayload,
  canonicalCommitMessage,
  fileManifestSha256,
  insertSshSignature,
  parseCommitPayload,
  randomHex,
  deriveSafeMessageHash,
  sha256Hex,
  sshFingerprintFromPublicKey
} from "../src/index.js";

const actor = {
  name: "Alice Example",
  email: "alice@example.com",
  unixSeconds: 1770000000,
  timezone: "+0000"
};

describe("core canonicalization", () => {
  it("normalizes commit messages to exactly one trailing LF", () => {
    expect(canonicalCommitMessage("Update README\r\n\r\n")).toBe("Update README\n");
  });

  it("builds byte-stable unsigned commit payloads", () => {
    const payload = buildUnsignedCommitPayload({
      treeOid: "eebfed94e75e7760540d1485c740902590a00332",
      expectedParentOid: "04b871796dc0420f8e7561a895b52484b701d51a",
      author: actor,
      committer: { ...actor, name: "Safe Git Bot", email: "safe-git-bot@example.com" },
      commitMessage: "Update README"
    });
    expect(sha256Hex(payload)).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(payload.endsWith("Update README\n")).toBe(true);
  });

  it("builds root commit payloads when the expected parent is null", () => {
    const payload = buildUnsignedCommitPayload({
      treeOid: "eebfed94e75e7760540d1485c740902590a00332",
      expectedParentOid: NULL_PARENT_OID,
      author: actor,
      committer: actor,
      commitMessage: "Initial SafeGit commit"
    });
    expect(payload).not.toContain("\nparent ");
    expect(parseCommitPayload(payload).parentOids).toEqual([]);
  });

  it("hashes file manifests independent of input order", () => {
    const one = fileManifestSha256([
      { path: "b.txt", operation: "upsert", contentBase64: Buffer.from("b").toString("base64") },
      { path: "a.txt", operation: "delete" }
    ]);
    const two = fileManifestSha256([
      { path: "a.txt", operation: "delete" },
      { path: "b.txt", operation: "upsert", contentBase64: Buffer.from("b").toString("base64") }
    ]);
    expect(one).toBe(two);
  });

  it("inserts and parses Git SSH gpgsig blocks", () => {
    const unsigned = buildUnsignedCommitPayload({
      treeOid: "eebfed94e75e7760540d1485c740902590a00332",
      expectedParentOid: "04b871796dc0420f8e7561a895b52484b701d51a",
      author: actor,
      committer: actor,
      commitMessage: "Signed"
    });
    const signed = insertSshSignature(
      unsigned,
      "-----BEGIN SSH SIGNATURE-----\nZmFrZQ==\n-----END SSH SIGNATURE-----\n"
    );
    expect(signed).toContain("gpgsig -----BEGIN SSH SIGNATURE-----\n ZmFrZQ==");
    const parsed = parseCommitPayload(signed);
    expect(parsed.hasSshSignature).toBe(true);
    expect(parsed.unsignedPayload).toBe(unsigned);
  });

  it("builds deterministic typed-data intent hashes", () => {
    const intent = buildIntent({
      repoHost: "github.com",
      repoOwner: "p0s",
      repoName: "safe-wallet-commit-signing",
      targetRef: "refs/heads/main",
      expectedParentOid: "04b871796dc0420f8e7561a895b52484b701d51a",
      treeOid: "eebfed94e75e7760540d1485c740902590a00332",
      diffText: "diff --git a/README.md b/README.md\n",
      fileChanges: [{ path: "README.md", operation: "upsert", contentBase64: "IyBTYWZlR2l0Cg==" }],
      commitMessage: "Update README",
      author: actor,
      committer: { ...actor, name: "Safe Git Bot", email: "safe-git-bot@example.com" },
      signingKeyId: "safegit-dev-1",
      signingKeyFingerprint: "SHA256:a",
      safeAddress: "0x0000000000000000000000000000000000000001",
      chainId: 1,
      nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
      deadlineUnixSeconds: 1770003600
    });
    expect(intent.intentHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(intent.safeMessageHash).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("derives the Safe on-chain message hash used by SignMessageLib", () => {
    expect(
      deriveSafeMessageHash(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
        "0xDA800DC6caEE19C1663516d0D249fEcA4DE9e535",
        11155111
      )
    ).toBe("0x182905afb33fe4d913c8c39f3750f1ed85b6bea4052907c626a4dab033086081");
  });

  it("rejects nonce replay across proposals", () => {
    const nonce = randomHex();
    const registry = new NonceRegistry();
    registry.reserve(nonce, "prop_1");
    expect(() => registry.reserve(nonce, "prop_2")).toThrow("Nonce already consumed");
  });

  it("computes OpenSSH SHA256 fingerprints", () => {
    expect(
      sshFingerprintFromPublicKey(
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILr9nP+fiL8QSrDCszJ7vgXLwm1WqSInMAjJHIqKeXrT p0s@users.noreply.github.com"
      )
    ).toBe("SHA256:3FK0Sb9ul6JYtV0w6KQebmhoCBvLzloYR3MzXdLqJbA");
  });
});
