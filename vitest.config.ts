import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "mediapipe/**", "reference-algorithms/**", "src-tauri/**"],
  },
});
