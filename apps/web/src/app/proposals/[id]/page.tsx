import Link from "next/link";
import { notFound } from "next/navigation";
import { seedDemoState } from "@/lib/demoData";
import { isPublicProposalId, publicSafeProof } from "@/lib/publicAccess";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

function explorerBase(chainId: number): string | undefined {
  if (chainId === 11155111) {
    return "https://sepolia.etherscan.io";
  }
  if (chainId === 1) {
    return "https://etherscan.io";
  }
  if (chainId === 100) {
    return "https://gnosisscan.io";
  }
  return undefined;
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  if (!isPublicProposalId(resolvedParams.id)) {
    notFound();
  }
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const proposal = await store.getProposal(resolvedParams.id);
  if (!proposal) {
    notFound();
  }
  const safeProof = publicSafeProof(proposal.safeProof);
  const session = await store.getSession(`sess_${proposal.id}`);
  const explorer = explorerBase(safeProof.chainId);
  return (
    <>
      <section className="band">
        <p className="kicker">Proposal</p>
        <h1>{proposal.id}</h1>
        <p className="lead">{proposal.commitMessage}</p>
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Intent</h2>
          <table className="table">
            <tbody>
              <tr>
                <th>Repo</th>
                <td className="mono">
                  {proposal.intent.repoHost}/{proposal.intent.repoOwner}/{proposal.intent.repoName}
                </td>
              </tr>
              <tr>
                <th>Target ref</th>
                <td className="mono">{proposal.intent.targetRef}</td>
              </tr>
              <tr>
                <th>Parent</th>
                <td className="mono">{proposal.intent.expectedParentOid}</td>
              </tr>
              <tr>
                <th>Tree</th>
                <td className="mono">{proposal.intent.treeOid}</td>
              </tr>
              <tr>
                <th>Nonce</th>
                <td className="mono">{proposal.intent.nonce}</td>
              </tr>
              <tr>
                <th>Key</th>
                <td className="mono">{proposal.intent.signingKeySshFingerprintSha256}</td>
              </tr>
              <tr>
                <th>Deadline</th>
                <td>{proposal.intent.deadlineUnixSeconds}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Proofs</h2>
          <p>
            <span className="status">{safeProof.approvalStatus}</span>
          </p>
          <table className="table compact">
            <tbody>
              <tr>
                <th>Safe</th>
                <td className="mono">
                  {explorer ? (
                    <a href={`${explorer}/address/${safeProof.safeAddress}`} rel="noreferrer" target="_blank">
                      {safeProof.safeAddress}
                    </a>
                  ) : (
                    safeProof.safeAddress
                  )}
                </td>
              </tr>
              <tr>
                <th>Chain</th>
                <td>{safeProof.chainId}</td>
              </tr>
              <tr>
                <th>Owners</th>
                <td>
                  {safeProof.threshold ?? 2} / {safeProof.totalOwners ?? 3}
                </td>
              </tr>
              {safeProof.approvalTxHash ? (
                <tr>
                  <th>Approval</th>
                  <td className="mono">
                    {explorer ? (
                      <a href={`${explorer}/tx/${safeProof.approvalTxHash}`} rel="noreferrer" target="_blank">
                        {safeProof.approvalTxHash}
                      </a>
                    ) : (
                      safeProof.approvalTxHash
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <p className="mono muted">{safeProof.safeMessageHash}</p>
          <p>Signer session: {session?.status ?? "pending"}</p>
          <Link className="button primary" href={`/proposals/${proposal.id}/receipt`}>
            Receipt
          </Link>
        </div>
      </section>
      <section className="band">
        <h2>Diff</h2>
        <pre>{proposal.diffText || "No diff text supplied yet."}</pre>
      </section>
      <section>
        <h2>Typed data</h2>
        <pre>{JSON.stringify(proposal.typedData, null, 2)}</pre>
      </section>
    </>
  );
}
