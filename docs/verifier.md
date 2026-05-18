# Verifier

`verifyIntentAgainstCommit` checks:

- commit object exists;
- single parent for MVP;
- parent and tree match the intent;
- author and committer match the intent;
- commit message hash matches;
- unsigned payload hash matches;
- an OpenSSH signature is embedded in `gpgsig`;
- allowed signers contain the expected SSH fingerprint;
- `git verify-commit` succeeds.

`verifySafeApproval` checks:

- Safe message hash recomputes;
- Safe address and chain are present;
- approval status is accepted;
- deadline has not expired;
- nonce is unused or owned by the same proposal.

Production Safe verification calls EIP-1271 `isValidSignature(safeMessageHash, "0x")` through `@safe-git/safe`.

`safe-git-verify` should reject a final commit when any of these are true:

- the Git signature is not from the configured threshold SSH key;
- the Safe address or chain ID differs from policy;
- the Safe approval is missing, rejected, expired, or only a dev proof in production;
- the nonce is already consumed by a different proposal;
- the target ref moved away from the approved parent before signing;
- the final commit tree, parent, message, author, committer, or unsigned payload hash differs from the approved intent;
- the receipt points at a different final commit, intent hash, or Safe message hash.
