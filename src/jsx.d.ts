// Global JSX namespace for the bunkit runtime (jsx: "react-jsx",
// jsxImportSource: "bunkit"). A dedicated .d.ts so the editor always finds
// it (no dependency on the jsx-runtime module being resolved by the editor's
// TS server). Each tag's props are the real constructor option types, plus
// Signal<T> for bindable props (value/checked/on/selected/text/title).
import type { Signal } from "./signal.ts";
import type {
  WindowOptions, StackOptions, LabelOptions, ButtonOptions,
  CheckboxOptions, TextFieldOptions, TextAreaOptions, SliderOptions,
  SelectOptions, SegmentedOptions, ProgressOptions, ImageOptions,
  BoxOptions, BlurOptions, ScrollOptions, SplitOptions, ViewOptions,
} from "./index.ts";

type Child = any;
type ContainerProps<T> = T & { children?: Child };
type Bindable<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: T[P] | Signal<T[P]>;
};

declare global {
  namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      window: ContainerProps<WindowOptions>;
      vstack: ContainerProps<StackOptions>;
      hstack: ContainerProps<StackOptions>;
      stack: ContainerProps<StackOptions> & { orientation?: number };
      label: Bindable<LabelOptions, "text">;
      button: Bindable<ButtonOptions, "title">;
      textfield: Bindable<TextFieldOptions, "value">;
      checkbox: Bindable<CheckboxOptions, "checked">;
      switch: Bindable<
        ViewOptions & {
          on?: boolean;
          onChange?: (on: boolean, s: any) => void;
        },
        "on"
      >;
      slider: Bindable<SliderOptions, "value">;
      select: Bindable<SelectOptions, "selected">;
      segmented: Bindable<SegmentedOptions, "selected">;
      textarea: Bindable<TextAreaOptions, "value">;
      progress: Bindable<ProgressOptions, "value">;
      groupbox: ContainerProps<BoxOptions>;
      scrollview: ContainerProps<ScrollOptions>;
      splitview: ContainerProps<SplitOptions>;
      container: ContainerProps<ViewOptions>;
      imageview: ImageOptions;
      blurview: ContainerProps<BlurOptions>;
      spacer: {};
      separator: {};
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}