import type { ColorValue } from "./view.ts";

/** A single outer CSS-like box shadow. Lengths are in points/pixels. */
export interface ShadowSpec {
  /** Horizontal displacement; positive values go right. */
  offsetX?: number;
  /** Vertical displacement; positive values go down, like CSS. */
  offsetY?: number;
  /** Blur radius. */
  blur?: number;
  /** Extra growth of the shadow shape. */
  spread?: number;
  /** Shadow colour. Defaults to translucent black. */
  color?: ColorValue;
  /** Multiplier applied to the colour alpha. */
  opacity?: number;
}

/** A CSS-like `box-shadow` value, or its typed equivalent. */
export type ShadowValue = ShadowSpec | string;

export interface ParsedShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: ColorValue;
  opacity: number;
}

const DEFAULT_SHADOW_COLOR = { r: 0, g: 0, b: 0, a: 0.25 } as const;

/**
 * Parse the useful single-shadow subset of CSS `box-shadow`:
 * `offset-x offset-y [blur] [spread] [color]`.
 *
 * `none` clears the shadow. Multiple comma-separated shadows and inset
 * shadows are intentionally not accepted because CALayer/Composition do not
 * have an equivalent that behaves consistently on both supported platforms.
 */
export function parseShadow(value: ShadowValue | undefined): ParsedShadow | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") {
    return {
      offsetX: finiteOr(value.offsetX, 0),
      offsetY: finiteOr(value.offsetY, 0),
      blur: nonNegative(value.blur),
      spread: value.spread !== undefined ? finiteOr(value.spread, 0) : 0,
      color: value.color ?? DEFAULT_SHADOW_COLOR,
      opacity: clamp(value.opacity ?? 1, 0, 1),
    };
  }

  const source = value.trim();
  if (!source || source.toLowerCase() === "none" || source.includes(",") || /\binset\b/i.test(source)) return null;
  const tokens = source.match(/#[\da-f]{3,8}|rgba?\([^)]*\)|[^\s]+/gi) ?? [];
  const lengths: number[] = [];
  let color: ColorValue | undefined;
  for (const token of tokens) {
    const length = parseLength(token);
    if (length !== undefined && lengths.length < 4) {
      lengths.push(length);
      continue;
    }
    if (color === undefined) color = parseCssColor(token);
  }
  if (lengths.length < 2) return null;

  return {
    offsetX: lengths[0]!,
    offsetY: lengths[1]!,
    blur: nonNegative(lengths[2]),
    spread: lengths[3] ?? 0,
    color: color ?? DEFAULT_SHADOW_COLOR,
    opacity: 1,
  };
}

/** Convert a resolved colour to the #AARRGGBB form expected by WinUI. */
export function colorToHex(value: ColorValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const named = CSS_COLORS[value.toLowerCase()];
    if (named) return named;
    return normalizeHex(value);
  }
  if (typeof value === "object" && "r" in value) {
    const alpha = Math.round(clamp(value.a ?? 1, 0, 1) * 255);
    const r = Math.round(clamp(value.r, 0, 1) * 255);
    const g = Math.round(clamp(value.g, 0, 1) * 255);
    const b = Math.round(clamp(value.b, 0, 1) * 255);
    return `#${hex(alpha)}${hex(r)}${hex(g)}${hex(b)}`;
  }
  return undefined;
}

function parseLength(token: string): number | undefined {
  const match = token.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px|pt)?$/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseCssColor(token: string): ColorValue | undefined {
  const hexValue = normalizeHex(token);
  if (hexValue) {
    const digits = hexValue.slice(1);
    return {
      r: parseInt(digits.slice(2, 4), 16) / 255,
      g: parseInt(digits.slice(4, 6), 16) / 255,
      b: parseInt(digits.slice(6, 8), 16) / 255,
      a: parseInt(digits.slice(0, 2), 16) / 255,
    };
  }

  const rgb = token.match(/^rgba?\(\s*([^)]*)\)$/i);
  if (rgb) {
    const parts = rgb[1]!.split(/\s*,\s*|\s*\/\s*/);
    if (parts.length >= 3) {
      const component = (part: string) => {
        const n = Number.parseFloat(part);
        return part.trim().endsWith("%") ? n / 100 : n / 255;
      };
      const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
      return {
        r: clamp(component(parts[0]!), 0, 1),
        g: clamp(component(parts[1]!), 0, 1),
        b: clamp(component(parts[2]!), 0, 1),
        a: clamp(parts[3]?.trim().endsWith("%") ? alpha / 100 : alpha, 0, 1),
      };
    }
  }

  const named = token.toLowerCase();
  return CSS_COLORS[named] ? named as ColorValue : undefined;
}

function normalizeHex(value: string): string | undefined {
  const digits = value.replace(/^#/, "");
  if (![3, 4, 6, 8].includes(digits.length) || !/^[\da-f]+$/i.test(digits)) return undefined;
  const expanded = digits.length <= 4
    ? [...digits].map((c) => c + c).join("")
    : digits;
  // CSS uses RRGGBBAA while WinUI uses AARRGGBB.
  const alpha = expanded.length === 8 ? expanded.slice(6, 8) : "ff";
  return `#${alpha}${expanded.slice(0, 6)}`.toLowerCase();
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number | undefined): number {
  return Math.max(0, finiteOr(value, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

// The names most commonly used in CSS shadow declarations. Semantic BunKit
// names continue to pass through to the platform that can resolve them.
const CSS_COLORS: Record<string, string> = {
  black: "#ff000000",
  white: "#ffffffff",
  red: "#ffff0000",
  green: "#ff008000",
  blue: "#ff0000ff",
  gray: "#ff808080",
  grey: "#ff808080",
  transparent: "#00000000",
};
