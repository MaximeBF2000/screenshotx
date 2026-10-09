import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, Keyboard, MonitorSmartphone, Power, ShieldCheck, Sparkles } from "lucide-react";
import { closeSelf, invoke, ready } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { Button } from "../../components/ui";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

const STEPS = ["welcome", "permissions", "shortcuts", "desktop", "login", "finish"] as const;

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [perm, setPerm] = useState<{ screen: boolean; accessibility: boolean } | null>(null);
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);

  useEffect(() => {
    ready();
    const t = window.setInterval(() => invoke("permissions_status").then(setPerm), 1500);
    invoke("permissions_status").then(setPerm);
    return () => window.clearInterval(t);
  }, []);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const finish = () => {
    set({ onboardingDone: true });
    closeSelf();
  };
  const id = STEPS[step];

  return (
    <div className="h-full flex flex-col" data-tauri-drag-region>
      <div className="flex-1 flex flex-col items-center justify-center px-12 text-center" data-tauri-drag-region>
        {id === "welcome" && (
          <Step icon={<img src={appIcon} className="w-24 h-24" />} title="Welcome to Screenshot X" body="Let's walk you through a quick configuration. You can adjust all the settings and set your own keyboard shortcuts later in Settings.">
            <Button primary onClick={next}>
              Get Started
            </Button>
          </Step>
        )}
        {id === "permissions" && (
          <Step icon={<ShieldCheck size={44} className="text-[var(--accent)]" />} title="Screen Recording permission" body="Screenshot X needs Screen Recording permission to take screenshots and record your screen. Everything stays on your Mac.">
            <div className="flex items-center gap-2 text-[13px] mb-3">
              <span className={clsx("w-2.5 h-2.5 rounded-full", perm?.screen ? "bg-[#34c759]" : "bg-[#ff9f0a]")} />
              {perm?.screen ? "Permission granted" : "Not granted yet"}
            </div>
            <div className="flex gap-2">
              {!perm?.screen && <Button onClick={() => invoke("request_permission", { kind: "screen" })}>Open System Settings</Button>}
              <Button primary onClick={next}>
                {perm?.screen ? "Continue" : "I'll do it later"}
              </Button>
            </div>
          </Step>
        )}
        {id === "shortcuts" && (
          <Step icon={<Keyboard size={44} className="text-[var(--accent)]" />} title="Set as default screenshot tool?" body="Use the same shortcuts as macOS: ⇧⌘3 for fullscreen, ⇧⌘4 to capture an area and ⇧⌘5 for All-In-One. First disable the macOS screenshot shortcuts in System Settings → Keyboard → Keyboard Shortcuts… → Screenshots.">
            <div className="flex gap-2">
              <Button onClick={() => invoke("open_url", { url: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" })}>Open Keyboard Settings</Button>
              <Button
                primary
                onClick={() => {
                  set({
                    shortcuts: {
                      ...(settings?.shortcuts ?? {}),
                      captureFullscreen: "Shift+Super+Digit3",
                      captureArea: "Shift+Super+Digit4",
                      allInOne: "Shift+Super+Digit5",
                      captureText: "Shift+Super+Digit2",
                      recordScreen: "Shift+Super+Digit6",
                    },
                  });
                  next();
                }}
              >
                Use macOS Shortcuts
              </Button>
            </div>
            <button className="mt-3 text-[12px] text-[var(--text-2)] hover:underline" onClick={next}>
              I'll assign shortcuts later
            </button>
          </Step>
        )}
        {id === "desktop" && (
          <Step icon={<MonitorSmartphone size={44} className="text-[var(--accent)]" />} title="Hide desktop icons while capturing?" body="Get clean screenshots and recordings without the clutter of your desktop icons.">
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  set({ hideDesktopIconsWhileCapturing: false });
                  next();
                }}
              >
                No, thanks
              </Button>
              <Button
                primary
                onClick={() => {
                  set({ hideDesktopIconsWhileCapturing: true });
                  next();
                }}
              >
                Hide Desktop Icons
              </Button>
            </div>
          </Step>
        )}
        {id === "login" && (
          <Step icon={<Power size={44} className="text-[var(--accent)]" />} title="Start Screenshot X at login?" body="Have Screenshot X ready whenever you need it.">
            <div className="flex gap-2">
              <Button onClick={next}>Not now</Button>
              <Button
                primary
                onClick={() => {
                  set({ launchAtLogin: true });
                  next();
                }}
              >
                Start at Login
              </Button>
            </div>
          </Step>
        )}
        {id === "finish" && (
          <Step icon={<Sparkles size={44} className="text-[var(--accent)]" />} title="Screenshot X is ready to use!" body="Find every tool in the menu bar. A few tips:">
            <ul className="text-left text-[12.5px] text-[var(--text-2)] space-y-1.5 mb-5 max-w-[380px]">
              {[
                "Press Space while selecting an area to capture a window.",
                "Hold Shift for a square selection, ⌥ to resize from the center.",
                "Double-click a Quick Access thumbnail to annotate it.",
                "Drag thumbnails straight into any app.",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check size={14} className="text-[#34c759] shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button onClick={() => invoke("cmd_open_settings", { tab: "shortcuts" })}>Open Settings</Button>
              <Button primary onClick={finish}>
                Done
              </Button>
            </div>
          </Step>
        )}
      </div>
      <div className="flex justify-center gap-1.5 pb-6">
        {STEPS.map((s, i) => (
          <span key={s} className={clsx("w-1.5 h-1.5 rounded-full transition-colors", i === step ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]")} />
        ))}
      </div>
    </div>
  );
}

function Step({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center" style={{ animation: "pop-in .25s ease-out" }}>
      <div className="mb-5">{icon}</div>
      <h1 className="text-[22px] font-semibold mb-2">{title}</h1>
      <p className="text-[13px] text-[var(--text-2)] leading-relaxed max-w-[440px] mb-6">{body}</p>
      {children}
    </div>
  );
}
