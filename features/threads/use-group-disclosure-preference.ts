import { useCallback } from "react";
import { toast } from "sonner";
import type { SidebarThreadGroupPreferences } from "./model";

type GroupPreferenceMutation = {
  mutateAsync(value: SidebarThreadGroupPreferences): Promise<unknown>;
};

/** Keeps disclosure state durable without leaking a native details event into the controller. */
export function useGroupDisclosurePreference(
  preferences: SidebarThreadGroupPreferences,
  saveGroups: GroupPreferenceMutation,
) {
  return useCallback(
    (id: string, open: boolean) => {
      void saveGroups
        .mutateAsync({
          ...preferences,
          disclosures: { ...(preferences.disclosures ?? {}), [id]: open },
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save thread group state",
          );
        });
    },
    [preferences, saveGroups],
  );
}
