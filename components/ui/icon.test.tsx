import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon";

describe("Git icon geometry", () => {
  it("keeps branch, merge, and pull-request paths connected to their nodes", () => {
    const branch = renderToStaticMarkup(<Icon name="GitBranch" />);
    const merge = renderToStaticMarkup(<Icon name="GitMerge" />);
    const pullRequest = renderToStaticMarkup(<Icon name="GitPullRequest" />);

    expect(branch).toContain('<circle cx="18" cy="6" r="2"></circle>');
    expect(branch).not.toContain('<circle cx="18" cy="18" r="2"></circle>');
    expect(merge).toContain('<circle cx="18" cy="12" r="2"></circle>');
    expect(merge).toContain('d="M8 6h2a8 8 0 0 1 8 8v-2"');
    expect(merge).toContain('d="M8 18h2a8 8 0 0 0 8-8v2"');
    expect(pullRequest).toContain('<circle cx="18" cy="20" r="2"></circle>');
    expect(pullRequest).toContain('d="M6 6v12m6-14v12a4 4 0 0 0 4 4h2"');
  });
});

describe("status icon geometry", () => {
  it("optically centers the bottom-heavy wrench glyph", () => {
    const wrench = renderToStaticMarkup(<Icon name="Wrench" />);

    expect(wrench).toContain('transform="translate(0 -2)"');
  });
});
