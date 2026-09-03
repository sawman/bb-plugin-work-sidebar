import type { ReactElement } from "react";

type DeltaKind = "additions" | "deletions";

export function ChangeLineDelta({
  kind,
  value,
  className,
}: {
  kind: DeltaKind;
  value: number | null;
  className?: string;
}): ReactElement {
  const label = value === null
    ? undefined
    : `${value} ${value === 1 ? "line" : "lines"} ${
      kind === "additions" ? "added" : "deleted"
    }`;
  const sign = kind === "additions" ? "+" : "−";
  return (
    <span
      className={`ws-line-delta ws-line-delta-${kind}${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-hidden={value === null ? true : undefined}
    >
      {value === null ? "" : `${sign}${value}`}
    </span>
  );
}

/** Shared presentation for every added/removed-line summary in Changes. */
export function ChangeLineDeltas({
  additions,
  deletions,
  className,
}: {
  additions: number | null;
  deletions: number | null;
  className?: string;
}): ReactElement {
  return (
    <span className={`ws-line-deltas${className ? ` ${className}` : ""}`}>
      <ChangeLineDelta kind="additions" value={additions} />
      <ChangeLineDelta kind="deletions" value={deletions} />
    </span>
  );
}
