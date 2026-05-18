export default function NewProposalPage() {
  return (
    <>
      <section className="band">
        <p className="kicker">Create proposal</p>
        <h1>Build an exact GitCommitIntent.</h1>
      </section>
      <form className="form" action="/api/proposals" method="post">
        <label>
          Repository owner
          <input name="repoOwner" defaultValue="p0s" />
        </label>
        <label>
          Repository name
          <input name="repoName" defaultValue="safe-wallet-commit-signing" />
        </label>
        <label>
          Target branch
          <input name="targetBranch" defaultValue="main" />
        </label>
        <label>
          Commit message
          <textarea name="commitMessage" defaultValue="Prove Safe-approved threshold signing&#10;" />
        </label>
        <button className="button primary" type="submit">
          Create intent
        </button>
      </form>
    </>
  );
}
