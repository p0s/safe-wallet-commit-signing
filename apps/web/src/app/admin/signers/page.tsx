import { seedDemoState } from "@/lib/demoData";
import type { SignerNodeRecord } from "@safe-git/core";
import { getRuntimeStore } from "@safe-git/db";

export const dynamic = "force-dynamic";

export default async function SignersPage() {
  const store = await getRuntimeStore();
  await seedDemoState(store);
  const signerNodes = await store.listSignerNodes();
  const rows: SignerNodeRecord[] =
    signerNodes.length > 0
      ? signerNodes
      : ["signer-a", "signer-b", "signer-c"].map((id) => ({
          id,
          nodeName: id,
          status: "inactive",
          createdAt: "",
          updatedAt: ""
        }));
  return (
    <>
      <section className="band">
        <p className="kicker">Admin</p>
        <h1>Signer nodes.</h1>
      </section>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Status</th>
              <th>Runtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((node) => (
              <tr key={node.id}>
                <td>{node.nodeName}</td>
                <td>
                  <span className={node.status === "active" ? "status" : "status warn"}>{node.status}</span>
                </td>
                <td>{node.lastSeenAt ? `external, seen ${node.lastSeenAt}` : "external"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
