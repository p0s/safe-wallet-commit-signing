import { seedDemoState } from "@/lib/demoData";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const store = await getRuntimeStore();
  const proposal = await seedDemoState(store);
  return (
    <>
      <section className="band">
        <p className="kicker">Admin</p>
        <h1>Signing policies.</h1>
      </section>
      <div className="panel">
        <table className="table">
          <tbody>
            <tr>
              <th>Policy</th>
              <td className="mono">{proposal.intent.policyId}</td>
            </tr>
            <tr>
              <th>Safe</th>
              <td className="mono">{proposal.safeProof.safeAddress}</td>
            </tr>
            <tr>
              <th>Threshold</th>
              <td>2 of 3</td>
            </tr>
            <tr>
              <th>Force push</th>
              <td>disabled</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
