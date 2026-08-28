import { Icon } from "../../components/ui/icon";

export function StackNumberBadge({
  number,
  compact = false,
}: {
  number: number;
  compact?: boolean;
}) {
  const label = `Stack #${number}`;
  return (
    <span
      className={`ws-stack-number${compact ? " ws-stack-number-compact" : ""}`}
      aria-label={label}
      title={label}
    >
      <Icon name="Layers" aria-hidden />
      <span aria-hidden>{`#${number}`}</span>
    </span>
  );
}
