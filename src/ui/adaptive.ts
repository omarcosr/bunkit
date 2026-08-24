// adaptive.ts — theme-adaptive colour support.
//
// A `{ light, dark }` colour is resolved against the current theme when the
// control is styled, and re-resolved every time the theme changes (each
// platform's `setTheme` calls `reapplyAdaptiveColors`). The reapply functions
// capture the original spec and a `getDark` getter, so they re-read the theme
// at the moment of re-application.
import type { ColorValue } from "./view.ts";

type Reapply = () => void;
const reapplyFns = new Set<Reapply>();

/** Register a function to run whenever the theme changes. */
export function trackAdaptive(fn: Reapply): void {
  reapplyFns.add(fn);
}

/** Re-resolve every registered theme-adaptive colour against the new theme. */
export function reapplyAdaptiveColors(): void {
  for (const fn of [...reapplyFns]) fn();
}

/** True when `v` is a `{ light, dark }` theme-adaptive colour. */
export function isThemeColor(v: unknown): v is { light: any; dark: any } {
  return typeof v === "object" && v !== null && "light" in v && "dark" in v;
}

/** Resolve a `{ light, dark }` colour to the active variant, recursing for
 *  nested theme specs. A plain (non-adaptive) value is returned unchanged. */
export function resolveColor(v: ColorValue | undefined, dark: boolean): ColorValue | undefined {
  if (!isThemeColor(v)) return v;
  return resolveColor(v[dark ? "dark" : "light"], dark);
}

/** Apply a colour, handling `{ light, dark }` specs: resolve against the
 *  current theme, then re-apply whenever the theme changes. */
export function applyAdaptiveColor(
  value: ColorValue | undefined,
  getDark: () => boolean,
  apply: (resolved: ColorValue | undefined) => void,
): void {
  if (!isThemeColor(value)) {
    apply(value);
    return;
  }
  const spec = value;
  trackAdaptive(() => apply(resolveColor(spec, getDark())));
  apply(resolveColor(spec, getDark()));
}
