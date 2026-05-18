import { createPublicClient, encodeFunctionData, http } from "viem";
import type { Chain } from "viem";
import type { Hex, IntentTypedData, SafeProof } from "@safe-git/core";

export interface SafeApprovalInstructions {
  safeAddress: Hex;
  chainId: number;
  safeMessageHash: Hex;
  typedData: IntentTypedData;
  mode: "onchain-safe-message";
  warning?: string;
}

export function buildSafeApprovalInstructions(input: SafeApprovalInstructions): SafeApprovalInstructions {
  return input;
}

export async function verifyOnchainSafeApproval(input: {
  safeAddress: Hex;
  chainId: number;
  safeMessageHash: Hex;
  messageHash?: Hex;
  rpcUrl?: string;
}): Promise<SafeProof> {
  if (!input.rpcUrl) {
    return {
      safeAddress: input.safeAddress,
      chainId: input.chainId,
      safeMessageHash: input.safeMessageHash,
      approvalStatus: "missing"
    };
  }

  const client = createPublicClient({
    chain: { id: input.chainId, name: `chain-${input.chainId}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [input.rpcUrl] } } } as Chain,
    transport: http(input.rpcUrl)
  });

  const signed = await client.readContract({
    address: input.safeAddress,
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
    args: [input.safeMessageHash]
  });

  let isValidSignature = false;
  if (signed === 0n && input.messageHash) {
    const isValidSignatureAbi = [
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
    ] as const;
    const data = await client.call({
      account: input.safeAddress,
      to: input.safeAddress,
      data: encodeFunctionData({
        abi: isValidSignatureAbi,
        functionName: "isValidSignature",
        args: [input.messageHash, "0x"]
      })
    });
    isValidSignature = data.data?.slice(0, 10).toLowerCase() === "0x1626ba7e";
  }

  return {
    safeAddress: input.safeAddress,
    chainId: input.chainId,
    safeMessageHash: input.safeMessageHash,
    approvalStatus: signed !== 0n || isValidSignature ? "onchain_approved" : "rejected",
    verifiedAt: new Date().toISOString()
  };
}

export function devSafeProof(input: {
  safeAddress: Hex;
  chainId: number;
  safeMessageHash: Hex;
}): SafeProof {
  return {
    safeAddress: input.safeAddress,
    chainId: input.chainId,
    safeMessageHash: input.safeMessageHash,
    approvalStatus: "dev_approved",
    approvalTxHash: "0x00000000000000000000000000000000000000000000000000000000deadc0de",
    approvalBlockNumber: 0,
    verifiedAt: new Date().toISOString()
  };
}
