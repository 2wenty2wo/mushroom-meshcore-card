import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The cards are plain custom elements rendering into shadow DOM;
    // happy-dom provides that without a full browser or HA frontend.
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
  },
});
