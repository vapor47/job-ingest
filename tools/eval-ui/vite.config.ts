import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { evalApiPlugin } from "./api-plugin.ts";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), evalApiPlugin()],
});
