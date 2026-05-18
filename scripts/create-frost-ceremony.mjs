import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sshFingerprintFromPublicKey } from "../packages/core/dist/index.js";
import { buildSshEd25519PublicKey } from "../services/commit-worker/dist/index.js";

const outDir = join(process.cwd(), ".secrets", "frost-ceremony");
const ceremonyPath = join(outDir, "ceremony.json");

mkdirSync(outDir, { recursive: true, mode: 0o700 });

if (!existsSync(ceremonyPath)) {
  execFileSync(
    "cargo",
    [
      "run",
      "-q",
      "-p",
      "safegit-cli",
      "--",
      "frost",
      "keygen",
      "--threshold",
      "2",
      "--participants",
      "3",
      "--out-dir",
      outDir
    ],
    { stdio: "ignore" }
  );
}

const ceremony = JSON.parse(readFileSync(ceremonyPath, "utf8"));
const verifyingKey = Buffer.from(ceremony.verifyingKeyHex, "hex");
const publicKey = buildSshEd25519PublicKey({
  verifyingKey,
  comment: "safegit-frost-2-of-3"
});
const fingerprint = sshFingerprintFromPublicKey(publicKey);
const publicInfo = {
  scheme: ceremony.scheme,
  mode: ceremony.mode,
  threshold: ceremony.threshold,
  participants: ceremony.participants,
  verifyingKeyHex: ceremony.verifyingKeyHex,
  publicKey,
  signingKeyFingerprint: fingerprint
};

const publicInfoPath = join(outDir, "public.json");
writeFileSync(publicInfoPath, `${JSON.stringify(publicInfo, null, 2)}\n`, { mode: 0o600 });
chmodSync(publicInfoPath, 0o600);

console.log(
  JSON.stringify(
    {
      ok: true,
      publicKey,
      signingKeyFingerprint: fingerprint,
      publicInfo: publicInfoPath
    },
    null,
    2
  )
);
