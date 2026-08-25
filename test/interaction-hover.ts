import { expect, test } from "bun:test";
import { enableMacMouseMovedEvents } from "../src/ui/macos-interaction.ts";

test("hover tracking enables mouse-moved events after a view is attached", () => {
  let enabled = false;
  const target = {
    native: {
      window: () => ({
        ptr: 1n,
        setAcceptsMouseMovedEvents_: (value: boolean) => { enabled = value; },
      }),
    },
  };

  enableMacMouseMovedEvents(target);
  expect(enabled).toBe(true);
});
