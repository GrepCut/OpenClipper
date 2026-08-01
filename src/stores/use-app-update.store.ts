import { create } from "zustand";
import { toaster } from "../shared/components/ui/toaster.component";
import { isTauri } from "../shared/utils/platform.util";

type AppUpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installing"
  | "disabled"
  | "error";

interface UpdateMetadata {
  version: string;
  currentVersion: string;
  date?: string | null;
  body?: string | null;
}

interface DownloadEventStarted {
  event: "Started";
  data: {
    contentLength?: number | null;
  };
}

interface DownloadEventProgress {
  event: "Progress";
  data: {
    chunkLength: number;
  };
}

interface DownloadEventFinished {
  event: "Finished";
}

type DownloadEvent =
  | DownloadEventStarted
  | DownloadEventProgress
  | DownloadEventFinished;

interface AppUpdateState {
  appName: string | null;
  currentVersion: string | null;
  availableUpdate: UpdateMetadata | null;
  status: AppUpdateStatus;
  error: string | null;
  lastCheckedAt: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  hasInitialized: boolean;
}

interface AppUpdateActions {
  initialize: () => Promise<void>;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissError: () => void;
}

type AppUpdateStore = AppUpdateState & AppUpdateActions;

const INITIAL_STATE: AppUpdateState = {
  appName: null,
  currentVersion: null,
  availableUpdate: null,
  status: "idle",
  error: null,
  lastCheckedAt: null,
  downloadedBytes: 0,
  contentLength: null,
  hasInitialized: false,
};

let initializePromise: Promise<void> | null = null;

const getAppMetadata = async (): Promise<{
  appName: string;
  currentVersion: string;
}> => {
  const { invoke } = await import("@tauri-apps/api/core");

  const [appName, currentVersion] = await Promise.all([
    invoke<string>("get_app_name"),
    invoke<string>("get_app_version"),
  ]);

  return { appName, currentVersion };
};

const getUpdateErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isUpdaterConfigurationError = (message: string): boolean =>
  message.toLowerCase().includes("updater is not configured");

export const useAppUpdateStore = create<AppUpdateStore>((set, get) => ({
  ...INITIAL_STATE,

  initialize: async () => {
    if (get().hasInitialized) {
      return;
    }

    if (!isTauri()) {
      set({
        hasInitialized: true,
        status: "disabled",
        error: "Desktop updates are available only in the Tauri app.",
      });
      return;
    }

    if (!initializePromise) {
      initializePromise = (async () => {
        try {
          const { appName, currentVersion } = await getAppMetadata();
          set({
            appName,
            currentVersion,
            hasInitialized: true,
          });
          await get().checkForUpdates(false);
        } catch (error) {
          const message = getUpdateErrorMessage(error);
          set({
            hasInitialized: true,
            status: "error",
            error: message,
          });
        } finally {
          initializePromise = null;
        }
      })();
    }

    return initializePromise;
  },

  checkForUpdates: async (manual = true) => {
    if (!isTauri()) {
      set({
        status: "disabled",
        error: "Desktop updates are available only in the Tauri app.",
      });
      return;
    }

    if (get().status === "checking") {
      return;
    }

    set({
      status: "checking",
      error: null,
      downloadedBytes: 0,
      contentLength: null,
    });

    try {
      const [{ invoke }, appMetadata] = await Promise.all([
        import("@tauri-apps/api/core"),
        get().currentVersion ? Promise.resolve(null) : getAppMetadata(),
      ]);

      if (appMetadata) {
        set({
          appName: appMetadata.appName,
          currentVersion: appMetadata.currentVersion,
        });
      }

      const update = await invoke<UpdateMetadata | null>("check_for_app_update");
      const checkedAt = new Date().toISOString();

      if (update) {
        set({
          availableUpdate: update,
          status: "available",
          error: null,
          lastCheckedAt: checkedAt,
        });

        if (manual) {
          toaster.create({
            type: "info",
            title: "Update available",
            description: `Version ${update.version} is ready to install.`,
            duration: 3000,
          });
        }
        return;
      }

      set({
        availableUpdate: null,
        status: "upToDate",
        error: null,
        lastCheckedAt: checkedAt,
      });

      if (manual) {
        toaster.create({
          type: "success",
          title: "Up to date",
          description: "You already have the latest version.",
          duration: 2500,
        });
      }
    } catch (error) {
      const message = getUpdateErrorMessage(error);
      const disabled = isUpdaterConfigurationError(message);

      set({
        availableUpdate: null,
        status: disabled ? "disabled" : "error",
        error: message,
        lastCheckedAt: new Date().toISOString(),
      });

      if (manual && !disabled) {
        toaster.create({
          type: "error",
          title: "Update check failed",
          description: message,
        });
      }
    }
  },

  installUpdate: async () => {
    const { availableUpdate } = get();

    if (!availableUpdate) {
      toaster.create({
        type: "warning",
        title: "No pending update",
        description: "Check for updates again first.",
      });
      return;
    }

    set({
      status: "downloading",
      error: null,
      downloadedBytes: 0,
      contentLength: null,
    });

    try {
      const [{ Channel, invoke }] = await Promise.all([
        import("@tauri-apps/api/core"),
      ]);

      const channel = new Channel<DownloadEvent>((event) => {
        switch (event.event) {
          case "Started":
            set({
              status: "downloading",
              contentLength: event.data.contentLength ?? null,
              downloadedBytes: 0,
            });
            break;
          case "Progress":
            set((state) => ({
              status: "downloading",
              downloadedBytes: state.downloadedBytes + event.data.chunkLength,
            }));
            break;
          case "Finished":
            set({
              status: "installing",
            });
            break;
        }
      });

      await invoke("install_app_update", {
        onEvent: channel,
      });

      set({
        availableUpdate: null,
        status: "upToDate",
        error: null,
        downloadedBytes: 0,
        contentLength: null,
      });

      toaster.create({
        type: "info",
        title: "Update installed",
        description:
          "The application will restart or close to complete the update.",
      });
    } catch (error) {
      const message = getUpdateErrorMessage(error);
      set({
        status: "error",
        error: message,
      });
      toaster.create({
        type: "error",
        title: "Update failed",
        description: message,
      });
    }
  },

  dismissError: () => set({ error: null }),
}));
