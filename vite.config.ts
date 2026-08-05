import type { ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(rootDir, "public");
const packageJson = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8"),
) as { version: string };

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
      ...(omitModelsFromTauriBuild ? [tauriPublicAssetsPlugin()] : []),
    ],
    base: isTauriBuild ? "./" : "/",
    define: {
      __OPEN_CLIPPER_MODELS_CDN_BASE__: JSON.stringify(modelsCdnBase),
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
    },
    publicDir: omitModelsFromTauriBuild ? false : undefined,
    optimizeDeps: {
      entries: [join(rootDir, "index.html")],
    },
    build: {
      rollupOptions: {
        input: join(rootDir, "index.html"),
      },
    },
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
        ignored: ["**/src-tauri/**", "**/reference-algorithms/**"],
      },
    },
  };
});
