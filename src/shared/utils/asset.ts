/**
 * Resolves a path to a static file in `public/` against the app's deploy base.
 *
 * Vite only rewrites *imported* assets with `import.meta.env.BASE_URL`; hardcoded
 * root-absolute strings like `/01grepcut.webp` are left untouched and break when
 * the app is served under a sub-path (e.g. grepcut.com/studio). This prefixes them.
 *
 * Behavior is unchanged for root web builds (`base "/"`) and Tauri (`base "./"`):
 * only true sub-path deploys like `/studio/` get rewritten.
 */
export function asset(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = import.meta.env.BASE_URL;
  if (base && base.startsWith("/") && base !== "/") {
    return base.replace(/\/$/, "") + p;
  }
  return p;
}
