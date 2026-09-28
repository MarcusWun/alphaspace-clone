import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    // CSS files are no-ops in jsdom
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@alpha/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      // Stub CSS imports that vitest can't resolve via the pnpm symlink
      "react-grid-layout/css/styles.css": path.resolve(__dirname, "__mocks__/empty.css"),
      "react-resizable/css/styles.css": path.resolve(__dirname, "__mocks__/empty.css"),
    },
  },
});
