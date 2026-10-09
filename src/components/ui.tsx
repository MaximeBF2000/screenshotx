import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

/** Anchored popover rendered in a portal; closes on outside click / Esc. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  className,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 200;
    let left = align === "start" ? r.left : align === "end" ? r.right - w : r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left, top });
  }, [open, anchor, align, children]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={clsx(
        "fixed z-50 rounded-xl p-2 shadow-2xl border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)]",
        className,
      )}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, animation: "pop-in .12s ease-out" }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: !!anchor,
    toggle: (e: React.MouseEvent) => setAnchor((a) => (a ? null : (e.currentTarget as HTMLElement))),
    close: () => setAnchor(null),
  };
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  className,
  width = 120,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
  width?: number;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      className={clsx("sx-slider", className)}
      style={{ width, ["--pct" as any]: `${pct}%` }}
    />
  );
}

export function Switch({ checked, onChange, small }: { checked: boolean; onChange: (v: boolean) => void; small?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative rounded-full transition-colors shrink-0",
        small ? "w-[26px] h-[15px]" : "w-[32px] h-[19px]",
        checked ? "bg-[var(--accent)]" : "bg-[rgba(120,120,128,0.32)]",
      )}
    >
      <span
        className={clsx("absolute top-[1.5px] rounded-full bg-white shadow transition-transform", small ? "w-3 h-3" : "w-4 h-4")}
        style={{ left: 1.5, transform: checked ? `translateX(${small ? 11 : 13}px)` : "none" }}
      />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  // One click target for the whole row (a <label> wrapping a button would
  // forward a second click and toggle the value back).
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => {
        if (!disabled && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className={clsx("flex items-start gap-2 py-[3px] outline-none", disabled && "opacity-45")}
    >
      <span
        className={clsx(
          "mt-[1px] w-[15px] h-[15px] rounded-[4px] flex items-center justify-center shrink-0 transition-colors",
          checked ? "bg-[var(--accent)] text-white" : "bg-[var(--control)] border border-[var(--control-border)]",
        )}
      >
        {checked && <Check size={11} strokeWidth={3.2} />}
      </span>
      {label ? (
        <span className="leading-[18px]">
          {label}
          {hint && <span className="block text-[11.5px] text-[var(--text-2)] leading-snug mt-0.5">{hint}</span>}
        </span>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex p-[2px] rounded-[7px] bg-[rgba(120,120,128,0.14)] dark:bg-[rgba(120,120,128,0.24)]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-[5px] font-medium transition-all flex items-center justify-center gap-1",
            size === "sm" ? "h-[22px] px-2 text-[11.5px]" : "h-[24px] px-2.5 text-[12px]",
            value === o.value ? "bg-[var(--control)] shadow-[0_1px_2px_rgba(0,0,0,0.15)] text-[var(--text)]" : "text-[var(--text-2)] hover:text-[var(--text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  width,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  width?: number;
}) {
  return (
    <div className="relative inline-flex items-center" style={{ width }}>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}
        className="appearance-none w-full h-[24px] pl-2.5 pr-7 rounded-[6px] text-[12.5px] bg-[var(--control)] border border-[var(--control-border)] shadow-[0_0.5px_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 pointer-events-none text-[var(--text-2)]" />
    </div>
  );
}

export function Button({
  children,
  onClick,
  primary,
  danger,
  small,
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  primary?: boolean;
  danger?: boolean;
  small?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium transition-[filter,background] disabled:opacity-40",
        small ? "h-[22px] px-2.5 text-[12px]" : "h-[26px] px-3 text-[12.5px]",
        primary
          ? "bg-[var(--accent)] text-white hover:brightness-110 shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
          : danger
            ? "bg-[#ff3b30] text-white hover:brightness-110"
            : "bg-[var(--control)] border border-[var(--control-border)] shadow-[0_0.5px_1px_rgba(0,0,0,0.12)] hover:brightness-[0.97] dark:hover:brightness-125",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  active,
  title,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "h-[28px] min-w-[28px] px-1.5 rounded-[7px] inline-flex items-center justify-center gap-1 text-[12.5px] transition-colors disabled:opacity-35",
        active ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]" : "text-[var(--text)] hover:bg-[var(--hover)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function NumberField({ value, onChange, min, max, width = 56, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; width?: number; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = value;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n);
    setV(String(n));
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-[22px] rounded-[5px] px-1.5 text-[12px] tabular-nums text-right bg-[var(--control)] border border-[var(--control-border)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
        style={{ width }}
      />
      {suffix && <span className="text-[11.5px] text-[var(--text-2)]">{suffix}</span>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="px-1 py-[1px] rounded border border-[var(--border-strong)] text-[10.5px] font-sans text-[var(--text-2)]">{children}</kbd>;
}
