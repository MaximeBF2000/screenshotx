import { useEffect, useRef } from "react";
import { listenHere } from "./ipc";

/** A KeyboardEvent-like object built from a forwarded "session-key". */
export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

const KEY_FOR_CODE: Record<string, string> = {
  Escape: "Escape",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Space: " ",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  KeyC: "c",
  KeyS: "s",
};

export function keyFromAccelerator(acc: string): KeyLike {
  const parts = acc.split("+");
  const code = parts[parts.length - 1];
  return {
    key: KEY_FOR_CODE[code] ?? code,
    code,
    shiftKey: parts.includes("Shift"),
    altKey: parts.includes("Alt"),
    metaKey: parts.includes("Super"),
    ctrlKey: parts.includes("Control"),
    repeat: false,
    target: document.body,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

/**
 * Handle keys from both real keyboard events (when the panel has focus)
 * and keys grabbed natively for this window (when it doesn't).
 */
export function useKeys(onDown: (e: KeyLike) => void, onUp?: (e: KeyLike) => void) {
  const down = useRef(onDown);
  const up = useRef(onUp);
  down.current = onDown;
  up.current = onUp;
  useEffect(() => {
    const kd = (e: KeyboardEvent) => down.current(e);
    const ku = (e: KeyboardEvent) => up.current?.(e);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const held = new Set<string>();
    const un = listenHere<{ acc: string; down: boolean }>("session-key", ({ acc, down: isDown }) => {
      const ev = keyFromAccelerator(acc);
      if (isDown) {
        // hotkeys auto-repeat while held
        ev.repeat = held.has(acc);
        held.add(acc);
        down.current(ev);
      } else {
        held.delete(acc);
        up.current?.(ev);
      }
    });
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      un.then((f) => f());
    };
  }, []);
}
