import { Icon } from "../../components/ui/icon";
import { CopyBadge } from "../../components/ui/copy-badge";

export function StackNumberBadge({
  number,
  compact = false,
}: {
  number: number;
  compact?: boolean;
}) {
  return (
    <CopyBadge
      value={`#${number}`}
      copyValue={`Stack #${number}`}
      label="stack number"
      className={`ws-stack-number${compact ? " ws-stack-number-compact" : ""}`}
      tooltip={false}
    >
      <Icon name="Layers" aria-hidden />
      <span aria-hidden>{`#${number}`}</span>
    </CopyBadge>
  );
}
