import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIntent } from "@safe-git/core";
import { verifyRepositoryState } from "../src/index.js";

describe("verifyRepositoryState", () => {
  it("rejects branch movement and wrong policy fields", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "safegit-repo-state-"));
    execFileSync("git", ["init", "-b", "main", repoDir]);
    writeFileSync(join(repoDir, "README.md"), "seed\n");
    execFileSync("git", ["-C", repoDir, "add", "README.md"]);
    execFileSync("git", [
      "-C",
      repoDir,
      "-c",
      "user.name=Seed",
      "-c",
      "user.email=seed@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "seed"
    ]);
    const parent = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const tree = execFileSync("git", ["-C", repoDir, "write-tree"], { encoding: "utf8" }).trim();
    const built = buildIntent({
      repoHost: "github.com",
      repoOwner: "p0s",
      repoName: "safe-wallet-commit-signing",
      targetRef: "refs/heads/main",
      expectedParentOid: parent,
      treeOid: tree,
      diffText: "",
      fileChanges: [],
      commitMessage: "test",
      author: { name: "A", email: "a@example.com", unixSeconds: 1, timezone: "+0000" },
      committer: { name: "B", email: "b@example.com", unixSeconds: 1, timezone: "+0000" },
      signingKeyId: "key-1",
      signingKeyFingerprint: "SHA256:key",
      safeAddress: "0x0000000000000000000000000000000000000001",
      chainId: 1,
      nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
      deadlineUnixSeconds: 9999999999
    });
    const policy = {
      id: built.intent.policyId,
      repoOwner: "p0s",
      repoName: "safe-wallet-commit-signing",
      targetRef: "refs/heads/main",
      safeAddress: "0x0000000000000000000000000000000000000001" as const,
      chainId: 1,
      signingKeyId: "key-1",
      signingKeyFingerprint: "SHA256:key",
      thresholdT: 2,
      thresholdN: 3,
      allowEmptyCommit: false,
      allowForcePush: false
    };

    const moved = verifyRepositoryState({
      repoDir,
      intent: built.intent,
      policy,
      currentRefOid: "0000000000000000000000000000000000000000"
    });
    expect(moved.ok).toBe(false);
    expect(moved.checks.find((check) => check.name === "repo.currentRef")?.passed).toBe(false);

    const wrongRef = verifyRepositoryState({
      repoDir,
      intent: built.intent,
      policy: { ...policy, targetRef: "refs/heads/release" },
      currentRefOid: parent
    });
    expect(wrongRef.checks.find((check) => check.name === "repo.ref")?.passed).toBe(false);
  });
});
