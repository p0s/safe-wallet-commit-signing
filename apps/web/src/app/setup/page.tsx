import { isProductionLike } from "@/lib/auth";

const required = [
  "GITHUB_APP_ID",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
  "DATABASE_URL",
  "SAFE_GIT_ADMIN_TOKEN",
  "SAFE_ADDRESS",
  "SAFE_CHAIN_ID",
  "SAFE_RPC_URL",
  "SIGNING_KEY_ID",
  "SIGNING_PUBLIC_KEY_FINGERPRINT_SHA256"
];

const exposeSetupStatus = !isProductionLike() || process.env.SAFE_GIT_EXPOSE_SETUP_STATUS === "true";

function statusFor(set: boolean): { className: string; label: string } {
  if (!exposeSetupStatus) {
    return { className: "status", label: "private" };
  }
  return set ? { className: "status", label: "set" } : { className: "status warn", label: "needed" };
}

const alternatives = [
  {
    label: "GitHub App private key",
    set: Boolean(process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || process.env.GITHUB_APP_PRIVATE_KEY),
    names: "GITHUB_APP_PRIVATE_KEY_BASE64 or GITHUB_APP_PRIVATE_KEY"
  },
  {
    label: "Signer authentication",
    set: Boolean(process.env.SIGNER_NODE_KEYS || process.env.SIGNER_COORDINATOR_SHARED_SECRET),
    names: "SIGNER_NODE_KEYS or SIGNER_COORDINATOR_SHARED_SECRET"
  }
];

export default function SetupPage() {
  return (
    <>
      <section className="band">
        <p className="kicker">Setup</p>
        <h1>Vercel coordinator, external signer nodes, Safe on-chain approval.</h1>
        <p className="lead">
          The public demo is read-only and fails closed without secrets. The full production write path requires the
          variables below and signer nodes outside Vercel.
        </p>
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Environment</h2>
          <table className="table">
            <tbody>
              {required.map((name) => (
                <tr key={name}>
                  <td className="mono">{name}</td>
                  <td>
                    <span className={statusFor(Boolean(process.env[name])).className}>
                      {statusFor(Boolean(process.env[name])).label}
                    </span>
                  </td>
                </tr>
              ))}
              {alternatives.map((item) => (
                <tr key={item.label}>
                  <td className="mono">{item.names}</td>
                  <td>
                    <span className={statusFor(item.set).className}>{statusFor(item.set).label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Production boundary</h2>
          <p className="muted">
            `UNSAFE_DEV_SIGNER` is blocked in production. Missing admin, signer, or webhook secrets return 401 instead
            of enabling public writes. Safe approval checks call EIP-1271 with `0x` signatures when `SAFE_RPC_URL` is
            configured.
          </p>
          <p className="muted">
            The included local E2E uses a 2-of-3 FROST Ed25519 aggregate wrapped as Git SSHSIG. Production signer nodes
            should run outside Vercel with encrypted shares from DKG or an audited ceremony and node-specific HMAC auth.
          </p>
        </div>
      </section>
    </>
  );
}
