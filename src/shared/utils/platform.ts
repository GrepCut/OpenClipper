/**
 * Utility to detect the current platform and environment.
 * Supports both runtime detection and build-time flags.
 */

export const isTauriBuild = import.meta.env.VITE_APP_PLATFORM === 'tauri';

/**
 * Returns true if the application is running inside a Tauri container.
 * This works at runtime by checking for Tauri-specific globals.
 */
export const isTauri = (): boolean => {
  if (typeof window === "undefined") return isTauriBuild;
  // Check for Tauri v2/v1 globals or build-time flag
  return (
    isTauriBuild ||
    !!(
      (window as any).__TAURI_INTERNALS__ || 
      (window as any).__TAURI__ ||
      (window as any).__TAURI_METADATA__ ||
      (window as any).ipc
    )
  );
};

/**
 * Returns true if the application is running as a standard web application.
 */
export const isWeb = (): boolean => !isTauri();
