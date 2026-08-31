import type { BbPluginApi } from "@get-bb/plugin-sdk";

export function registerThreadSettings(bb: BbPluginApi) {
  bb.settings.define({
    stuckThreadMinutes: {
      type: "select",
      label: "Stuck thread timeout",
      description: "Show a clock when active work has produced no update for this long.",
      options: ["15", "30", "45", "60", "120"],
      default: "30",
    },
  });
}
