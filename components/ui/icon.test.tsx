import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon";

describe("Git icon geometry", () => {
  it("keeps the branch split and merge join visually distinct", () => {
    const branch = renderToStaticMarkup(<Icon name="GitBranch" />);
    const merge = renderToStaticMarkup(<Icon name="GitMerge" />);

    expect(branch).toContain('<circle cx="18" cy="6" r="2"></circle>');
    expect(branch).not.toContain('<circle cx="18" cy="18" r="2"></circle>');
    expect(merge).toContain('<circle cx="18" cy="12" r="2"></circle>');
    expect(merge).toContain('d="M8 6h2a8 8 0 0 1 8 8v-2"');
    expect(merge).toContain('d="M8 18h2a8 8 0 0 0 8-8v2"');
  });
});
