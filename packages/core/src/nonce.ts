import type { Hex } from "./types.js";

export class NonceRegistry {
  private readonly consumed = new Map<Hex, string>();

  reserve(nonce: Hex, proposalId: string): void {
    const existing = this.consumed.get(nonce);
    if (existing && existing !== proposalId) {
      throw new Error(`Nonce already consumed by proposal ${existing}`);
    }
    this.consumed.set(nonce, proposalId);
  }

  isUnusedOrOwnedBy(nonce: Hex, proposalId: string): boolean {
    const existing = this.consumed.get(nonce);
    return !existing || existing === proposalId;
  }

  snapshot(): Array<{ nonce: Hex; proposalId: string }> {
    return [...this.consumed.entries()].map(([nonce, proposalId]) => ({ nonce, proposalId }));
  }
}
