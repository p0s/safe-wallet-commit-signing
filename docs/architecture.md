# Architecture

SafeGit Threshold has three proof layers:

1. Git SSH signature proof on the final commit object.
2. Safe governance proof over an EIP-712 `GitCommitIntent`.
3. GitHub App orchestration and check-run publication.

The web app coordinates proposals and signer sessions. It never stores signing shares. Signer nodes run outside Vercel and verify policy, Safe approval, deadline, nonce, repo/ref, and payload hashes before participating in signing.

The local E2E uses a trusted-dealer 2-of-3 FROST Ed25519 aggregate wrapped as an OpenSSH Git SSH signature. Production replaces the local ceremony with DKG or an audited ceremony and keeps the same verifier-facing receipt shape.

## Proof Semantics

SafeGit does not claim that a Safe directly signs Git commits. Safe contracts validate approvals through ERC-1271; GitHub validates Git signatures through SSH, GPG, or S/MIME. SafeGit binds those worlds by having Safe owners approve a typed commit intent first, then letting a FROST Ed25519 quorum sign the Git commit payload only after the Safe approval is valid on-chain.

Short version:

Safe owners sign an EIP-712 `GitCommitIntent` binding repo/ref/parent/tree/message/nonce/deadline and the allowed SSH signing-key fingerprint; ERC-1271 verifies that approval before a FROST Ed25519 quorum emits the Git SSHSIG. A valid GitHub commit signature therefore means the exact commit was Safe-approved, replay-resistant, branch-head-bound, and threshold-signed.

## Alternatives

| Design | Trust anchor | What GitHub shows | Security tradeoff |
| --- | --- | --- | --- |
| Safe-gated GitHub App | Backend verifies Safe, then GitHub creates/signs the commit. | Native Verified via GitHub/platform signing. | Great UX, but the App/backend becomes the effective authority; it does not prove threshold private-key signing. |
| Threshold Git signing key | FROST/MPC key signs the Git object. | Native Verified if the public key is registered. | Strong Git-object provenance, but no Safe governance proof unless paired with on-chain attestation. |
| On-chain Safe attestation | Safe validates an EIP-712 intent via ERC-1271. | No native Verified badge by itself. | Strong governance/audit proof, but it does not create a Git signature. |
| SafeGit selected design | Safe approval plus FROST SSH signing; GitHub App only coordinates. | Native Verified plus `safe-git-verify` check. | More infrastructure, but avoids trusting GitHub auto-signing or a single backend credential as the signing authority. |

For protected branches, branch policy should require both a valid signed commit and the `safe-git-verify` check. Signed-commit enforcement alone is insufficient because GitHub-auto-signed commits can also be Verified.
