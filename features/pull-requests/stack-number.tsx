import { Icon } from "../../components/ui/icon";

export function StackNumberBadge({
  number,
  compact = false,
  icon = false,
}: {
  number: number;
  compact?: boolean;
  icon?: boolean;
}) {
  const label = `Stack #${number}`;
  return (
    <span
      className={`ws-stack-number${compact ? " ws-stack-number-compact" : ""}`}
      aria-label={label}
      title={label}
    >
      {icon && <Icon name="Layers" aria-hidden />}
      <span aria-hidden>{compact ? `S#${number}` : label}</span>
    </span>
  );
}
