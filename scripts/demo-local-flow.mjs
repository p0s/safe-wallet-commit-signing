import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildIntent,
  buildUnsignedCommitPayload,
  nowIso,
  randomHex,
  sha256Hex,
  sshFingerprintFromPublicKey
} from "../packages/core/dist/index.js";
import { verifyIntentAgainstCommit, verifySafeApproval } from "../packages/verifier/dist/index.js";
import {
  buildArmoredSshsigFromEd25519,
  buildSshEd25519PublicKey,
  buildSshsigSignedData,
  buildSignedCommitObject,
  verifyGitCommit
} from "../services/commit-worker/dist/index.js";
import { buildRoundAudit } from "../services/signer-node/dist/index.js";
import { devSafeProof } from "../packages/safe/dist/index.js";

const base = join(process.cwd(), "tmp", "demo-local-flow");
rmSync(base, { force: true, recursive: true });
mkdirSync(base, { recursive: true });

const repoDir = join(base, "repo");
const demoGitDate = "2026-05-18T00:00:00Z";

run("git", ["init", "-b", "main", repoDir]);
writeFileSync(join(repoDir, "README.md"), "# Demo repository\n\nSeed file.\n");
run("git", ["-C", repoDir, "add", "README.md"]);
process.env.GIT_AUTHOR_DATE = demoGitDate;
process.env.GIT_COMMITTER_DATE = demoGitDate;
run("git", [
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
  "Seed repository"
]);

const parent = run("git", ["-C", repoDir, "rev-parse", "HEAD"]).trim();
const nextReadme = "# Demo repository\n\nThis commit was approved by a dev Safe proof and signed as a Git SSH commit.\n";
writeFileSync(join(repoDir, "README.md"), nextReadme);
run("git", ["-C", repoDir, "add", "README.md"]);
const tree = run("git", ["-C", repoDir, "write-tree"]).trim();
const diffText = run("git", ["-C", repoDir, "diff", "--binary", "HEAD"]);
const fileChanges = [
  {
    path: "README.md",
    operation: "upsert",
    contentBase64: Buffer.from(nextReadme).toString("base64")
  }
];
const author = {
  name: "Alice Example",
  email: "alice@example.com",
  unixSeconds: 1770000000,
  timezone: "+0000"
};
const committer = {
  name: "Safe Git Bot",
  email: "safe-git-bot@example.com",
  unixSeconds: 1770000000,
  timezone: "+0000"
};
const commitMessage = "Prove Safe-gated Git signing\n";
const unsignedPayload = buildUnsignedCommitPayload({
  treeOid: tree,
  expectedParentOid: parent,
  author,
  committer,
  commitMessage
});
const frostSignedDataPath = join(base, "frost_sshsig_signed_data.bin");
const frostProofPath = join(base, "frost_threshold_proof.json");
const publicDemoSeedHex = "736166656769742d66726f73742d64656d6f2d736565642d76312d3030303031";
writeFileSync(frostSignedDataPath, buildSshsigSignedData({ payload: unsignedPayload }));
const frostCeremonyDir = join(process.cwd(), ".secrets", "frost-ceremony");
const frostCeremony = loadFrostCeremony(frostCeremonyDir);
if (frostCeremony) {
  run("cargo", [
    "run",
    "-q",
    "-p",
    "safegit-cli",
    "--",
    "frost",
    "sign",
    "--threshold",
    String(frostCeremony.threshold),
    "--participants",
    String(frostCeremony.participants),
    "--message-file",
    frostSignedDataPath,
    "--public-key-package-file",
    join(frostCeremonyDir, frostCeremony.publicKeyPackageFile),
    "--key-package-file",
    join(frostCeremonyDir, frostCeremony.keyPackageFiles[0]),
    "--key-package-file",
    join(frostCeremonyDir, frostCeremony.keyPackageFiles[1]),
    "--out",
    frostProofPath
  ]);
} else {
  run("cargo", [
    "run",
    "-q",
    "-p",
    "safegit-cli",
    "--",
    "frost",
    "sign-demo",
    "--threshold",
    "2",
    "--participants",
    "3",
    "--message-file",
    frostSignedDataPath,
    "--demo-seed-hex",
    publicDemoSeedHex,
    "--out",
    frostProofPath
  ]);
}
const frostProof = JSON.parse(readFileSync(frostProofPath, "utf8"));
const verifyingKey = Buffer.from(frostProof.verifyingKeyHex, "hex");
const frostSignature = Buffer.from(frostProof.signatureHex, "hex");
const publicKey = buildSshEd25519PublicKey({ verifyingKey, comment: "safegit-frost-2-of-3" });
const fingerprint = sshFingerprintFromPublicKey(publicKey);

const built = buildIntent({
  repoHost: "github.com",
  repoOwner: "p0s",
  repoName: "safe-wallet-commit-signing",
  targetRef: "refs/heads/main",
  expectedParentOid: parent,
  treeOid: tree,
  diffText,
  fileChanges,
  commitMessage,
  author,
  committer,
  signingKeyId: "safegit-dev-1",
  signingKeyFingerprint: fingerprint,
  safeAddress: "0x0000000000000000000000000000000000000001",
  chainId: 31337,
  nonce: randomHex(),
  deadlineUnixSeconds: Math.floor(Date.now() / 1000) + 3600
});
if (built.unsignedPayload !== unsignedPayload) {
  throw new Error("FROST-signed payload does not match built intent payload");
}

const safeProof = devSafeProof({
  safeAddress: "0x0000000000000000000000000000000000000001",
  chainId: 31337,
  safeMessageHash: built.safeMessageHash
});

const signerAudits = ["signer-a", "signer-b"].flatMap((nodeName) =>
  buildRoundAudit(
    {
      sessionId: "sess_demo",
      proposalId: "prop_demo",
      phase: "round1_open",
      intent: built.intent,
      intentHash: built.intentHash,
      safeProof
    },
    {
      nodeName,
      allowedRepo: "p0s/safe-wallet-commit-signing",
      allowedRef: "refs/heads/main",
      allowedSafeAddress: safeProof.safeAddress,
      allowedChainId: safeProof.chainId,
      signingKeyId: built.intent.signingKeyId,
      signingKeyFingerprint: built.intent.signingKeySshFingerprintSha256
    }
  )
);

const signature = buildArmoredSshsigFromEd25519({ verifyingKey, signature: frostSignature });
const signed = buildSignedCommitObject({
  repoDir,
  unsignedPayload: built.unsignedPayload,
  armoredSshSignature: signature
});
const allowedSignersPath = join(base, "allowed_signers");
writeFileSync(allowedSignersPath, `safe-git-bot@example.com namespaces="git" ${publicKey}\n`);
verifyGitCommit({ repoDir, commitOid: signed.commitOid, allowedSignersPath });

const commitVerification = verifyIntentAgainstCommit({
  repoDir,
  intent: built.intent,
  commitOid: signed.commitOid,
  allowedSignersPath
});
const safeVerification = verifySafeApproval({
  intent: built.intent,
  proof: safeProof,
  intentHash: built.intentHash,
  proposalId: "prop_demo",
  allowDevApproval: true,
  nonceOwner: "prop_demo"
});

if (!commitVerification.ok || !safeVerification.ok) {
  throw new Error("Local demo verification failed");
}

const receipt = {
  id: "receipt_demo",
  proposalId: "prop_demo",
  sessionId: "sess_demo",
  finalCommitOid: signed.commitOid,
  signedCommitPayloadSha256: signed.signedPayloadSha256,
  armoredSshSignatureSha256: sha256Hex(signature),
  intentHash: built.intentHash,
  safeMessageHash: built.safeMessageHash,
  threshold: {
    scheme: frostProof.scheme,
    mode: frostProof.mode,
    keyMaterial:
      frostCeremony === null
        ? "public deterministic demo seed; not production or GitHub account signing material"
        : "ignored local trusted-dealer ceremony; key packages remain outside git under .secrets/frost-ceremony",
    required: frostProof.threshold,
    total: frostProof.participants,
    publicKey,
    signingKeyFingerprint: fingerprint
  },
  verifyResult: {
    ok: true,
    checks: [...commitVerification.checks, ...safeVerification.checks]
  },
  createdAt: nowIso(),
  signerAudits,
  mode: "local e2e proof: real 2-of-3 FROST Ed25519 aggregate wrapped as an OpenSSH Git SSH signature"
};

writeFileSync(join(base, "intent.json"), `${JSON.stringify(built, null, 2)}\n`);
writeFileSync(join(base, "signature.sshsig"), signature);
writeFileSync(join(base, "signed_commit_oid.txt"), `${signed.commitOid}\n`);
writeFileSync(join(base, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      commit: signed.commitOid,
      signingKeyFingerprint: fingerprint,
      receipt: join(base, "receipt.json"),
      checks: receipt.verifyResult.checks.length
    },
    null,
    2
  )
);

function run(command, args, input) {
  return execFileSync(command, args, { encoding: "utf8", input, stdio: "pipe" });
}

function loadFrostCeremony(dir) {
  const ceremonyPath = join(dir, "ceremony.json");
  if (!existsSync(ceremonyPath)) {
    return null;
  }
  const ceremony = JSON.parse(readFileSync(ceremonyPath, "utf8"));
  const requiredFiles = [
    ceremony.publicKeyPackageFile,
    ...(ceremony.keyPackageFiles ?? []).slice(0, ceremony.threshold)
  ];
  if (
    ceremony.threshold !== 2 ||
    ceremony.participants !== 3 ||
    requiredFiles.length !== 3 ||
    !requiredFiles.every((filename) => existsSync(join(dir, filename)))
  ) {
    throw new Error("FROST ceremony is incomplete or not a 2-of-3 key package ceremony");
  }
  return ceremony;
}
