import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "backend",
          environment: "node",
          include: ["**/*.test.ts"],
        },
      },
      {
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
        },
      },
    ],
  },
});
