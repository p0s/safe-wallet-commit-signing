# Operations

## Web App

Deploy the monorepo root to Vercel with the checked-in `vercel.json`; it runs the root recursive build and serves `apps/web/.next`. Set the variables in `.env.example`. Do not deploy `.secrets/`, `.vercel-home/`, local media, or temporary demo artifacts.

Current production URL: `https://safe-wallet-commit-signing.vercel.app`.

Production mutation routes require `Authorization: Bearer $SAFE_GIT_ADMIN_TOKEN`. Signer-node routes should use node-specific HMAC auth through `SIGNER_NODE_KEYS`; the older `SIGNER_COORDINATOR_SHARED_SECRET` path is kept for MVP deployments only. GitHub webhooks require `GITHUB_WEBHOOK_SECRET`. If those secrets are absent, the public deployment stays read-only and returns `401` for protected write paths.

Public read routes only expose proposal IDs listed in `SAFE_GIT_PUBLIC_PROPOSAL_IDS`. Public proposal JSON redacts raw diffs, file manifests, and Safe owner addresses by default; set `SAFE_GIT_EXPOSE_OWNER_ADDRESSES=true` only for wallets whose owner addresses are intentionally public. The setup page hides `set`/`needed` deployment state in production unless `SAFE_GIT_EXPOSE_SETUP_STATUS=true`.

Current demo Safe proof:

- Network: Sepolia (`11155111`)
- Safe: `0xe4acA85aD9826d15385D32CDd78DeA836c862dDb`
- Owners: 2-of-3
- Safe deployment tx: `0xbf101d454b96431a6be205930a94ae1bd67406140d50beb07532ce6bb3ee6bee`
- On-chain approval tx: `0x1b5682fffa4d6506246694fac1f8fe6435927be1b516e3c7c44416a1a1076294`

The local key material for reproducing this proof belongs only in ignored `.secrets/testnet.env` and `.secrets/three-owner-safe.env`. Public deployments should keep `SAFE_GIT_EXPOSE_OWNER_ADDRESSES=false` unless the Safe owner addresses are intentionally public.

## Signer Nodes

Run signer nodes outside Vercel. Each node needs:

- one encrypted signing share;
- local allowlist policy;
- coordinator URL;
- node-specific authentication for production;
- RPC access for Safe approval verification.

`SIGNER_NODE_KEYS` is a comma-separated map such as:

```text
signer-a=secret-a,signer-b=secret-b,signer-c=secret-c
```

Signer requests include `x-safegit-signer-id`, `x-safegit-timestamp`, and `x-safegit-signature`. The signature is HMAC-SHA256 over:

```text
METHOD
/request/path
unix_timestamp
sha256(raw_body)
```

## GitHub App

Use contents read/write, pull requests read/write, checks read/write, and metadata read for the MVP. Split orchestrator and verifier apps before production if write separation is required.

Required production variables:

- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY_BASE64` or `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `SIGNING_KEY_ID`
- `SIGNING_PUBLIC_KEY_FINGERPRINT_SHA256`

After a receipt exists, the coordinator can publish the verifier result with:

```bash
curl -X POST \
  -H "Authorization: Bearer $SAFE_GIT_ADMIN_TOKEN" \
  https://safe-wallet-commit-signing.vercel.app/api/proposals/prop_demo/publish-check
```

The GitHub webhook also publishes `safe-git-verify` automatically for `push` events whose head commit matches a stored SafeGit receipt. Pushes with no receipt are acknowledged as not handled, so the app does not create misleading checks for ordinary commits.

### Public Test Repo E2E

1. Register the FROST group public key as an SSH signing key on the bot or p0s GitHub account.
2. Create a proposal for the public test repo and target branch.
3. Approve the exact `GitCommitIntent` on-chain from the configured Safe.
4. Run at least threshold signer nodes outside Vercel with local policy and RPC access:

```bash
safegit signer serve \
  --config signer-a.json \
  --coordinator-url https://safe-wallet-commit-signing.vercel.app \
  --node-id signer-a \
  --node-secret "$SIGNER_NODE_SECRET" \
  --rpc-url "$SAFE_RPC_URL"
```

Each signer must verify repo/ref/key/Safe/chain locally and re-check on-chain approval before producing a FROST share. Do not place signer shares or nonce material in Vercel.

5. The commit worker builds the signed commit object, runs `git verify-commit` with the allowed signers file, revalidates parent/tree, pushes with the GitHub App installation token, and records the receipt:

```bash
curl -X POST \
  -H "Authorization: Bearer $SAFE_GIT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data @receipt.json \
  https://safe-wallet-commit-signing.vercel.app/api/proposals/<proposal-id>/receipt
```

Include `"publishCheck": true` in the receipt JSON when the worker should immediately create the `safe-git-verify` check run. Otherwise the push webhook will publish it after GitHub delivers the event.

6. Confirm the commit page on GitHub shows `Verified`, the `safe-git-verify` check is successful, and the receipt page links the commit, Safe approval, intent hash, Safe message hash, and signing key fingerprint.

## Backups And Audit

The coordinator exposes admin-only runtime export/import endpoints:

```bash
safegit admin backup \
  --coordinator-url https://safe-wallet-commit-signing.vercel.app \
  --token "$SAFE_GIT_ADMIN_TOKEN" \
  --out backup.json

safegit admin restore \
  --coordinator-url https://safe-wallet-commit-signing.vercel.app \
  --token "$SAFE_GIT_ADMIN_TOKEN" \
  --backup backup.json
```

The backup contains proposals, sessions, receipts, nonce reservations, signer-node inventory, signer round artifacts, and audit events. It never contains FROST shares, nonce secrets, GitHub private keys, Safe owner private keys, or RPC credentials.

`GET /api/admin/audit` lists admin-only audit events. `GET /api/health` returns redacted readiness state for DB, GitHub App configuration, Safe RPC configuration, and signer-node status.

### Branch Protection

Branch protection is intentionally outside this implementation pass. For production, enable branch protection or rulesets for the target branch and require the `safe-git-verify` check. If a repository plan does not expose required checks, keep the cryptographic verification path as the enforcement proof and document that GitHub branch enforcement is unavailable on that plan.

## Rotation

Rotate GitHub App private keys from GitHub settings and update Vercel env vars. Rotate threshold keys by creating a new policy with a new signing key fingerprint and disabling the old policy after outstanding proposals settle.

Rotate threshold signer shares by generating a new FROST group key, registering the new public key on GitHub, deploying new signer configs, updating `SIGNING_KEY_ID` and `SIGNING_PUBLIC_KEY_FINGERPRINT_SHA256`, and rejecting new proposals for the old policy after pending sessions settle.
