import type { GitHubApiRunner } from "./server-types.js";
import type { PullRequestObservation } from "./schemas.js";

/** A runner without evidence is honestly unknown (including injected adapters). */
export async function readObservedGitHub(
  run: GitHubApiRunner, args: readonly string[], maxBuffer: number, afterSequence?: number,
) {
  let validatedAt: number | null = null;
  let sequence: number | undefined;
  const text = await run(args, maxBuffer, { afterSequence, onValidation: (value, observedSequence) => { validatedAt = value; sequence = observedSequence; } });
  return { text, validatedAt, sequence };
}

export function githubObservation(value: Record<string, unknown>, validatedAt: number | null): PullRequestObservation {
  const head = value.head as { sha?: unknown; ref?: unknown } | undefined;
  const base = value.base as { sha?: unknown; ref?: unknown } | undefined;
  const headSha = value.headRefOid ?? head?.sha;
  const baseSha = value.baseRefOid ?? base?.sha;
  const updatedAt = value.updatedAt ?? value.updated_at;
  const headRef = value.headRefName ?? head?.ref;
  const baseRef = value.baseRefName ?? base?.ref;
  return { source: "github", validatedAt,
    ...(typeof updatedAt === "string" ? { updatedAt } : {}),
    headSha: typeof headSha === "string" ? headSha : null,
    baseSha: typeof baseSha === "string" ? baseSha : null,
    ...(typeof headRef === "string" ? { headRef } : {}),
    ...(typeof baseRef === "string" ? { baseRef } : {}),
  };
}
