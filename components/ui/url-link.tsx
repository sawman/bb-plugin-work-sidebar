import * as BbApp from "@get-bb/plugin-sdk/app";
import type { UrlLinkProps } from "@get-bb/plugin-sdk/app";

// Direct component tests can intentionally mock only selected SDK exports.
// The real host always supplies UrlLink before evaluating the plugin bundle.
const SemanticUrlLink = Object.prototype.hasOwnProperty.call(BbApp, "UrlLink")
  ? BbApp.UrlLink ?? "a"
  : "a";

export function BbUrlLink(props: UrlLinkProps) {
  return <SemanticUrlLink {...props} />;
}
