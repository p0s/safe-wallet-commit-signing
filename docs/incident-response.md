# Incident Response

## GitHub App Key Compromise

Revoke the private key in GitHub, rotate Vercel env vars, disable write operations, and review audit events. A compromised GitHub App cannot create protected commits without signer quorum approval.

## Signer Share Compromise

Mark the signer inactive, rotate the threshold key, update GitHub SSH signing keys, and disable policies using the old fingerprint.

## Malicious Commit

Run receipt verification against the commit. Check parent, tree, intent hash, Safe message hash, nonce, deadline, and signing key fingerprint. Revoke the affected policy if any check fails.

## Safe Owner Compromise

Use Safe recovery/owner rotation, pause signing policies for that Safe, and require a new policy ID after the owner set changes.
