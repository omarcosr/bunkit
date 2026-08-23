// signal.ts — a tiny reactive cell, the SolidJS-style binding primitive.
//
//   const name = signal("Ada");
//   name.value;                 // "Ada"
//   name.set("Grace");
//   name.subscribe((v) => ...); // runs on every change
//
// The JSX runtime recognizes signals passed as props: <textfield value={name} />
// binds both ways — typing updates `name`, and `name.set(...)` updates the
// field. The signal itself is platform-agnostic and usable without JSX.

export type SignalListener<T> = (value: T) => void;
export type Unsubscriber = () => void;

export interface Signal<T> {
  /** Current value. Assign to set. */
  value: T;
  /** Read the current value. */
  get(): T;
  /** Set a new value; notifies subscribers when it actually changes. */
  set(v: T): void;
  /** Run `fn` on every change; returns an unsubscribe function. */
  subscribe(fn: SignalListener<T>): Unsubscriber;
}

export function signal<T>(initial: T): Signal<T> {
  let current = initial;
  const listeners = new Set<SignalListener<T>>();
  const set = (v: T): void => {
    if (Object.is(v, current)) return;
    current = v;
    for (const fn of [...listeners]) fn(v);
  };
  return {
    get value(): T {
      return current;
    },
    set value(v: T) {
      set(v);
    },
    get(): T {
      return current;
    },
    set,
    subscribe(fn: SignalListener<T>): Unsubscriber {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** True when `v` is a signal (safe to pass as a bindable JSX prop). */
export function isSignal(v: unknown): v is Signal<unknown> {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as Signal<unknown>).get === "function" &&
    typeof (v as Signal<unknown>).set === "function" &&
    typeof (v as Signal<unknown>).subscribe === "function"
  );
}

/** Resolve a `T | Signal<T>` to the plain value (signals give their current
 *  value). Options accept signals so JSX props can carry them; the JSX runtime
 *  unwraps before construction, and this is the imperative equivalent. */
export function unwrap<T>(v: T | Signal<T>): T {
  return isSignal(v) ? v.get() : v;
}

// Bindable props and the change event that writes them back. `value`/`checked`/
// `on`/`selected` are two-way; `text`/`title` (no event) are one-way.
export const WRITE_BACK_EVENT: Record<string, string> = {
  value: "onChange",
  checked: "onChange",
  on: "onChange",
  selected: "onChange",
};

/**
 * Bind a signal to a control prop, the imperative twin of passing the signal
 * as a JSX prop. Two-way when the control has a change event for the prop
 * (value/checked/on/selected), one-way otherwise (text/title).
 *
 *   const name = signal("");
 *   const field = new TextField({ value: name.value });
 *   bind(field, "value", name);      // typing updates name, name.set() the field
 *
 * The change handler on the control is replaced (pass nothing to the
 * constructor's onChange and react via `name.subscribe` instead). Returns an
 * unsubscribe for the one-way subscription.
 */
export function bind<C, K extends keyof C>(
  control: C,
  prop: K,
  sig: Signal<C[K]>,
): Unsubscriber {
  const unsub = sig.subscribe((v) => { (control as any)[prop] = v; });
  (control as any)[prop] = sig.get();
  const ev = WRITE_BACK_EVENT[String(prop)];
  if (ev && typeof (control as any)[ev] === "function") {
    (control as any)[ev]((v: any) => sig.set(v));
  }
  return unsub;
}
