// Minimal global JSX namespace. Elements are the imported constructors
// (<Window>, <VStack>, …), so their props come from each control's own
// option types — no IntrinsicElements table needed. This file only tells
// the automatic runtime where `children` lives, what a JSX expression
// evaluates to, and which class property holds the props type.
export {};

declare global {
  namespace JSX {
    type Element = any;
    interface ElementChildrenAttribute {
      children: {};
    }
    interface ElementAttributesProperty {
      props: {};
    }
  }
}
