import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
        test: {
          name: "backend",
          environment: "node",
          include: ["**/*.test.ts"],
        },
      },
      {
        resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          setupFiles: ["./tests/vitest-axe.setup.ts"],
        },
      },
    ],
  },
});
