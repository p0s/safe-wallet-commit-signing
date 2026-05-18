import { sha256Hex, stableStringify } from "./crypto.js";
import type { FileChange, Hex } from "./types.js";

export interface ManifestEntry {
  path: string;
  operation: "upsert" | "delete";
  contentSha256?: Hex;
  contentLength?: number;
}

export function canonicalFileManifest(changes: FileChange[]): ManifestEntry[] {
  return changes
    .map((change) => {
      const content = change.contentBase64
        ? Buffer.from(change.contentBase64, "base64")
        : undefined;
      return {
        path: normalizeManifestPath(change.path),
        operation: change.operation,
        ...(content ? { contentSha256: sha256Hex(content), contentLength: content.byteLength } : {})
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function fileManifestSha256(changes: FileChange[]): Hex {
  return sha256Hex(stableStringify(canonicalFileManifest(changes)));
}

export function normalizeManifestPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/u, "");
  if (!normalized || normalized.includes("..") || normalized.includes("//")) {
    throw new Error(`Unsafe file path in manifest: ${path}`);
  }
  return normalized;
}
