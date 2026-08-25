import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * The original backend is being recovered from BB's local event history.
 * Thread archive/delete remain host-owned actions in the app surface so they
 * retain BB's recursive lifecycle semantics while recovery is in progress.
 */
export default async function plugin(bb: BbPluginApi): Promise<void> {
  bb.log.info("Work Sidebar recovery backend loaded");
}
