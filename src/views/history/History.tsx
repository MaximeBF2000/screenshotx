import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Copy, Film, FolderOpen, Pencil, RotateCcw, Search, Trash2, Scissors } from "lucide-react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { ask } from "@tauri-apps/plugin-dialog";
import { basename, fileUrl, formatBytes, formatDuration, invoke, listen, ready, type CaptureItem } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { popupMenu } from "../../lib/menu";
import { Button, Segmented } from "../../components/ui";

type Filter = "all" | "screenshot" | "video" | "gif";

function groupLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export default function History() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const keepImages = useSettings((s) => s.settings?.keepImagesMinutes ?? 5);
  const keepVideos = useSettings((s) => s.settings?.keepVideosMinutes ?? 5);

  const load = () => invoke<CaptureItem[]>("history_list").then((l) => setItems(l ?? []));
  useEffect(() => {
    load().then(() => ready());
    const un = listen("history:update", () => load());
    return () => {
      un.then((f) => f());
    };
  }, []);

  const act = (id: string, action: string) => invoke("history_action", { id, action });

  const shown = useMemo(
    () =>
      items.filter(
        (i) => (filter === "all" || i.kind === filter) && (!q || basename(i.path).toLowerCase().includes(q.toLowerCase()) || i.appName.toLowerCase().includes(q.toLowerCase())),
      ),
    [items, filter, q],
  );
  const groups = useMemo(() => {
    const m = new Map<string, CaptureItem[]>();
    for (const i of shown) {
      const g = groupLabel(i.created);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(i);
    }
    return Array.from(m.entries());
  }, [shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || !sel) return;
      const it = items.find((i) => i.id === sel);
      if (!it) return;
      if (e.code === "Space") (e.preventDefault(), act(sel, "quicklook"));
      else if (e.metaKey && e.key === "c") act(sel, "copy");
      else if (e.key === "Enter") act(sel, it.kind === "screenshot" ? "annotate" : "editor");
      else if (e.key === "Backspace" || e.key === "Delete") act(sel, "delete");
      else if (e.key.startsWith("Arrow")) {
        const idx = shown.findIndex((i) => i.id === sel);
        const cols = Math.max(1, Math.floor((window.innerWidth - 48) / 224));
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols;
        const n = shown[Math.max(0, Math.min(shown.length - 1, idx + d))];
        if (n) setSel(n.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, items, shown]);

  const menu = (it: CaptureItem) =>
    popupMenu([
      { label: "Restore to Quick Access", action: () => act(it.id, "restore") },
      it.kind === "screenshot" ? { label: "Open Annotate Tool", action: () => act(it.id, "annotate") } : { label: "Open Video Editor", action: () => act(it.id, "editor") },
      ...(it.kind === "screenshot" ? [{ label: "Pin to the Screen", action: () => act(it.id, "pin") }] : []),
      "separator" as const,
      { label: "Copy", accelerator: "Cmd+C", action: () => act(it.id, "copy") },
      { label: "Save to Export Location", action: () => act(it.id, "save") },
      { label: "Open", action: () => act(it.id, "open") },
      { label: "Show in Finder", action: () => act(it.id, "reveal") },
      { label: "Quick Look", accelerator: "Space", action: () => act(it.id, "quicklook") },
      "separator" as const,
      { label: "Delete", action: () => act(it.id, "delete") },
    ]);

  return (
    <div className="h-full flex flex-col">
      <div className="h-[52px] shrink-0 flex items-center gap-3 pl-[84px] pr-4 border-b border-[var(--border)]" data-tauri-drag-region>
        <span className="font-semibold text-[13.5px]" data-tauri-drag-region>
          Capture History
        </span>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "screenshot", label: "Screenshots" },
            { value: "video", label: "Videos" },
            { value: "gif", label: "GIFs" },
          ]}
        />
        <div className="flex-1" data-tauri-drag-region />
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-[26px] w-[180px] rounded-[7px] pl-7 pr-2 text-[12.5px] bg-[var(--control)] border border-[var(--control-border)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
          />
        </div>
        <Button
          small
          disabled={!items.length}
          onClick={async () => {
            if (await ask("Delete all recent captures?\n\nCaptures you haven't saved are deleted. Files you saved stay where they are.", { title: "Clear History", kind: "warning", okLabel: "Clear History" })) invoke("history_clear");
          }}
        >
          Clear History…
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4" onClick={() => setSel(null)}>
        {!shown.length && (
          <Empty
            title={items.length ? "No matching captures" : "No recent captures"}
            body={`Captures are ephemeral: once closed, images are kept ${minutes(keepImages)} and videos ${minutes(keepVideos)}, and everything is deleted when Screenshot X quits. Saved files stay where you saved them.`}
          />
        )}
        {groups.map(([label, list]) => (
          <section key={label} className="mb-5">
            <div className="text-[12px] font-semibold text-[var(--text-2)] mb-2 sticky top-0">{label}</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(208px, 1fr))" }}>
              {list.map((it) => (
                <Card key={it.id} it={it} selected={sel === it.id} onSelect={() => setSel(it.id)} act={act} onMenu={() => menu(it)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-2)] gap-1 py-20">
      <div className="text-[15px] font-medium text-[var(--text)]">{title}</div>
      <div className="text-[12.5px]">{body}</div>
    </div>
  );
}

function Card({ it, selected, onSelect, act, onMenu }: { it: CaptureItem; selected: boolean; onSelect: () => void; act: (id: string, a: string) => void; onMenu: () => void }) {
  const video = it.kind !== "screenshot";
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={() => act(it.id, video ? "editor" : "annotate")}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        onMenu();
      }}
      onDragStart={(e) => {
        e.preventDefault();
        startDrag({ item: [it.path], icon: it.thumb || it.path });
      }}
      draggable
      className={clsx("group rounded-[10px] overflow-hidden bg-[var(--panel)] border transition-shadow", selected ? "border-[var(--accent)] ring-2 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]" : "border-[var(--border)] hover:shadow-lg")}
    >
      <div className="relative aspect-[16/10] checker">
        <img src={fileUrl(it.thumb || it.path)} className="absolute inset-0 w-full h-full object-contain" draggable={false} loading="lazy" />
        {video && (
          <span className="absolute left-1.5 bottom-1.5 hud rounded px-1.5 py-[1px] text-[10.5px] font-semibold flex items-center gap-1">
            {it.kind === "gif" ? "GIF" : <Film size={10} />} {it.duration ? formatDuration(it.duration) : ""}
          </span>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
          <HoverBtn title="Restore to Quick Access" onClick={() => act(it.id, "restore")}>
            <RotateCcw size={14} />
          </HoverBtn>
          <HoverBtn title="Copy" onClick={() => act(it.id, "copy")}>
            <Copy size={14} />
          </HoverBtn>
          <HoverBtn title={video ? "Open Video Editor" : "Annotate"} onClick={() => act(it.id, video ? "editor" : "annotate")}>
            {video ? <Scissors size={14} /> : <Pencil size={14} />}
          </HoverBtn>
          <HoverBtn title="Show in Finder" onClick={() => act(it.id, "reveal")}>
            <FolderOpen size={14} />
          </HoverBtn>
          <HoverBtn title="Delete" onClick={() => act(it.id, "delete")}>
            <Trash2 size={14} />
          </HoverBtn>
        </div>
      </div>
      <div className="px-2.5 py-1.5">
        <div className="text-[12px] truncate" title={basename(it.path)}>
          {basename(it.path)}
        </div>
        <div className="text-[11px] text-[var(--text-2)] flex justify-between">
          <span>{new Date(it.created).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
          <span>
            {!video && it.width ? `${Math.round(it.width / (it.scale || 1))}×${Math.round(it.height / (it.scale || 1))} · ` : ""}
            {formatBytes(it.size)}
          </span>
        </div>
      </div>
    </div>
  );
}

function HoverBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-8 h-8 rounded-full bg-white/90 text-[#1d1d1f] flex items-center justify-center hover:bg-white shadow"
    >
      {children}
    </button>
  );
}

function minutes(m: number) {
  return m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minute${m === 1 ? "" : "s"}`;
}
