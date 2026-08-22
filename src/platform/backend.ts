// src/platform/backend.ts — abstraction between public API and native backends.
import type { NativeHandle } from "./windows/ffi.ts";

export type { NativeHandle };

export interface WindowOptions {
  title?: string;
  size?: { width: number; height: number };
  content?: NativeHandle | null;
  show?: boolean;
  onClose?: () => void;
}

export interface LabelOptions {
  text?: string;
}

export interface ButtonOptions {
  title?: string;
  onClick?: () => void;
}

export interface TextFieldOptions {
  value?: string;
  placeholder?: string;
  secure?: boolean;
  onChange?: (value: string) => void;
}

export interface StackOptions {
  spacing?: number;
  padding?: number | { top: number; left: number; bottom: number; right: number };
  orientation?: "vertical" | "horizontal";
}

export interface PlatformBackend {
  init(): Promise<void> | void;
  shutdown(): void;
  isRunning(): boolean;

  createWindow(opts: WindowOptions): NativeHandle;
  setWindowTitle(handle: NativeHandle, title: string): void;
  showWindow(handle: NativeHandle): void;
  closeWindow(handle: NativeHandle): void;
  setWindowContent(handle: NativeHandle, content: NativeHandle): void;

  createLabel(opts: LabelOptions): NativeHandle;
  setLabelText(handle: NativeHandle, text: string): void;
  getLabelText(handle: NativeHandle): string;

  createButton(opts: ButtonOptions): NativeHandle;
  setButtonText(handle: NativeHandle, text: string): void;
  setButtonClickCallback(handle: NativeHandle, cb: (() => void) | null): void;

  createTextField(opts: TextFieldOptions): NativeHandle;
  setTextFieldValue(handle: NativeHandle, value: string): void;
  getTextFieldValue(handle: NativeHandle): string;
  setTextFieldPlaceholder(handle: NativeHandle, ph: string): void;
  setTextFieldChangeCallback(handle: NativeHandle, cb: ((v: string) => void) | null): void;

  createStack(orientation: number, opts: StackOptions): NativeHandle;
  stackAddChild(stack: NativeHandle, child: NativeHandle, grow?: number): void;

  destroy(handle: NativeHandle): void;

  // Called by Application.run() to pump events; returns true if should continue
  pump(): boolean;
}
