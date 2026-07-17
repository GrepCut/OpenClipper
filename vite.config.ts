import type { ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(rootDir, "public");

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

/**
 * Wydanie desktopowe pobiera modele przez grepcut-models do cache aplikacji.
 * Pomijamy więc public/models podczas produkcyjnego builda Tauri, ale nadal
 * emitujemy pozostałe statyczne assety (logo, ikony platform itp.).
 */
function tauriPublicAssetsPlugin(): Plugin {
  const emitDirectory = (
    pluginContext: Parameters<NonNullable<Plugin["buildStart"]>>[0],
    directory: string,
    relativePath = "",
  ) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const assetPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const sourcePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        emitDirectory(pluginContext, sourcePath, assetPath);
      } else if (entry.isFile()) {
        pluginContext.emitFile({
          type: "asset",
          fileName: assetPath,
          source: readFileSync(sourcePath),
        });
      }
    }
  };

  return {
    name: "tauri-public-assets-without-models",
    buildStart() {
      for (const entry of readdirSync(PUBLIC_DIR, { withFileTypes: true })) {
        if (entry.name === "models") continue;
        const sourcePath = join(PUBLIC_DIR, entry.name);
        if (entry.isDirectory()) {
          emitDirectory(this, sourcePath, entry.name);
        } else if (entry.isFile()) {
          this.emitFile({
            type: "asset",
            fileName: entry.name,
            source: readFileSync(sourcePath),
          });
        }
      }
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appPlatform = process.env.VITE_APP_PLATFORM ?? env.VITE_APP_PLATFORM;
  const isTauriBuild = appPlatform === "tauri";
  const omitModelsFromTauriBuild = command === "build" && isTauriBuild;
  const modelsCdnBase = (
    env.OPEN_CLIPPER_MODELS_CDN_BASE
    || env.VITE_OPEN_CLIPPER_MODELS_CDN_BASE
    || "https://models.openclipper.grepcut.com/v1"
  ).replace(/\/+$/, "");

  return {
    plugins: [
      react(),
      crossOriginPolicyPlugin(),
      tfliteRuntimePlugin(),
      ...(omitModelsFromTauriBuild ? [tauriPublicAssetsPlugin()] : []),
    ],
    base: isTauriBuild ? "./" : "/",
    define: {
      __OPEN_CLIPPER_MODELS_CDN_BASE__: JSON.stringify(modelsCdnBase),
    },
    publicDir: omitModelsFromTauriBuild ? false : undefined,
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
