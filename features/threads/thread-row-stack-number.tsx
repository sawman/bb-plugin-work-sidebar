import { StackNumberBadge } from "../pull-requests/stack-number";

/** Presentation-only: the sidebar roster owns the one shared stack directory. */
export function ThreadRowStackNumber({ number }: { number: number | null }) {
  return number == null ? null : <StackNumberBadge number={number} compact />;
}
