#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import Safe, { getSignMessageLibContract } from "@safe-global/protocol-kit";
import { OperationType } from "@safe-global/types-kit";
import { createPublicClient, http } from "viem";
import { waitForTransactionReceipt } from "viem/actions";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, gnosisChiado } from "viem/chains";
import { buildIntent } from "../packages/core/dist/index.js";

const envPath = new URL("../.secrets/testnet.env", import.meta.url);
const proofPath = new URL("../.secrets/safe-proof.json", import.meta.url);
let existingProof = {};
if (existsSync(envPath)) {
  const envText = await readFile(envPath, "utf8");
  for (const line of envText.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}
if (existsSync(proofPath)) {
  existingProof = JSON.parse(await readFile(proofPath, "utf8"));
}

const privateKey = process.env.ETHEREUM_PRIVATE_KEY;
if (!privateKey) {
  throw new Error("ETHEREUM_PRIVATE_KEY is required in the environment or .secrets/testnet.env");
}

const account = privateKeyToAccount(privateKey);
if (process.env.FUNDING_ADDRESS && account.address.toLowerCase() !== process.env.FUNDING_ADDRESS.toLowerCase()) {
  throw new Error(`Funding address mismatch: ${account.address}`);
}

const chainId = Number(process.env.SAFE_CHAIN_ID ?? 11155111);
const chain =
  chainId === sepolia.id
    ? sepolia
    : chainId === gnosisChiado.id
      ? gnosisChiado
      : undefined;
if (!chain) {
  throw new Error(`Unsupported demo chain: ${chainId}`);
}

const rpcUrl = process.env.SAFE_RPC_URL ?? chain.rpcUrls.default.http[0];
const protocolKit = await Safe.init({
  provider: rpcUrl,
  signer: privateKey,
  predictedSafe: {
    safeAccountConfig: { owners: [account.address], threshold: 1 },
    safeDeploymentConfig: { saltNonce: "20260518" }
  }
});

const safeAddress = await protocolKit.getAddress();
let deploymentTxHash = null;
let deploymentBlockNumber = null;
const knownDemoDeploymentTxHash =
  process.env.SAFE_DEMO_DEPLOYMENT_TX_HASH ??
  (chainId === sepolia.id && safeAddress.toLowerCase() === "0xda800dc6caee19c1663516d0d249feca4de9e535"
    ? "0x9412b6d1c466e065a35e163212b18d1289e9c6297eabb2d7e2f64047fa166932"
    : null);
const knownDemoDeploymentBlockNumber =
  process.env.SAFE_DEMO_DEPLOYMENT_BLOCK_NUMBER ??
  (knownDemoDeploymentTxHash === "0x9412b6d1c466e065a35e163212b18d1289e9c6297eabb2d7e2f64047fa166932"
    ? "10871607"
    : null);

if (!(await protocolKit.isSafeDeployed())) {
  const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();
  const client = await protocolKit.getSafeProvider().getExternalSigner();
  deploymentTxHash = await client.sendTransaction({
    to: deploymentTransaction.to,
    value: BigInt(deploymentTransaction.value),
    data: deploymentTransaction.data,
    chain
  });
  const receipt = await waitForTransactionReceipt(client, { hash: deploymentTxHash });
  deploymentBlockNumber = receipt.blockNumber.toString();
}

const safeKit = await protocolKit.connect({ provider: rpcUrl, signer: privateKey, safeAddress });
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const built = buildIntent({
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

const signedMessageValue = await publicClient.readContract({
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

let approvalTxHash = existingProof.approvalTxHash ?? null;
let approvalBlockNumber = existingProof.approvalBlockNumber ?? null;
if (signedMessageValue === 0n) {
  const signMessageLibContract = await getSignMessageLibContract({
    safeProvider: safeKit.getSafeProvider(),
    safeVersion: safeKit.getContractVersion()
  });
  const txData = signMessageLibContract.encode("signMessage", [built.intentHash]);
  const signMessageTx = await safeKit.createTransaction({
    transactions: [
      {
        to: signMessageLibContract.getAddress(),
        value: "0",
        data: txData,
        operation: OperationType.DelegateCall
      }
    ]
  });
  const signedTx = await safeKit.signTransaction(signMessageTx);
  const execution = await safeKit.executeTransaction(signedTx);
  const approvalReceipt = await execution.transactionResponse?.wait();
  approvalTxHash = execution.hash;
  approvalBlockNumber = approvalReceipt?.blockNumber?.toString() ?? null;
}

const proof = {
  chain: chain.name,
  chainId,
  owner: account.address,
  safeAddress,
  safeVersion: safeKit.getContractVersion(),
  deploymentTxHash: deploymentTxHash ?? existingProof.deploymentTxHash ?? knownDemoDeploymentTxHash,
  deploymentBlockNumber: deploymentBlockNumber ?? existingProof.deploymentBlockNumber ?? knownDemoDeploymentBlockNumber,
  approvalTxHash,
  approvalBlockNumber,
  intentHash: built.intentHash,
  safeMessageHash: built.safeMessageHash,
  safeUrl:
    chainId === sepolia.id
      ? `https://app.safe.global/home?safe=sep:${safeAddress}`
      : `https://app.safe.global/home?safe=chi:${safeAddress}`,
  explorerSafeUrl:
    chainId === sepolia.id
      ? `https://sepolia.etherscan.io/address/${safeAddress}`
      : `https://blockscout.chiadochain.net/address/${safeAddress}`,
  explorerApprovalUrl:
    approvalTxHash && chainId === sepolia.id
      ? `https://sepolia.etherscan.io/tx/${approvalTxHash}`
      : approvalTxHash
        ? `https://blockscout.chiadochain.net/tx/${approvalTxHash}`
        : null
};

await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify(proof, null, 2));
