import { create } from "zustand";
import { invoke, listen } from "./ipc";

export interface AfterCapture {
  showQuickAccess: boolean;
  copyToClipboard: boolean;
  save: boolean;
  openAnnotate: boolean;
  openVideoEditor: boolean;
  pin: boolean;
}

export type Settings = Record<string, any> & {
  afterScreenshot: AfterCapture;
  afterRecording: AfterCapture;
  shortcuts: Record<string, string>;
};

interface Store {
  settings: Settings | null;
  load: () => Promise<void>;
  set: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettings = create<Store>((set) => ({
  settings: null,
  load: async () => {
    const s = await invoke<Settings>("get_settings");
    set({ settings: s ?? (defaultsForBrowser() as Settings) });
  },
  set: async (patch) => {
    set((st) => ({ settings: st.settings ? ({ ...st.settings, ...patch } as Settings) : st.settings }));
    const s = await invoke<Settings>("set_settings", { patch });
    if (s) set({ settings: s });
  },
}));

let started = false;
export function initSettings() {
  if (started) return;
  started = true;
  useSettings.getState().load();
  listen<Settings>("settings-changed", (s) => useSettings.setState({ settings: s }));
}

/** Read one setting with a fallback. */
export function useSetting<T>(key: string, fallback: T): T {
  return useSettings((st) => (st.settings?.[key] as T) ?? fallback);
}

function defaultsForBrowser() {
  return {
    afterScreenshot: { showQuickAccess: true, copyToClipboard: false, save: false, openAnnotate: false, openVideoEditor: false, pin: false },
    afterRecording: { showQuickAccess: true, copyToClipboard: false, save: false, openAnnotate: false, openVideoEditor: false, pin: false },
    shortcuts: {},
    annotateInverseArrow: false,
    annotateSmoothDrawing: true,
    annotateDrawShadow: true,
    annotateShowColorNames: false,
    annotateRememberBackgroundTool: true,
    annotateLast: {},
    backgroundPresets: [],
    favoriteColors: [],
    customBackgrounds: [],
    screenshotFormat: "png",
  };
}
