import type { BbPluginApi } from "@get-bb/plugin-sdk";

type ExpireRecycleBin = (input: { retentionDays: number }) => unknown | Promise<unknown>;

/** Token-authenticated endpoint for an explicitly configured BB automation. */
export function registerRecycleBinExpiryRoute(
  bb: BbPluginApi,
  expire: ExpireRecycleBin,
) {
  bb.http.route(
    "POST",
    "/recycle-bin/expire",
    async (context) => {
      const body = await context.req.json().catch(() => null);
      const retentionDays =
        body && typeof body === "object" ? Reflect.get(body, "retentionDays") : null;
      if (
        typeof retentionDays !== "number" ||
        !Number.isInteger(retentionDays) ||
        retentionDays < 1 ||
        retentionDays > 3_650
      )
        return Response.json(
          { error: "retentionDays must be an integer from 1 to 3650." },
          { status: 400 },
        );
      try {
        return Response.json(await expire({ retentionDays }));
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    },
    { auth: "token" },
  );
}
