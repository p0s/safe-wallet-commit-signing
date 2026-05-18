export default function GitHubInstallPage({ searchParams }: { searchParams?: Record<string, string> }) {
  return (
    <>
      <section className="band">
        <p className="kicker">GitHub App</p>
        <h1>Installation callback captured.</h1>
      </section>
      <div className="panel">
        <table className="table">
          <tbody>
            <tr>
              <th>Installation</th>
              <td className="mono">{searchParams?.installation_id ?? "pending"}</td>
            </tr>
            <tr>
              <th>Setup action</th>
              <td>{searchParams?.setup_action ?? "none"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
