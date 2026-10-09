import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { isTauri } from "./ipc";

export type MenuEntry =
  | "separator"
  | {
      label: string;
      action?: () => void;
      checked?: boolean;
      enabled?: boolean;
      accelerator?: string;
      items?: MenuEntry[];
    };

async function build(entries: MenuEntry[]): Promise<(MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu)[]> {
  const out: (MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu)[] = [];
  for (const e of entries) {
    if (e === "separator") {
      out.push(await PredefinedMenuItem.new({ item: "Separator" }));
    } else if (e.items) {
      out.push(await Submenu.new({ text: e.label, enabled: e.enabled ?? true, items: await build(e.items) }));
    } else if (e.checked !== undefined) {
      out.push(
        await CheckMenuItem.new({
          text: e.label,
          checked: e.checked,
          enabled: e.enabled ?? true,
          accelerator: e.accelerator,
          action: () => e.action?.(),
        }),
      );
    } else {
      out.push(
        await MenuItem.new({ text: e.label, enabled: e.enabled ?? true, accelerator: e.accelerator, action: () => e.action?.() }),
      );
    }
  }
  return out;
}

/** Show a native context menu at (x, y) in window coordinates (or at the cursor). */
export async function popupMenu(entries: MenuEntry[], at?: { x: number; y: number }) {
  if (!isTauri) {
    console.debug("[menu]", entries);
    return;
  }
  const menu = await Menu.new({ items: await build(entries) });
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
}
