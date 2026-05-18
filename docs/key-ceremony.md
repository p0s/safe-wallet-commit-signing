# Key Ceremony

## MVP Trusted Dealer

```bash
pnpm --filter @safe-git/commit-worker build
pnpm --filter @safe-git/commit-worker exec safegit keygen trusted-dealer \
  --threshold 2 \
  --participants 3 \
  --key-id safegit-prod-2026-01 \
  --out ./key-ceremony
```

The included command is a development ceremony placeholder. It generates an SSH public key and dev share descriptors so the rest of the product can be exercised.

The local E2E path also runs the Rust FROST implementation directly:

```bash
pnpm demo:frost-keygen
pnpm demo:local
```

`pnpm demo:frost-keygen` creates ignored local key packages under `.secrets/frost-ceremony/` and prints only the public SSH key and fingerprint. `pnpm demo:local` signs the OpenSSH SSHSIG preimage with two of those three key packages and verifies the resulting Git commit with `git verify-commit`. If the ignored ceremony is absent, it falls back to an explicit public demo seed for reproducibility; that fallback seed is not production or GitHub account signing material.

## Production

Production must use audited FROST Ed25519 trusted-dealer share generation or DKG. The group private key must not exist after ceremony completion. Share files must be encrypted for individual operators and distributed out of band.

Register only the group `ssh-ed25519` public key as the GitHub SSH signing key for the bot or machine user.

Minimum production ceremony record:

- ceremony ID and date;
- threshold `t/n`;
- public SSH key and SHA256 fingerprint;
- operator identities for every share;
- transcript hash or DKG transcript reference;
- encrypted-share delivery confirmation per operator;
- destruction attestation for any temporary dealer material;
- policy ID that binds the Safe, chain ID, repo, ref, and signing-key fingerprint.

The coordinator stores only the public key fingerprint, policy metadata, signer-node identity, and public round artifacts. It must never receive a private share or a FROST nonce secret.
