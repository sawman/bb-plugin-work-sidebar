import type { MouseEvent, ReactNode } from "react";
import type { UrlLinkProps } from "@get-bb/plugin-sdk/app";
import { BbUrlLink } from "../../components/ui/url-link";

function isModifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey)
  );
}

function isHttpUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Keeps ordinary PR links under BB's browser preference. When enabled, a
 * Cmd/Ctrl primary click requests a new top-level browsing context; BB desktop
 * handles that request through the operating system browser.
 */
export function PullRequestUrlLink({
  children,
  externalOnModifier = false,
  onClick,
  ...props
}: UrlLinkProps & {
  children: ReactNode;
  externalOnModifier?: boolean;
}) {
  return (
    <BbUrlLink
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          !externalOnModifier ||
          !isModifiedPrimaryClick(event) ||
          !isHttpUrl(props.href)
        )
          return;
        event.preventDefault();
        window.open(props.href, "_blank", "noopener,noreferrer");
      }}
    >
      {children}
    </BbUrlLink>
  );
}
