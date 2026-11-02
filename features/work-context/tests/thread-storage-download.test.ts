import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../server";

const fileBytes = Buffer.from([0, 255, 13, 10, 128]);
const fileResult = (bytes = fileBytes, contentEncoding: "base64" | "utf8" = "base64") => ({
  path: "/private/root/report.bin", content: bytes.toString(contentEncoding === "base64" ? "base64" : "utf8"),
  contentEncoding, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
});
const activeHosts: ReturnType<typeof createFakePluginHost>[] = [];
async function mount(root = "/private/root") {
  const storageLocation = vi.fn().mockResolvedValue({ hostId: "host_remote", storageRootPath: root });
  const read = vi.fn().mockResolvedValue(fileResult());
  const host = createFakePluginHost({ pluginId: "work-sidebar", sdk: { threads: { storageLocation }, files: { read } } });
  activeHosts.push(host);
  await plugin(host.bb);
  const download = (threadId = "thr_a", path = "docs/report.bin") => host.harness.behavior.fetchHttp("GET", `/thread-storage/download?${new URLSearchParams({ threadId, path })}`);
  return { host, download, storageLocation, read };
}

describe("registered thread-storage download route", () => {
  afterEach(async () => { await Promise.all(activeHosts.splice(0).map((host) => host.harness.lifecycle.dispose())); });

  it("serves exact binary bytes as a local-auth attachment from the selected thread's remote host", async () => {
    const { host, download, read, storageLocation } = await mount();
    const response = await download("thr_b", "docs/财务 #1?.bin");
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fileBytes);
    expect(storageLocation).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_b", signal: expect.any(AbortSignal) });
    expect(read).toHaveBeenCalledExactlyOnceWith({ hostId: "host_remote", rootPath: "/private/root", path: "/private/root/docs/财务 #1?.bin", signal: expect.any(AbortSignal) });
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''%E8%B4%A2%E5%8A%A1%20%231%3F.bin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(host.harness.inspection.registrations.httpRoutes).toContainEqual(expect.objectContaining({ method: "GET", path: "/thread-storage/download", auth: "local" }));
  });

  it("preserves UTF-8 bytes and uses the remote Windows path flavor", async () => {
    const { download, read } = await mount("C:\\threads\\root");
    const bytes = Buffer.from("Résumé\r\n你好\n");
    read.mockResolvedValue(fileResult(bytes, "utf8"));
    const response = await download("thr_a", "docs/text.txt");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(read.mock.calls[0]![0]).toMatchObject({ hostId: "host_remote", rootPath: "C:\\threads\\root", path: "C:\\threads\\root\\docs\\text.txt" });
  });

  it.each(["../escape", "/absolute", "C:/absolute", "a\\escape", "a/./bad", "bad\u0000", ""])("rejects unsafe path %j before host lookup", async (path) => {
    const { download, read, storageLocation } = await mount();
    expect((await download("thr_a", path)).status).toBe(400);
    expect(storageLocation).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not accept host/root overrides, malformed thread IDs, or missing targets", async () => {
    const { host, storageLocation, read } = await mount();
    for (const query of ["path=ok.txt", "threadId=../bad&path=ok.txt", "threadId=thr_a&path=ok.txt&hostId=host_other", "threadId=thr_a&path=ok.txt&rootPath=/", "threadId=thr_a&path=one&path=two"]) {
      expect((await host.harness.behavior.fetchHttp("GET", `/thread-storage/download?${query}`)).status).toBe(400);
    }
    expect(storageLocation).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("sanitizes missing/offline/oversize/directory/symlink-escape errors and never serves an error as an attachment", async () => {
    const { download, storageLocation, read } = await mount();
    storageLocation.mockRejectedValueOnce(new Error("/private/root unavailable"));
    const unavailable = await download();
    expect(unavailable.status).toBe(502);
    expect(await unavailable.text()).not.toContain("/private");
    expect(read).not.toHaveBeenCalled();
    for (const message of ["ENOENT /private/root", "file_too_large /private/root", "Path is a directory /private/root", "escapes read root /private/root"]) {
      read.mockRejectedValueOnce(new Error(message));
      const response = await download();
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Could not download file");
      expect(response.headers.has("content-disposition")).toBe(false);
    }
  });

  it("refuses inconsistent bytes rather than returning a corrupt download", async () => {
    const { download, read } = await mount();
    read.mockResolvedValueOnce({ ...fileResult(), sizeBytes: 99 });
    expect((await download()).status).toBe(502);
  });
});
