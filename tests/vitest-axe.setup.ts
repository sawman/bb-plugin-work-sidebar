import "vitest-axe/extend-expect";
import * as matchers from "vitest-axe/matchers";
import { expect } from "vitest";
import type { AxeMatchers } from "vitest-axe/matchers";

// vitest-axe's public extend-expect declaration targets Vitest's legacy `Vi`
// namespace. Vitest 4 exposes the assertion interface from @vitest/expect.
declare module "@vitest/expect" {
  interface Assertion<T = any> extends AxeMatchers {}
}

expect.extend(matchers);
