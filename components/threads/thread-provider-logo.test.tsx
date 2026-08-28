// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadProviderLogo, type ThreadProvider } from "./thread-provider-logo";

const provider: ThreadProvider = {
  id: "codex",
  displayName: "Codex",
  logoUrl: "/api/v1/system/providers/codex/logo",
};

function renderLogo(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ThreadProviderLogo providerId="codex" provider={provider} />
    </QueryClientProvider>,
  );
}

function providerLogoMask(container: HTMLElement): string | undefined {
  return container
    .querySelector<HTMLElement>(".ws-thread-provider-mark")
    ?.style.getPropertyValue("--ws-thread-provider-logo");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadProviderLogo immutable asset cache", () => {
  it("renders file-backed provider artwork as a theme-aware mask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () =>
          new Blob(["<svg xmlns='http://www.w3.org/2000/svg' />"], {
            type: "image/svg+xml",
          }),
      })),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const view = renderLogo(client);
    const providerIcon = view.getByRole("img", { name: "Codex provider" });
    await waitFor(() =>
      expect(providerIcon.querySelector(".ws-thread-provider-mark")).toBeTruthy(),
    );
    expect(providerIcon.querySelector("img")).toBeNull();
    expect(providerLogoMask(providerIcon)).toMatch(
      /^url\("data:image\/svg\+xml/,
    );
  });

  it("fetches one logo asset across component remounts", async () => {
    const fetchLogo = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () =>
        new Blob(["<svg xmlns='http://www.w3.org/2000/svg' />"], {
          type: "image/svg+xml",
        }),
    }));
    vi.stubGlobal("fetch", fetchLogo);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const active = renderLogo(client);
    await waitFor(() =>
      expect(
        providerLogoMask(
          active.getByRole("img", { name: "Codex provider" }),
        ),
      ).toMatch(/^url\("data:image\/svg\+xml/),
    );
    active.unmount();

    const archived = renderLogo(client);
    await waitFor(() =>
      expect(
        providerLogoMask(
          archived.getByRole("img", { name: "Codex provider" }),
        ),
      ).toMatch(/^url\("data:image\/svg\+xml/),
    );
    expect(fetchLogo).toHaveBeenCalledTimes(1);
    expect(fetchLogo).toHaveBeenCalledWith(provider.logoUrl, {
      credentials: "same-origin",
    });
  });

  it("starts a fresh immutable cache with a new app generation", async () => {
    const fetchLogo = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["logo"], { type: "image/svg+xml" }),
    }));
    vi.stubGlobal("fetch", fetchLogo);

    for (const client of [new QueryClient(), new QueryClient()]) {
      const view = renderLogo(client);
      await waitFor(() =>
        expect(
          providerLogoMask(view.getByRole("img", { name: "Codex provider" })),
        ).toMatch(/^url\("data:image\/svg\+xml/),
      );
      view.unmount();
    }
    expect(fetchLogo).toHaveBeenCalledTimes(2);
  });
});
