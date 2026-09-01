// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { dispatchHrefClickWithoutJsdomNavigation } from "./dispatch-href-click";

afterEach(() => document.body.replaceChildren());

describe("dispatchHrefClickWithoutJsdomNavigation", () => {
  it("fails when the event cannot reach its document guard and removes that guard", () => {
    const link = document.createElement("a");
    document.body.append(link);
    expect(() => dispatchHrefClickWithoutJsdomNavigation(link, new MouseEvent("click", { cancelable: true }))).toThrow("did not reach");
    expect(() => dispatchHrefClickWithoutJsdomNavigation(link)).not.toThrow();
  });
});
