type WindowModule = typeof import("@tauri-apps/api/window");
let windowModule: WindowModule | null = null;

const getWindow = async () => {
  if (!windowModule) {
    windowModule = await import("@tauri-apps/api/window");
  }
  return windowModule.getCurrentWindow();
};

const runWindowAction = async <T,>(action: string, task: () => Promise<T>): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    console.error(`[tauri-window] ${action} failed`, error);
    throw error;
  }
};

export const minimizeWindow = async () => {
  await runWindowAction("minimize()", async () => {
    const win = await getWindow();
    await win.minimize();
  });
};

export const toggleMaximize = async () => {
  await runWindowAction("toggleMaximize()", async () => {
    const win = await getWindow();
    await win.toggleMaximize();
  });
};

export const closeWindow = async () => {
  await runWindowAction("close()", async () => {
    const win = await getWindow();
    await win.close();
  });
};

export const startDragging = async () => {
  await runWindowAction("startDragging()", async () => {
    const win = await getWindow();
    await win.startDragging();
  });
};

export const isMaximized = async (): Promise<boolean> => {
  return runWindowAction("isMaximized()", async () => {
    const win = await getWindow();
    return win.isMaximized();
  });
};
