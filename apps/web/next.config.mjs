/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@safe-git/core", "@safe-git/db", "@safe-git/github", "@safe-git/safe", "@safe-git/verifier"]
};

export default nextConfig;
