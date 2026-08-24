// Theme — light/dark appearance for the whole app.
//
// Windows themes per window subtree (XAML RequestedTheme); macOS switches the
// app-wide NSAppearance. `setTheme("default")` follows the system again.

import { objc, str } from "../objc.ts";
import { reapplyAdaptiveColors } from "./adaptive.ts";

export type Theme = "default" | "light" | "dark";

const APPEARANCE: Record<"light" | "dark", string> = {
  light: "NSAppearanceNameAqua",
  dark: "NSAppearanceNameDarkAqua",
};

export function setTheme(
  theme: Theme,
  _opts?: { background?: string },
): void {
  const app = objc.NSApplication.sharedApplication();
  if (theme === "default") {
    app.setAppearance_(null);
  } else {
    app.setAppearance_(objc.NSAppearance.appearanceNamed_(APPEARANCE[theme]));
  }
  // { light, dark } colours resolve against the new appearance.
  reapplyAdaptiveColors();
}

/** Whether the app's effective appearance is dark (system, if following it). */
export function currentThemeIsDark(): boolean {
  try {
    const app = objc.NSApplication.sharedApplication();
    const name = str(app.effectiveAppearance().name());
    return name.includes("Dark");
  } catch {
    return false;
  }
}
