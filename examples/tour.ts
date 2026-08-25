// A tour of the API in one screen.
//
//   bun run examples/tour.ts

import {
  Application, Window, VStack, HStack, Spacer,
  Label, Button, TextField, Table, GroupBox,
  beep, confirm, objc,
} from "bunkit";

const app = new Application({
  name: "Tour",
  menu: { file: [{ title: "New Task", shortcut: "cmd+n", onClick: add }] },
});

type Task = { title: string; done: boolean };
const tasks: Task[] = [{ title: "Ship it", done: false }];

// --- widgets are objects you keep and mutate; no re-render, no diffing -------

const input = new TextField({ placeholder: "New task…", grow: 1, onSubmit: add });

const table = new Table<Task>({
  columns: [
    { id: "title", title: "Task", flex: true },
    { id: "done", title: "Done", width: 60, textAlign: "center",
      value: (t) => (t.done ? "✓" : "") },
  ],
  rows: tasks,
  grow: 1,
  onSelect: (t) => (status.text = t ? t.title : "nothing selected"),
  onDoubleClick: (t, i) => { t.done = !t.done; table.reloadRow(i); },
});

const status = new Label({ text: "1 task", textColor: "secondaryLabel" });

function add() {
  if (!input.value) return;
  table.append({ title: input.value, done: false });
  input.value = "";
  status.text = `${table.rows.length} tasks`;
}

// --- declarative construction, callbacks instead of delegate objects --------

const win = new Window({
  title: "Tasks",
  size: { width: 460, height: 340 },
  content: new VStack({ spacing: 12, padding: 16 }, [
    new HStack({ spacing: 8 }, [input, new Button({ title: "Add", primary: true, onClick: add })]),
    table,
    new GroupBox({ title: "Selection", padding: 10 }, [
      new HStack({ spacing: 8, alignItems: "center" }, [
        status,
        new Spacer(),
        // Dialogs are sheets and return promises, so JS never freezes.
        new Button({ title: "Clear…", destructive: true, onClick: async () => {
          if (await confirm("Delete all tasks?", undefined, { destructive: true, window: win })) {
            table.rows = [];
            status.text = "0 tasks";
          }
        }}),
      ]),
    ]),
  ]),
});
win.quitOnClose();

// --- the escape hatch: anything Layer 3 does not wrap ------------------------

win.native.setTitlebarAppearsTransparent_(true);   // raw AppKit on any wrapper
objc.NSProcessInfo.processInfo().processName();    // any class, any selector
beep();

await app.run();
