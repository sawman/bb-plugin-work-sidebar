import type { PullRequestObservation, PullRequestObservations, PullRequestValidationDemand } from "./schemas";

export type ObservationGroup = keyof PullRequestObservations;
export function sameValidationDemand(left: PullRequestValidationDemand, right: PullRequestValidationDemand) {
  return left.client === right.client && left.occurrence === right.occurrence && left.fingerprint === right.fingerprint;
}

/** A PR update version is useful for metadata; CI is independently mutable. */
export function incomingObservationWins(
  previous: PullRequestObservation | undefined,
  incoming: PullRequestObservation | undefined,
  metadata = false,
): boolean {
  if (!previous) return true;
  if (!incoming) return false;
  if (metadata && previous.updatedAt && incoming.updatedAt) {
    const previousVersion = Date.parse(previous.updatedAt);
    const incomingVersion = Date.parse(incoming.updatedAt);
    if (Number.isFinite(previousVersion) && Number.isFinite(incomingVersion)
      && previousVersion !== incomingVersion) return incomingVersion > previousVersion;
  }
  if (previous.source === "native" && incoming.source === "github")
    return Boolean(previous.native && incoming.satisfies?.some((proof) => sameValidationDemand(proof, previous.native!)));
  if (previous.source === "github" && incoming.source === "native")
    return Boolean(incoming.native && !previous.satisfies?.some((proof) => sameValidationDemand(proof, incoming.native!)));
  if (incoming.source === "native")
    return Boolean(incoming.native && (!previous.native || incoming.native.client !== previous.native.client
      || incoming.native.occurrence > previous.native.occurrence));
  if (previous.epoch && incoming.epoch && previous.epoch !== incoming.epoch) return true;
  if (previous.sequence !== undefined && incoming.sequence !== undefined)
    return incoming.sequence > previous.sequence;
  if (previous.validatedAt === null) return incoming.validatedAt !== null;
  return incoming.validatedAt !== null && incoming.validatedAt > previous.validatedAt;
}

export function observationsCompatible(
  previous: PullRequestObservation | undefined,
  incoming: PullRequestObservation | undefined,
  review = false,
): boolean {
  return Boolean(previous && incoming && previous.headSha && incoming.headSha
    && previous.headSha === incoming.headSha && previous.baseSha && incoming.baseSha
    && previous.baseSha === incoming.baseSha
    && (!review || previous.reviewIdentity && previous.reviewIdentity === incoming.reviewIdentity));
}

export function observationValidationTime(observations: PullRequestObservations | undefined) {
  const times = Object.values(observations ?? {}).flatMap((observation) =>
    observation?.validatedAt === null || observation?.validatedAt === undefined ? [] : [observation.validatedAt]);
  return times.length ? Math.max(...times) : null;
}
