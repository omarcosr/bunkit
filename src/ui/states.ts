import type { BorderSideSpec, ColorValue, CornerRadiusSpec, ViewOptions } from "./view.ts";
import { isThemeColor, resolveColor } from "./adaptive.ts";
import { isThemeShadow, type ShadowValue } from "./shadow.ts";

/** Interaction states supported by controls and views. */
export type InteractionState = "hover" | "focus" | "pressed" | "disabled";

/** Visual properties that may be changed for an interaction state. */
export interface ViewStateStyle {
  background?: ColorValue;
  backgroundColor?: ColorValue;
  border?: number | boolean | BorderSideSpec;
  borderWidth?: number;
  borderColor?: ColorValue;
  borderRadius?: CornerRadiusSpec;
  borderStyle?: "solid" | "dashed" | "dotted";
  shadow?: ShadowValue;
  alpha?: number;
  textColor?: ColorValue;
  placeholderColor?: ColorValue;
  font?: any;
}

/** State styles are layered over the normal `style`/props values. */
export interface ViewStates {
  hover?: ViewStateStyle;
  focus?: ViewStateStyle;
  pressed?: ViewStateStyle;
  disabled?: ViewStateStyle;
}

const STATE_ORDER: InteractionState[] = ["hover", "focus", "pressed", "disabled"];

/** Convert the CSS aliases into one stable representation before merging. */
export function normalizeStateStyle(style: ViewStateStyle | undefined): ViewStateStyle {
  if (!style) return {};
  const out = { ...style };
  if (out.background !== undefined && out.backgroundColor === undefined) {
    out.backgroundColor = out.background;
  }
  if (out.borderWidth !== undefined && out.border === undefined) {
    out.border = out.borderWidth;
  }
  delete out.background;
  delete out.borderWidth;
  return out;
}

/** Extract the shared visual part of a regular View's options. */
export function stateStyleFromOptions(options: ViewOptions | Record<string, any>): ViewStateStyle {
  const o = options as Record<string, any>;
  return normalizeStateStyle({
    background: o.background,
    backgroundColor: o.backgroundColor,
    border: o.border,
    borderWidth: o.borderWidth,
    borderColor: o.borderColor,
    borderRadius: o.borderRadius,
    borderStyle: o.borderStyle,
    shadow: o.shadow,
    alpha: o.alpha,
    textColor: o.textColor,
    placeholderColor: o.placeholderColor,
    font: o.font,
  });
}

/** Compose base styles with active states in a deterministic precedence order. */
export function composeStateStyle(
  base: ViewStateStyle,
  states: ViewStates | undefined,
  active: Readonly<Record<InteractionState, boolean>>,
): ViewStateStyle {
  const out: ViewStateStyle = { ...normalizeStateStyle(base) };
  for (const state of STATE_ORDER) {
    if (active[state]) Object.assign(out, normalizeStateStyle(states?.[state]));
  }
  return out;
}

function resolveShadow(value: ShadowValue | undefined, dark: boolean): ShadowValue | undefined {
  if (value === undefined || typeof value === "string") return value;
  if (isThemeShadow(value)) {
    return resolveShadow(dark ? value.dark : value.light, dark);
  }
  return { ...value, color: resolveColor(value.color, dark) };
}

/** Resolve theme values before applying a state, avoiding nested adaptive subscriptions. */
export function resolveStateStyle(style: ViewStateStyle, dark: boolean): ViewStateStyle {
  const out = { ...style };
  for (const key of ["backgroundColor", "borderColor", "textColor", "placeholderColor"] as const) {
    const value = out[key];
    if (value !== undefined && isThemeColor(value)) {
      out[key] = resolveColor(value, dark) as never;
    }
  }
  if (out.shadow !== undefined) out.shadow = resolveShadow(out.shadow, dark);
  return out;
}

/** Compare resolved style values without treating equivalent objects as changes. */
export function styleValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) &&
    styleValueEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ));
}

