# SafeGit Threshold

SafeGit Threshold creates Safe-approved, threshold-signed, GitHub-verifiable commits.

Safe owners sign an EIP-712 `GitCommitIntent` binding repo/ref/parent/tree/message/nonce/deadline and the allowed SSH signing-key fingerprint; ERC-1271 verifies that approval before a FROST Ed25519 quorum emits the Git SSHSIG. To a GitHub user, a valid commit signature means the exact branch-head-bound commit was Safe-approved, replay-resistant, and threshold-signed, not merely pushed by a compromised GitHub credential.

Important wording: the Git commit is not directly "signed by the Safe." A Safe is a smart-contract account, so it approves the exact intent on-chain; the Git object is signed by the Safe-governed threshold SSH key that GitHub can verify.

The current repo ships a complete end-to-end MVP:

- Next.js dashboard and API routes for proposals, receipts, GitHub webhooks, signer tasks, and policy views.
- Shared TypeScript packages for intent canonicalization, EIP-712 typed-data hashing, file manifests, nonce checks, GitHub check payloads, Safe approval hooks, DB schema, and verifier logic.
- A `safegit` CLI surface plus commit worker helpers.
- A local E2E demo that creates a real Git commit object with an embedded OpenSSH Git signature produced by a 2-of-3 FROST Ed25519 aggregate, then verifies it with `git verify-commit`.
- External signer-node policy verification surfaces. Production FROST Ed25519 share handling is documented and deliberately kept out of the Vercel/web app.

## Why This Design

| Design | What it proves | Main security assumption | Why not use it alone |
| --- | --- | --- | --- |
| Safe-gated GitHub App | GitHub/App created a commit after a backend allowed it; GitHub may show a platform Verified signature. | GitHub App token/backend stays honest and correctly checks Safe approval. | It is not private-key multisigning. A compromised App/backend can become the commit authority unless a separate verifier is required. |
| Threshold Git signing key | This exact Git object was signed by a threshold-controlled Git signing key. | Threshold shares are protected and fewer than threshold signers collude. | It does not automatically prove the Safe approved the commit. |
| On-chain Safe attestation | The Safe approved this exact typed commit intent on-chain. | The configured Safe and chain are the governance authority. | It is not a Git signing mechanism, so GitHub will not natively mark the commit Verified from this alone. |
| Safe-gated threshold Git signing | Safe approved the exact intent; the threshold SSH key signed the exact Git object; `safe-git-verify` proves the two match. | Safe owners and threshold-share holders represent the same governance policy, or signer nodes independently enforce the Safe proof. | This is the selected design. |

SafeGit uses **Safe-gated threshold Git signing**, with the GitHub App as orchestration only. The GitHub App prepares proposals, receives webhooks, pushes final signed commits, and publishes checks; it is not the signing authority.

The final acceptance rule is:

1. Git signature verifies under the allowed FROST SSH public key.
2. Safe on-chain approval exists for the exact EIP-712 `GitCommitIntent`.
3. The intent matches repo/ref/parent/tree/message/author/committer/signing-key/deadline/nonce.

This gives GitHub's native Verified UX without making GitHub auto-signing or the App token the root of trust.

## Can A Safe Sign The Commit?

Not in GitHub's native `Verified` sense today. A Safe is a smart-contract account: it can validate owner approvals through ERC-1271 or store an on-chain approved message hash, but it does not produce the detached PGP, SSH, or X.509/S/MIME signature that Git embeds in a commit and GitHub verifies.

The closest honest architectures are:

- **Custom verifier:** local Git tooling or CI calls `Safe.isValidSignature(...)`; GitHub will not show native `Verified` from that proof.
- **Safe receipt:** commit trailers, git notes, PR metadata, or a check run link the commit to a Safe-approved intent; this proves governance, not native Git signing by the Safe.
- **Same quorum, two proofs:** the same people control the Safe owners and the FROST shares. The Safe approves the Git intent, FROST signs the Git object, and `safe-git-verify` proves they match.

So the precise claim is: **this commit is SSH-signed by a 2-of-3 FROST threshold key, and that signing was gated by a 2-of-3 Safe on-chain approval of the exact Git commit intent.** A future GitHub verifier that understands ERC-1271/EIP-712 commit intents could make the Safe itself a first-class GitHub verification authority, but that is not how GitHub commit verification works today.

Reference docs: [Safe messages](https://docs.safe.global/sdk/protocol-kit/guides/signatures/messages), [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271), [Git signature formats](https://git-scm.com/docs/gitformat-signature), [GitHub commit verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification), [FROST](https://www.rfc-editor.org/rfc/rfc9591.html), [OpenSSH SSHSIG](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig).

## Quickstart

```bash
pnpm install
pnpm verify
pnpm dev
```

Open `http://localhost:3000`.

Production demo: https://safe-wallet-commit-signing.vercel.app

Final repo proof:

- SafeGit-signed `main`: https://github.com/p0s/safe-wallet-commit-signing/commits/main
- Receipt: https://safe-wallet-commit-signing.vercel.app/proposals/prop_safegit_root_main/receipt
- Machine-readable Safe proof: https://safe-wallet-commit-signing.vercel.app/api/proposals/prop_safegit_root_main

Sepolia 2-of-3 Safe proof:

- Safe: `0xe4acA85aD9826d15385D32CDd78DeA836c862dDb`
- Owners: 2-of-3
- Safe deployment: https://sepolia.etherscan.io/tx/0xbf101d454b96431a6be205930a94ae1bd67406140d50beb07532ce6bb3ee6bee
- Intent hash: `0xe9f3b396960ff8ad361da895e2cdf2fa596b88f15718ea4b82dcf153189c5f32`
- Safe message hash: `0x3b629593cc4e92db033966f77087ea784357ff0ef5c9c239f6c1fd5549206c3a`
- Demo threshold signing key: `SHA256:qoZVb4ipEg85+3B85vci62bzhQGOTXXA1w6zZzPN4uk`
- On-chain approval: https://sepolia.etherscan.io/tx/0x1b5682fffa4d6506246694fac1f8fe6435927be1b516e3c7c44416a1a1076294

## Local Proof

```bash
pnpm demo:frost-keygen
pnpm demo:local
```

The demo writes ignored artifacts under `tmp/demo-local-flow/`:

- `intent.json`
- `signature.sshsig`
- `signed_commit_oid.txt`
- `receipt.json`

The commit signature in the demo is real Git SSH signing from a 2-of-3 FROST Ed25519 aggregate. `pnpm demo:frost-keygen` creates ignored local key packages under `.secrets/frost-ceremony/`; production should replace the MVP trusted-dealer ceremony with DKG or an audited ceremony and encrypted share distribution.

To reproduce the Sepolia Safe proof with an ignored local key env:

```bash
pnpm demo:safe-proof:3owner
```

## Production Boundary

Vercel runs the dashboard/coordinator only. It must not store threshold signing shares or FROST nonce material.

Production needs:

- GitHub App credentials and webhook secret.
- Postgres `DATABASE_URL`.
- Safe address, chain ID, and RPC URL.
- `SAFE_GIT_ADMIN_TOKEN` for production proposal/signing mutations.
- `SIGNER_NODE_KEYS` for node-specific signer HMAC authentication, or `SIGNER_COORDINATOR_SHARED_SECRET` for an MVP-only shared-secret setup.
- Dedicated SSH signing public key registered on the GitHub bot account.
- External signer nodes running the FROST Ed25519 implementation.

The hosted public demo remains read-only if those secrets are absent: mutation routes, signer routes, and GitHub webhooks fail closed with `401`.

`UNSAFE_DEV_SIGNER=true` is rejected when `NODE_ENV=production`.

Operational endpoints include redacted `/api/health`, admin-only `/api/admin/backup`, `/api/admin/audit`, `/api/admin/signers`, and proposal-level `/api/proposals/:id/open-pr`. Branch protection/ruleset enforcement is deliberately left to repository settings.
