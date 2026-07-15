import type { ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const isolatedHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

function crossOriginPolicyPlugin() {
  return {
    name: "cross-origin-policy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((_req, res, next) => {
        for (const [name, value] of Object.entries(isolatedHeaders)) {
          res.setHeader(name, value);
        }
        next();
      });
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use((_req, res: Pick<ServerResponse, "setHeader">, next) => {
        for (const [name, value] of Object.entries(isolatedHeaders)) {
          res.setHeader(name, value);
        }
        next();
      });
    },
  };
}

const TFLITE_WASM_DIR = fileURLToPath(
  new URL("./node_modules/@tensorflow/tfjs-tflite/wasm", import.meta.url),
);

const TFLITE_CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
};

/**
 * Serves/emits the tfjs-tflite WASM runtime under `/tflite/`. The subject
 * detection worker points `setWasmPath` there; the runtime then picks the
 * SIMD/threaded variant itself. The binaries live only in node_modules, so
 * dev serves them via middleware and build emits them into the bundle —
 * nothing is committed to `public/`.
 */
function tfliteRuntimePlugin(): Plugin {
  return {
    name: "tflite-wasm-runtime",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/tflite", (req, res: ServerResponse, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!name || name.includes("/") || name.includes("..")) return next();
        let content: Buffer;
        try {
          content = readFileSync(join(TFLITE_WASM_DIR, name));
        } catch {
          return next();
        }
        const ext = name.slice(name.lastIndexOf("."));
        res.setHeader("Content-Type", TFLITE_CONTENT_TYPES[ext] ?? "application/octet-stream");
        res.end(content);
      });
    },
    generateBundle() {
      for (const name of readdirSync(TFLITE_WASM_DIR)) {
        this.emitFile({
          type: "asset" as const,
          fileName: `tflite/${name}`,
          source: readFileSync(join(TFLITE_WASM_DIR, name)),
        });
      }
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appPlatform = process.env.VITE_APP_PLATFORM ?? env.VITE_APP_PLATFORM;
  const isTauriBuild = appPlatform === "tauri";

  return {
    plugins: [react(), crossOriginPolicyPlugin(), tfliteRuntimePlugin()],
    base: isTauriBuild ? "./" : "/",
    worker: {
      format: "es",
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
