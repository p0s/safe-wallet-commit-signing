#!/usr/bin/env node
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import Safe, { getSignMessageLibContract } from "@safe-global/protocol-kit";
import { OperationType } from "@safe-global/types-kit";
import { createPublicClient, encodeFunctionData, formatEther, http } from "viem";
import { waitForTransactionReceipt } from "viem/actions";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { buildIntent } from "../packages/core/dist/index.js";

const baseEnvPath = new URL("../.secrets/testnet.env", import.meta.url);
const safeEnvPath = new URL("../.secrets/three-owner-safe.env", import.meta.url);
const proofPath = new URL("../.secrets/three-owner-safe-proof.json", import.meta.url);

await loadEnvFile(baseEnvPath);
await ensureThreeOwnerEnv();
await loadEnvFile(safeEnvPath);

const ownerKeys = [
  requiredEnv("ETHEREUM_PRIVATE_KEY"),
  requiredEnv("SAFE_OWNER_2_PRIVATE_KEY"),
  requiredEnv("SAFE_OWNER_3_PRIVATE_KEY")
];
const ownerAccounts = ownerKeys.map((privateKey) => privateKeyToAccount(privateKey));
if (process.env.FUNDING_ADDRESS && ownerAccounts[0].address.toLowerCase() !== process.env.FUNDING_ADDRESS.toLowerCase()) {
  throw new Error(`Funding address mismatch: ${ownerAccounts[0].address}`);
}

const chainId = Number(process.env.SAFE_CHAIN_ID ?? sepolia.id);
if (chainId !== sepolia.id) {
  throw new Error("The 3-owner demo currently targets Sepolia only");
}
const chain = sepolia;
const rpcUrl = process.env.SAFE_RPC_URL ?? chain.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const balance = await publicClient.getBalance({ address: ownerAccounts[0].address });
if (balance < 5_000_000_000_000_000n) {
  throw new Error(`Funding account has ${formatEther(balance)} Sepolia ETH; add balance before deploying/executing a 2-of-3 Safe`);
}

const owners = ownerAccounts.map((account) => account.address);
const protocolKit = await Safe.init({
  provider: rpcUrl,
  signer: ownerKeys[0],
  predictedSafe: {
    safeAccountConfig: { owners, threshold: 2 },
    safeDeploymentConfig: { saltNonce: process.env.SAFE_3OWNER_SALT_NONCE ?? "2026051803" }
  }
});

const safeAddress = await protocolKit.getAddress();
let deploymentTxHash = null;
let deploymentBlockNumber = null;
if (!(await protocolKit.isSafeDeployed())) {
  const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();
  const signerClient = await protocolKit.getSafeProvider().getExternalSigner();
  deploymentTxHash = await signerClient.sendTransaction({
    to: deploymentTransaction.to,
    value: BigInt(deploymentTransaction.value),
    data: deploymentTransaction.data,
    chain
  });
  const receipt = await waitForTransactionReceipt(signerClient, { hash: deploymentTxHash });
  deploymentBlockNumber = receipt.blockNumber.toString();
}

const safeKitOwner1 = await protocolKit.connect({ provider: rpcUrl, signer: ownerKeys[0], safeAddress });
const built = buildDemoIntent({ safeAddress, chainId });
const alreadySigned = await publicClient.readContract({
  address: safeAddress,
  abi: [
    {
      type: "function",
      name: "signedMessages",
      stateMutability: "view",
      inputs: [{ name: "", type: "bytes32" }],
      outputs: [{ name: "", type: "uint256" }]
    }
  ],
  functionName: "signedMessages",
  args: [built.safeMessageHash]
});

let existingProof = {};
if (existsSync(proofPath)) {
  existingProof = JSON.parse(await readFile(proofPath, "utf8"));
}
let approvalTxHash = existingProof.approvalTxHash ?? null;
let approvalBlockNumber = existingProof.approvalBlockNumber ?? null;
if (alreadySigned === 0n) {
  const signMessageLibContract = await getSignMessageLibContract({
    safeProvider: safeKitOwner1.getSafeProvider(),
    safeVersion: safeKitOwner1.getContractVersion()
  });
  const safeTransaction = await safeKitOwner1.createTransaction({
    transactions: [
      {
        to: signMessageLibContract.getAddress(),
        value: "0",
        data: signMessageLibContract.encode("signMessage", [built.intentHash]),
        operation: OperationType.DelegateCall
      }
    ]
  });
  const signedByOwner1 = await safeKitOwner1.signTransaction(safeTransaction);
  const safeKitOwner2 = await safeKitOwner1.connect({ provider: rpcUrl, signer: ownerKeys[1], safeAddress });
  const signedByTwoOwners = await safeKitOwner2.signTransaction(signedByOwner1);
  const execution = await safeKitOwner1.executeTransaction(signedByTwoOwners);
  const receipt = await execution.transactionResponse?.wait();
  approvalTxHash = execution.hash;
  approvalBlockNumber = receipt?.blockNumber?.toString() ?? null;
}

const signatureMagic = await publicClient.call({
  account: safeAddress,
  to: safeAddress,
  data: encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "isValidSignature",
        stateMutability: "view",
        inputs: [
          { name: "_dataHash", type: "bytes32" },
          { name: "_signature", type: "bytes" }
        ],
        outputs: [{ name: "", type: "bytes4" }]
      }
    ],
    functionName: "isValidSignature",
    args: [built.intentHash, "0x"]
  })
});
if (signatureMagic.data?.slice(0, 10).toLowerCase() !== "0x1626ba7e") {
  throw new Error("3-owner Safe did not validate the approved intent through EIP-1271");
}

const proof = {
  chain: chain.name,
  chainId,
  safeAddress,
  safeVersion: safeKitOwner1.getContractVersion(),
  owners,
  threshold: 2,
  totalOwners: 3,
  deploymentTxHash: deploymentTxHash ?? existingProof.deploymentTxHash ?? null,
  deploymentBlockNumber: deploymentBlockNumber ?? existingProof.deploymentBlockNumber ?? null,
  approvalTxHash,
  approvalBlockNumber,
  intentHash: built.intentHash,
  safeMessageHash: built.safeMessageHash,
  safeUrl: `https://app.safe.global/home?safe=sep:${safeAddress}`,
  explorerSafeUrl: `https://sepolia.etherscan.io/address/${safeAddress}`,
  explorerApprovalUrl: approvalTxHash ? `https://sepolia.etherscan.io/tx/${approvalTxHash}` : null
};

await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify(proof, null, 2));

async function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }
  const envText = await readFile(path, "utf8");
  for (const line of envText.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

async function ensureThreeOwnerEnv() {
  if (existsSync(safeEnvPath)) {
    return;
  }
  const text = [
    `SAFE_OWNER_2_PRIVATE_KEY=${generatePrivateKey()}`,
    `SAFE_OWNER_3_PRIVATE_KEY=${generatePrivateKey()}`,
    "SAFE_3OWNER_SALT_NONCE=2026051803",
    ""
  ].join("\n");
  await writeFile(safeEnvPath, text, { mode: 0o600 });
  await chmod(safeEnvPath, 0o600);
}

function buildDemoIntent({ safeAddress, chainId }) {
  return buildIntent({
    repoHost: "github.com",
    repoOwner: "p0s",
    repoName: "safe-wallet-commit-signing",
    targetRef: "refs/heads/main",
    expectedParentOid: "158b6831ff7893a3b9d1370dbd5ed74349699fe4",
    treeOid: "417bbc9aad208489098836eca3bfbcfb4d2cc6ef",
    diffText: "diff --git a/README.md b/README.md\n+SafeGit protected update\n",
    fileChanges: [
      {
        path: "README.md",
        operation: "upsert",
        contentBase64: Buffer.from("# SafeGit protected update\n").toString("base64")
      }
    ],
    commitMessage: "Prove Safe-gated Git signing\n",
    author: { name: "Alice Example", email: "alice@example.com", unixSeconds: 1770000000, timezone: "+0000" },
    committer: {
      name: process.env.SAFEGIT_COMMITTER_NAME ?? "Safe Git Bot",
      email: process.env.SAFEGIT_COMMITTER_EMAIL ?? "safe-git-bot@example.com",
      unixSeconds: 1770000000,
      timezone: "+0000"
    },
    signingKeyId: process.env.SIGNING_KEY_ID ?? "safegit-dev-1",
    signingKeyFingerprint:
      process.env.SIGNING_PUBLIC_KEY_FINGERPRINT_SHA256 ?? "SHA256:qoZVb4ipEg85+3B85vci62bzhQGOTXXA1w6zZzPN4uk",
    safeAddress,
    chainId,
    nonce: "0x0000000000000000000000000000000000000000000000000000000000000007",
    deadlineUnixSeconds: 1790000000
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
