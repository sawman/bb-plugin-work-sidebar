import { Icon } from "./icon";
import type { StatusPresentation } from "../../features/pull-requests/presentation";

export function Status({ presentation, className }: { presentation: StatusPresentation; className?: string }) {
  return <span className={["ws-status", className].filter(Boolean).join(" ")} data-tone={presentation.tone} title={presentation.label} aria-label={presentation.label}>
    <Icon name={presentation.icon} aria-hidden />
    {presentation.overlayIcon && <Icon name={presentation.overlayIcon} aria-hidden />}
    {presentation.count ? <b aria-hidden>{presentation.count}</b> : null}
  </span>;
}
