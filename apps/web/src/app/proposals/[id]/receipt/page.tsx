import { notFound } from "next/navigation";
import { seedDemoState } from "@/lib/demoData";
import { isPublicProposalId } from "@/lib/publicAccess";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  if (!isPublicProposalId(resolvedParams.id)) {
    notFound();
  }
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const receipt = await store.getReceipt(resolvedParams.id);
  if (!receipt) {
    notFound();
  }
  return (
    <>
      <section className="band">
        <p className="kicker">Receipt</p>
        <h1>{receipt.finalCommitOid}</h1>
        <p className="lead">
          This receipt proves a Safe-approved intent was matched to a threshold SSH-signed Git commit. GitHub verifies
          the SSH key; SafeGit verifies the on-chain Safe approval and intent mapping.
        </p>
      </section>
      <section className="grid">
        <div className="panel">
          <h2>Safe approval</h2>
          <p className="muted">
            Safe owners approved the EIP-712 `GitCommitIntent`, binding repo, ref, parent, tree, message, nonce,
            deadline, and signing-key fingerprint.
          </p>
        </div>
        <div className="panel">
          <h2>Threshold signature</h2>
          <p className="muted">
            A 2-of-3 FROST Ed25519 quorum produced the OpenSSH `SSHSIG` embedded in the commit's `gpgsig` header.
          </p>
        </div>
        <div className="panel">
          <h2>GitHub verification</h2>
          <p className="muted">
            GitHub's Verified badge confirms the SSH signature. The `safe-git-verify` check confirms the matching Safe
            approval.
          </p>
        </div>
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Hashes</h2>
          <table className="table">
            <tbody>
              {receipt.githubHtmlUrl ? (
                <tr>
                  <th>Commit URL</th>
                  <td className="mono">
                    <a href={receipt.githubHtmlUrl} rel="noreferrer" target="_blank">
                      {receipt.githubHtmlUrl}
                    </a>
                  </td>
                </tr>
              ) : null}
              <tr>
                <th>Intent</th>
                <td className="mono">{receipt.intentHash}</td>
              </tr>
              <tr>
                <th>Safe message</th>
                <td className="mono">{receipt.safeMessageHash}</td>
              </tr>
              <tr>
                <th>Signed payload</th>
                <td className="mono">{receipt.signedCommitPayloadSha256}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Checks</h2>
          <table className="table">
            <tbody>
              {receipt.verifyResult.checks.map((check) => (
                <tr key={check.name}>
                  <td>{check.name}</td>
                  <td>
                    <span className={check.passed ? "status" : "status fail"}>{check.passed ? "pass" : "fail"}</span>
                  </td>
                  <td className="muted">{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
