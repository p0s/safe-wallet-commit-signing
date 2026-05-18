import Link from "next/link";
import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const store = await getRuntimeStore();
  const proposal = await seedDemoState(store);
  return (
    <>
      <section className="band">
        <p className="kicker">Repositories</p>
        <h1>Allowlisted repositories.</h1>
      </section>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Ref</th>
              <th>Policy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Link href={`/repos/${proposal.intent.repoOwner}/${proposal.intent.repoName}`}>
                  {proposal.intent.repoOwner}/{proposal.intent.repoName}
                </Link>
              </td>
              <td className="mono">{proposal.intent.targetRef}</td>
              <td className="mono">{proposal.intent.policyId}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
