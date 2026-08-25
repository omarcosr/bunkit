import type { ColorValue } from "./view.ts";
import type { ShadowValue } from "./shadow.ts";

export interface ThemeTokenDefinition {
  colors?: Record<string, ColorValue>;
  shadows?: Record<string, ShadowValue>;
}

export interface ThemeTokens {
  color(name: string): ColorValue;
  shadow(name: string): ShadowValue;
}

/**
 * Create a small semantic token namespace. Components can use
 * `theme.color("buttonBackground")` and `theme.shadow("elevation1")` without
 * repeating light/dark objects at every call site.
 */
export function defineTheme(definition: ThemeTokenDefinition): ThemeTokens {
  return {
    color(name: string): ColorValue {
      const value = definition.colors?.[name];
      if (value === undefined) throw new Error(`Unknown theme color token: ${name}`);
      return value;
    },
    shadow(name: string): ShadowValue {
      const value = definition.shadows?.[name];
      if (value === undefined) throw new Error(`Unknown theme shadow token: ${name}`);
      return value;
    },
  };
}

