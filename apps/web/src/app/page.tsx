import Link from "next/link";
import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const store = await getRuntimeStore();
  const proposal = await seedDemoState(store);
  const receipt = await store.getReceipt(proposal.id);
  return (
    <>
      <section className="band">
        <p className="kicker">Protected path</p>
        <h1>Safe-approved, threshold-signed Git commits.</h1>
        <p className="lead">
          Safe owners approve an EIP-712 commit intent on-chain; a FROST Ed25519 quorum then emits the Git SSH
          signature that GitHub can verify.
        </p>
      </section>

      <section className="grid">
        <div className="panel">
          <h3>Safe proof</h3>
          <div className="metric">
            {proposal.safeProof.approvalStatus === "onchain_approved"
              ? "On-chain"
              : proposal.safeProof.approvalStatus === "dev_approved"
                ? "Ready"
                : "Waiting"}
          </div>
          <p className="muted mono">{proposal.safeProof.safeMessageHash}</p>
          <p className="muted">
            {proposal.safeProof.threshold ?? 2} of {proposal.safeProof.totalOwners ?? 3} Safe owners on Sepolia.
          </p>
        </div>
        <div className="panel">
          <h3>Signer quorum</h3>
          <div className="metric">2 / 3</div>
          <p className="muted">Threshold signer nodes run outside Vercel; the web app never stores shares.</p>
        </div>
        <div className="panel">
          <h3>Verification</h3>
          <div className="metric">{receipt?.verifyResult.ok ? "Pass" : "Pending"}</div>
          <p className="muted">GitHub verifies the SSH signature; SafeGit verifies the matching Safe approval.</p>
        </div>
      </section>

      <section className="band">
        <h2>What the signature means</h2>
        <p className="lead">
          The Safe does not directly sign the Git object. The Safe approves the exact commit intent, and the
          Safe-governed FROST SSH key signs the Git payload, giving a replay-resistant Safe proof plus GitHub's native
          Verified commit UX.
        </p>
      </section>

      <section className="band">
        <h2>Active proposal</h2>
        <table className="table">
          <tbody>
            <tr>
              <th>Proposal</th>
              <td>
                <Link href={`/proposals/${proposal.id}`}>{proposal.id}</Link>
              </td>
            </tr>
            <tr>
              <th>Repository</th>
              <td className="mono">
                {proposal.intent.repoOwner}/{proposal.intent.repoName} {proposal.intent.targetRef}
              </td>
            </tr>
            <tr>
              <th>Status</th>
              <td>
                <span className="status">{proposal.status}</span>
              </td>
            </tr>
            <tr>
              <th>Receipt</th>
              <td>
                <Link href={`/proposals/${proposal.id}/receipt`}>Open receipt</Link>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
