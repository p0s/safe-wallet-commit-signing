import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildIntent, randomHex, sshFingerprintFromPublicKey } from "@safe-git/core";
import { verifyIntentAgainstCommit, verifyReceipt } from "@safe-git/verifier";
import { verifySignerTask, verifySignerTaskWithOnchainApproval } from "@safe-git/signer-node";
import { buildSignedCommitObject } from "./index.js";

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const [group, command] = args;

  if (!group || group === "--help" || group === "-h") {
    printHelp();
    return;
  }

  if (group === "keygen" && command === "trusted-dealer") {
    trustedDealer(args.slice(2));
    return;
  }

  if (group === "key" && command === "fingerprint") {
    const publicKeyPath = requiredFlag(args, "--public-key");
    console.log(sshFingerprintFromPublicKey(readFileSync(publicKeyPath, "utf8")));
    return;
  }

  if (group === "key" && command === "public") {
    const sharePath = requiredFlag(args, "--share");
    const share = JSON.parse(readFileSync(sharePath, "utf8")) as { publicKey?: string };
    if (!share.publicKey) {
      throw new Error("Share file does not expose publicKey metadata");
    }
    console.log(share.publicKey.trim());
    return;
  }

  if (group === "intent" && command === "build") {
    buildIntentCommand(args.slice(2));
    return;
  }

  if (group === "commit" && command === "build") {
    const repoDir = requiredFlag(args, "--repo-dir");
    const intentPath = requiredFlag(args, "--intent");
    const signaturePath = requiredFlag(args, "--ssh-signature");
    const outPath = requiredFlag(args, "--out");
    const intentDocument = JSON.parse(readFileSync(intentPath, "utf8")) as { unsignedPayload: string };
    const result = buildSignedCommitObject({
      repoDir,
      unsignedPayload: intentDocument.unsignedPayload,
      armoredSshSignature: readFileSync(signaturePath, "utf8")
    });
    writeFileSync(outPath, `${result.commitOid}\n`);
    console.log(result.commitOid);
    return;
  }

  if (group === "verify" && command === "receipt") {
    const receiptPath = requiredFlag(args, "--receipt");
    const result = verifyReceipt(JSON.parse(readFileSync(receiptPath, "utf8")));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (group === "verify" && command === "commit") {
    const repoDir = requiredFlag(args, "--repo-dir");
    const intentPath = requiredFlag(args, "--intent");
    const commitOid = requiredFlag(args, "--commit");
    const allowedSignersPath = requiredFlag(args, "--allowed-signers");
    const intentDocument = JSON.parse(readFileSync(intentPath, "utf8")) as { intent: never };
    const result = verifyIntentAgainstCommit({
      repoDir,
      intent: intentDocument.intent,
      commitOid,
      allowedSignersPath
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (group === "signer" && command === "verify-task") {
    const taskPath = requiredFlag(args, "--task");
    const configPath = requiredFlag(args, "--config");
    const rpcUrl = flag(args, "--rpc-url") ?? process.env.SAFE_RPC_URL;
    const result = await verifySignerTaskWithOnchainApproval(
      JSON.parse(readFileSync(taskPath, "utf8")),
      JSON.parse(readFileSync(configPath, "utf8")),
      { rpcUrl }
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (group === "signer" && command === "serve") {
    await signerServe(args.slice(2));
    return;
  }

  if (group === "admin" && command === "backup") {
    await adminBackup(args.slice(2));
    return;
  }

  if (group === "admin" && command === "restore") {
    await adminRestore(args.slice(2));
    return;
  }

  throw new Error(`Unsupported command: ${args.join(" ")}`);
}

async function signerServe(args: string[]): Promise<void> {
  const configPath = requiredFlag(args, "--config");
  const coordinatorUrl = requiredFlag(args, "--coordinator-url");
  const token = flag(args, "--token");
  const nodeId = flag(args, "--node-id");
  const nodeSecret = flag(args, "--node-secret") ?? process.env.SIGNER_NODE_SECRET;
  const rpcUrl = flag(args, "--rpc-url") ?? process.env.SAFE_RPC_URL;
  const once = args.includes("--once");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  do {
    const path = "/api/signer/tasks";
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    if (nodeId && nodeSecret) {
      Object.assign(headers, signerHmacHeaders({ method: "GET", path, rawBody: "", nodeId, nodeSecret }));
    }
    const response = await fetch(`${coordinatorUrl.replace(/\/$/u, "")}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`Coordinator returned ${response.status}`);
    }
    const payload = (await response.json()) as { tasks?: unknown[] };
    for (const task of payload.tasks ?? []) {
      const result = rpcUrl
        ? await verifySignerTaskWithOnchainApproval(task as never, config, { rpcUrl })
        : verifySignerTask(task as never, config);
      console.log(JSON.stringify({ task: (task as { sessionId?: string }).sessionId, result }, null, 2));
    }
  } while (!once);
}

async function adminBackup(args: string[]): Promise<void> {
  const coordinatorUrl = requiredFlag(args, "--coordinator-url");
  const token = requiredFlag(args, "--token");
  const out = requiredFlag(args, "--out");
  const response = await fetch(`${coordinatorUrl.replace(/\/$/u, "")}/api/admin/backup`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`Backup failed: ${response.status}`);
  }
  const body = await response.text();
  writeFileSync(out, `${body.trim()}\n`);
  console.log(out);
}

async function adminRestore(args: string[]): Promise<void> {
  const coordinatorUrl = requiredFlag(args, "--coordinator-url");
  const token = requiredFlag(args, "--token");
  const backupPath = requiredFlag(args, "--backup");
  const response = await fetch(`${coordinatorUrl.replace(/\/$/u, "")}/api/admin/backup`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: readFileSync(backupPath, "utf8")
  });
  if (!response.ok) {
    throw new Error(`Restore failed: ${response.status}`);
  }
  console.log(await response.text());
}

function trustedDealer(args: string[]): void {
  const threshold = Number(requiredFlag(args, "--threshold"));
  const participants = Number(requiredFlag(args, "--participants"));
  const keyId = requiredFlag(args, "--key-id");
  const out = requiredFlag(args, "--out");
  if (!Number.isInteger(threshold) || !Number.isInteger(participants) || threshold < 1 || threshold > participants) {
    throw new Error("Invalid threshold/participants");
  }
  mkdirSync(join(out, "public"), { recursive: true });
  mkdirSync(join(out, "shares"), { recursive: true });
  const keyPath = join(out, "public", "ssh_public_key");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", keyId, "-f", keyPath], { stdio: "pipe" });
  const publicKey = readFileSync(`${keyPath}.pub`, "utf8");
  for (let index = 1; index <= participants; index += 1) {
    writeFileSync(
      join(out, "shares", `signer-${index}.share.dev.json`),
      `${JSON.stringify(
        {
          warning: "DEV ONLY: this is a ceremony placeholder, not a production FROST share",
          keyId,
          threshold,
          participants,
          signerIndex: index,
          publicKey
        },
        null,
        2
      )}\n`
    );
  }
  writeFileSync(
    join(out, "public", "group_public_key.json"),
    `${JSON.stringify({ keyId, threshold, participants, publicKey, fingerprint: sshFingerprintFromPublicKey(publicKey) }, null, 2)}\n`
  );
  writeFileSync(
    join(out, "ceremony_receipt.json"),
    `${JSON.stringify(
      {
        keyId,
        mode: "trusted-dealer-dev",
        threshold,
        participants,
        publicKeyPath: "public/ssh_public_key.pub",
        warning: "Production must replace this with audited FROST DKG or real FROST trusted-dealer shares."
      },
      null,
      2
    )}\n`
  );
}

function buildIntentCommand(args: string[]): void {
  const repo = requiredFlag(args, "--repo");
  const [, repoOwner, repoName] = /^github\.com\/([^/]+)\/([^/]+)$/u.exec(repo) ?? [];
  if (!repoOwner || !repoName) {
    throw new Error("--repo must look like github.com/org/repo");
  }
  const message = readFileSync(requiredFlag(args, "--message"), "utf8");
  const built = buildIntent({
    repoHost: "github.com",
    repoOwner,
    repoName,
    targetRef: requiredFlag(args, "--ref"),
    expectedParentOid: requiredFlag(args, "--parent"),
    treeOid: requiredFlag(args, "--tree"),
    diffText: "",
    fileChanges: [],
    commitMessage: message,
    author: {
      name: requiredFlag(args, "--author-name"),
      email: requiredFlag(args, "--author-email"),
      unixSeconds: Number(flag(args, "--author-time") ?? Math.floor(Date.now() / 1000)),
      timezone: flag(args, "--author-tz") ?? "+0000"
    },
    committer: {
      name: requiredFlag(args, "--committer-name"),
      email: requiredFlag(args, "--committer-email"),
      unixSeconds: Number(flag(args, "--committer-time") ?? Math.floor(Date.now() / 1000)),
      timezone: flag(args, "--committer-tz") ?? "+0000"
    },
    signingKeyId: requiredFlag(args, "--signing-key-id"),
    signingKeyFingerprint: requiredFlag(args, "--signing-key-fingerprint"),
    safeAddress: requiredFlag(args, "--safe") as `0x${string}`,
    chainId: Number(requiredFlag(args, "--chain-id")),
    nonce: (flag(args, "--nonce") as `0x${string}` | undefined) ?? randomHex(),
    deadlineUnixSeconds: Number(flag(args, "--deadline") ?? Math.floor(Date.now() / 1000) + 3600)
  });
  const out = requiredFlag(args, "--out");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(built, null, 2)}\n`);
  console.log(built.intentHash);
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function signerHmacHeaders(input: {
  method: string;
  path: string;
  rawBody: string;
  nodeId: string;
  nodeSecret: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  const message = [input.method, input.path, timestamp, bodyHash].join("\n");
  const signature = createHmac("sha256", input.nodeSecret).update(message).digest("hex");
  return {
    "x-safegit-signer-id": input.nodeId,
    "x-safegit-timestamp": timestamp,
    "x-safegit-signature": `sha256=${signature}`
  };
}

function printHelp(): void {
  console.log(`safegit

Commands:
  keygen trusted-dealer --threshold 2 --participants 3 --key-id safegit-dev-1 --out ./key-ceremony
  key public --share ./signer-1.share.dev.json
  key fingerprint --public-key ./ssh_public_key.pub
  intent build --repo github.com/org/repo --ref refs/heads/main --parent <sha> --tree <sha> --message ./msg.txt --author-name A --author-email a@example.com --committer-name Bot --committer-email bot@example.com --signing-key-id id --signing-key-fingerprint SHA256:... --safe 0x... --chain-id 1 --out intent.json
  signer serve --config signer.json --coordinator-url http://localhost:3000 --node-id signer-a --node-secret "$SIGNER_NODE_SECRET" --rpc-url https://... --once
  signer verify-task --task task.json --config signer.json --rpc-url https://...
  commit build --repo-dir ./repo --intent intent.json --ssh-signature signature.sshsig --out signed_commit_oid.txt
  verify commit --repo-dir ./repo --intent intent.json --commit <sha> --allowed-signers ./allowed_signers
  verify receipt --receipt receipt.json
  admin backup --coordinator-url https://... --token "$SAFE_GIT_ADMIN_TOKEN" --out backup.json
  admin restore --coordinator-url https://... --token "$SAFE_GIT_ADMIN_TOKEN" --backup backup.json`);
}
