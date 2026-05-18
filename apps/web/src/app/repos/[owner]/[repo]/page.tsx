import Link from "next/link";
import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

export default async function RepoPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const resolvedParams = await params;
  const store = await getRuntimeStore();
  const proposal = await seedDemoState(store);
  return (
    <>
      <section className="band">
        <p className="kicker">Repository policy</p>
        <h1>
          {resolvedParams.owner}/{resolvedParams.repo}
        </h1>
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Policy</h2>
          <table className="table">
            <tbody>
              <tr>
                <th>Target ref</th>
                <td className="mono">{proposal.intent.targetRef}</td>
              </tr>
              <tr>
                <th>Safe</th>
                <td className="mono">{proposal.safeProof.safeAddress}</td>
              </tr>
              <tr>
                <th>Signing key</th>
                <td className="mono">{proposal.intent.signingKeySshFingerprintSha256}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Proposals</h2>
          <p>
            <Link href={`/proposals/${proposal.id}`}>{proposal.id}</Link>
          </p>
          <p className="muted">{proposal.commitMessage}</p>
        </div>
      </section>
    </>
  );
}
