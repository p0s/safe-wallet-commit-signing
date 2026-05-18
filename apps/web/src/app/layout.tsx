import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeGit Threshold",
  description: "Safe-approved, threshold-signed Git commits"
};

const nav: Array<[string, string]> = [
  ["/", "Dashboard"],
  ["/setup", "Setup"],
  ["/repos", "Repos"],
  ["/proposals/new", "New Proposal"],
  ["/admin/signers", "Signers"],
  ["/admin/policies", "Policies"]
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              SafeGit Threshold
              <small>Safe-approved threshold SSH signing</small>
            </Link>
            <nav className="nav" aria-label="Primary navigation">
              {nav.map(([href, label]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
