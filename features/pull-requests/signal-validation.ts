import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { GitHubSignal } from "./server-types.js";
import type { PullRequestValidationDemand, PullRequestValidationDemands } from "./schemas.js";
import { sameValidationDemand } from "./observations.js";

type SignalGroup = "checks" | "review" | "mergeability";
type Receipt = { group: SignalGroup; demand: PullRequestValidationDemand; sequence: number };
export type PendingSignalValidation = Promise<GitHubSignal | null> & { receipts?: Receipt[]; admitted?: Receipt[] };
export type SignalDemands = PullRequestValidationDemands[string];
const MAX_CLIENTS_PER_GROUP = 32;
const groups: SignalGroup[] = ["checks", "review", "mergeability"];

function satisfied(signal: GitHubSignal | null | undefined, group: SignalGroup, demand: PullRequestValidationDemand) {
  return signal?.observations?.[group]?.satisfies?.some((proof) => sameValidationDemand(proof, demand)) ?? false;
}
function superseded(signal: GitHubSignal | null | undefined, group: SignalGroup, demand: PullRequestValidationDemand) {
  return signal?.observations?.[group]?.satisfies?.some((proof) => proof.client === demand.client && proof.occurrence > demand.occurrence) ?? false;
}
function scopeMatches(key: string, group: SignalGroup, demand: PullRequestValidationDemand) {
  try {
    const fingerprint = JSON.parse(demand.fingerprint) as unknown;
    return Array.isArray(fingerprint) && fingerprint[0] === key && fingerprint[1] === group;
  } catch { return false; }
}
function demandSatisfied(signal: GitHubSignal | null | undefined, demand: SignalDemands | undefined) {
  return groups.every((group) => !demand?.[group] || satisfied(signal, group, demand[group]!) || superseded(signal, group, demand[group]!));
}
function addReceipts(pending: PendingSignalValidation, cached: GitHubSignal | undefined,
  key: string, demand: SignalDemands | undefined, lifecycle: ServerLifecycle, receivedSequence?: number) {
  const receipts = pending.receipts ??= [];
  for (const group of groups) {
    const requested = demand?.[group];
    if (!requested || satisfied(cached, group, requested) || superseded(cached, group, requested)) continue;
    if (!scopeMatches(key, group, requested)) throw new Error("Invalid PR observation demand scope.");
    const existing = receipts.find((entry) => entry.group === group && entry.demand.client === requested.client);
    if (existing && (sameValidationDemand(existing.demand, requested) || existing.demand.occurrence > requested.occurrence)) continue;
    if (existing) receipts.splice(receipts.indexOf(existing), 1);
    if (receipts.filter((entry) => entry.group === group).length >= MAX_CLIENTS_PER_GROUP)
      throw new Error("PR validation capacity reached.");
    receipts.push({ group, demand: requested, sequence: receivedSequence ?? lifecycle.nextObservationSequence() });
  }
}

function withProofs(signal: GitHubSignal, previous: GitHubSignal | undefined, receipts: Receipt[], lifecycle: ServerLifecycle) {
  const observations = { ...signal.observations };
  for (const group of groups) {
    const observation = observations[group];
    if (!observation) continue;
    const previousObservation = previous?.observations?.[group];
    const canRetainProofs = previousObservation?.epoch === observation.epoch
      && observation.sequence !== undefined && previousObservation?.sequence !== undefined
      && observation.sequence >= previousObservation.sequence;
    const proofs = canRetainProofs ? [...(previousObservation?.satisfies ?? [])] : [];
    for (const receipt of receipts) {
      if (receipt.group !== group || observation.epoch !== lifecycle.observationEpoch || !observation.headSha
        || observation.sequence === undefined || observation.sequence <= receipt.sequence) continue;
      const previousClient = proofs.findIndex((proof) => proof.client === receipt.demand.client);
      if (previousClient >= 0) proofs.splice(previousClient, 1);
      proofs.push(receipt.demand);
    }
    observations[group] = { ...observation, ...(proofs.length ? { satisfies: proofs.slice(-MAX_CLIENTS_PER_GROUP) } : {}) };
    if (group === "checks" && observations.checkCounts?.sequence === observation.sequence
      && observations.checkCounts?.epoch === observation.epoch && observations.checkCounts)
      observations.checkCounts = { ...observations.checkCounts, satisfies: observations.checks!.satisfies };
  }
  return { ...signal, observations };
}

/** Pending coordination and proof metadata live in the existing factory caches. */
export async function readSignalObservations(input: {
  owner: string; repo: string; numbers: readonly number[]; lifecycle: ServerLifecycle;
  demands: Readonly<Record<number, SignalDemands>>;
  receivedSequence?: number;
  load(numbers: number[], afterSequence?: number): Promise<Map<number, GitHubSignal>>;
}) {
  const { lifecycle, demands } = input;
  const repository = `${input.owner}/${input.repo}`.toLowerCase();
  const generation = lifecycle.remoteGeneration(repository);
  const assertCurrent = () => {
    if (lifecycle.isDisposed || lifecycle.remoteGeneration(repository) !== generation)
      throw new Error("GitHub signals changed during the read.");
  };
  const keyFor = (number: number) => `${repository}#${number}`;
  const result = new Map<number, GitHubSignal>();
  const owned: number[] = [];
  const waits: Array<{ number: number; pending: PendingSignalValidation }> = [];
  const completions = new Map<number, (signal: GitHubSignal | null) => void>();
  const reservations = new Map<number, PendingSignalValidation>();
  for (const number of [...new Set(input.numbers)].filter((value) => Number.isInteger(value) && value > 0)) {
    const key = keyFor(number);
    const cached = lifecycle.githubPullRequestSignalCache.get(key);
    if (cached && cached.expiresAt > Date.now() && input.receivedSequence !== undefined && demands[number]) {
      const admission: PendingSignalValidation = Promise.resolve(cached.value);
      addReceipts(admission, cached.value, key, demands[number], lifecycle, input.receivedSequence);
      const proved = withProofs(cached.value, cached.value, admission.receipts ?? [], lifecycle);
      if (demandSatisfied(proved, demands[number])) {
        // Only proof metadata changes. A cache reuse never renews validation/TTL.
        lifecycle.cacheGitHubPullRequestSignal(key, proved, cached.expiresAt);
        result.set(number, proved); continue;
      }
    }
    if (cached && cached.expiresAt > Date.now() && demandSatisfied(cached.value, demands[number])) {
      result.set(number, cached.value); continue;
    }
    let pending = lifecycle.githubPullRequestSignalPending.get(key);
    if (pending) {
      addReceipts(pending, cached?.value, key, demands[number], lifecycle, input.receivedSequence);
      waits.push({ number, pending }); continue;
    }
    if (lifecycle.githubPullRequestSignalPending.size >= 300) throw new Error("PR validation capacity reached.");
    pending = new Promise<GitHubSignal | null>((resolve) => { completions.set(number, resolve); });
    addReceipts(pending, cached?.value, key, demands[number], lifecycle, input.receivedSequence);
    reservations.set(number, pending); owned.push(number);
    lifecycle.githubPullRequestSignalPending.set(key, pending);
  }
  if (owned.length) {
    try {
      // Concurrent consumers reserve before the batch is admitted. Demands
      // received after admission join one successor after this read settles.
      await Promise.resolve(); assertCurrent();
      const receipts = owned.flatMap((number) => {
        const pending = reservations.get(number)!;
        pending.admitted = [...(pending.receipts ?? [])];
        return pending.admitted;
      });
      const bound = receipts.length ? Math.max(...receipts.map((receipt) => receipt.sequence)) : undefined;
      const loaded = await input.load(owned, bound);
      assertCurrent();
      for (const number of owned) {
        const signal = loaded.get(number);
        if (!signal) continue;
        const key = keyFor(number);
        const previous = lifecycle.githubPullRequestSignalCache.get(key)?.value;
        const observed = withProofs(signal, previous, reservations.get(number)!.admitted ?? [], lifecycle);
        result.set(number, observed);
        const validation = observed.observations?.checks?.validatedAt;
        lifecycle.cacheGitHubPullRequestSignal(key, observed,
          Math.min(Date.now() + 20_000, validation == null ? Infinity : validation + 120_000));
      }
    } finally {
      for (const number of owned) {
        completions.get(number)!(result.get(number) ?? null);
        const key = keyFor(number);
        if (lifecycle.githubPullRequestSignalPending.get(key) === reservations.get(number)) lifecycle.releasePending("pullRequestSignal", key);
      }
    }
  }
  await Promise.all(waits.map(async ({ number, pending }) => {
    const signal = await pending;
    assertCurrent();
    const currentDemand = demands[number];
    const wasAdmitted = groups.every((group) => !currentDemand?.[group]
      || satisfied(signal, group, currentDemand[group]!)
      || superseded(signal, group, currentDemand[group]!)
      || pending.receipts?.some((receipt) => receipt.group === group && receipt.demand.client === currentDemand[group]!.client
        && receipt.demand.occurrence > currentDemand[group]!.occurrence)
      || pending.admitted?.some((receipt) => receipt.group === group && sameValidationDemand(receipt.demand, currentDemand[group]!)));
    if (!wasAdmitted) {
      const successor = await readSignalObservations({ ...input, numbers: [number] });
      const newer = successor.get(number); if (newer) result.set(number, newer);
    } else if (signal) result.set(number, signal);
  }));
  assertCurrent();
  if (input.numbers.some((number) => demands[number] && !result.has(number)))
    throw new Error("Pull request validation is unavailable. Retry the operation.");
  return result;
}
