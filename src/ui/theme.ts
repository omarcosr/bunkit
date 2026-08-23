// Theme — light/dark appearance for the whole app.
//
// Windows themes per window subtree (XAML RequestedTheme); macOS switches the
// app-wide NSAppearance. `setTheme(null)` follows the system again.

import { objc } from "../objc.ts";

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
    return;
  }
  app.setAppearance_(objc.NSAppearance.appearanceNamed_(APPEARANCE[theme]));
}
