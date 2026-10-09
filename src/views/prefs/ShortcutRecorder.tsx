import { useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { invoke } from "../../lib/ipc";

const MOD_ORDER = ["Control", "Alt", "Shift", "Super"];

export function displayShortcut(acc: string): string {
  if (!acc) return "";
  const parts = acc.split("+");
  const sym: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };
  const mods = MOD_ORDER.filter((m) => parts.includes(m)).map((m) => sym[m]).join("");
  const key = parts.find((p) => !MOD_ORDER.includes(p)) ?? "";
  const names: Record<string, string> = {
    Space: "Space", Enter: "↩", Escape: "⎋", Backspace: "⌫", Tab: "⇥", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
  };
  const k = key.startsWith("Key") ? key.slice(3) : key.startsWith("Digit") ? key.slice(5) : names[key] ?? key;
  return mods + k;
}

/** Click to record a global shortcut (⌫ clears, ⎋ cancels). */
export function ShortcutRecorder({ value, onChange }: { value: string; onChange: (acc: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    invoke("shortcuts_suspend", { suspended: true });
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        setPreview(displayShortcut(mods.join("+") + "+"));
        return;
      }
      if (e.key === "Escape" && !mods.length) return setRecording(false);
      if ((e.key === "Backspace" || e.key === "Delete") && !mods.length) {
        onChange("");
        return setRecording(false);
      }
      const isF = /^F\d+$/.test(e.code);
      if (!mods.length && !isF) {
        setWarn("Use at least one modifier key (⌘, ⌥, ⌃ or ⇧)");
        return;
      }
      const acc = [...mods, e.code].join("+");
      setRecording(false);
      const ok = await invoke<boolean>("shortcut_available", { acc });
      setWarn(ok === false ? "This shortcut is used by macOS or another app. Disable it there first." : null);
      onChange(acc);
    };
    const onUp = (e: KeyboardEvent) => {
      const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
      setPreview(mods.length ? displayShortcut(mods.join("+") + "+") : "");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onUp, true);
      invoke("shortcuts_suspend", { suspended: false });
      setPreview("");
    };
  }, [recording, onChange]);

  return (
    <span className="inline-flex flex-col items-end">
      <span className="inline-flex items-center gap-1">
        <button
          onClick={() => {
            setWarn(null);
            setRecording(!recording);
          }}
          onBlur={() => setRecording(false)}
          className={clsx(
            "h-[24px] min-w-[128px] px-2.5 rounded-[6px] text-[12.5px] border transition-colors",
            recording
              ? "border-[var(--accent)] ring-2 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-[var(--accent)] bg-[var(--control)]"
              : "border-[var(--control-border)] bg-[var(--control)] hover:brightness-[0.97]",
            !value && !recording && "text-[var(--text-3)]",
          )}
        >
          {recording ? preview || "Type shortcut…" : value ? <span className="tracking-wide">{displayShortcut(value)}</span> : "Record Shortcut"}
        </button>
        {value && !recording && (
          <button title="Clear" onClick={() => onChange("")} className="w-5 h-5 rounded-full text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--hover)] flex items-center justify-center">
            <X size={12} />
          </button>
        )}
      </span>
      {warn && <span className="text-[11px] text-[#ff9500] mt-0.5 max-w-[260px] text-right">{warn}</span>}
    </span>
  );
}
