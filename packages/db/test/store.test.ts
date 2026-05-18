import { describe, expect, it } from "vitest";
import { nowIso } from "@safe-git/core";
import { MemoryStore } from "../src/index.js";

describe("MemoryStore", () => {
  it("rejects nonce replay across proposals", () => {
    const store = new MemoryStore();
    store.reserveNonce("0x01", "prop_a");
    store.reserveNonce("0x01", "prop_a");
    expect(() => store.reserveNonce("0x01", "prop_b")).toThrow("Nonce already reserved");
  });

  it("backs up signer node, round, and audit records", () => {
    const store = new MemoryStore();
    const now = nowIso();
    store.upsertSignerNode({
      id: "signer-a",
      nodeName: "signer-a",
      status: "active",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    });
    store.upsertRound1Commitment({
      id: "sess_1:signer-a",
      sessionId: "sess_1",
      signerNodeId: "signer-a",
      commitment: { binding: "public" },
      createdAt: now
    });
    store.upsertRound2Share({
      id: "sess_1:signer-a",
      sessionId: "sess_1",
      signerNodeId: "signer-a",
      signatureShare: { share: "public" },
      valid: true,
      createdAt: now
    });
    store.appendAuditEvent({
      id: "audit_1",
      eventType: "signer.round2_share",
      actorType: "signer",
      actorId: "signer-a",
      sessionId: "sess_1",
      createdAt: now
    });

    const backup = store.exportBackup();
    const restored = new MemoryStore();
    restored.importBackup(backup);

    expect(restored.listSignerNodes()).toHaveLength(1);
    expect(restored.listRound1Commitments("sess_1")).toHaveLength(1);
    expect(restored.listRound2Shares("sess_1")).toHaveLength(1);
    expect(restored.listAuditEvents({ sessionId: "sess_1" })).toHaveLength(1);
  });
});
