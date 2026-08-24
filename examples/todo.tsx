// A todo list, written declaratively in JSX.
//
//   bun run examples/todo.tsx
//
// Rows are created once and kept per id: a change touches only the affected
// row (checkbox + label in place), so the entrance animation plays on the new
// element alone instead of every row. Colours are theme-adaptive
// (`{ light, dark }`), following the system theme on both platforms.
import type { ThemeColor } from "bunkit";
import {
  Application, Button, Checkbox, HStack, Label, ScrollView, Separator,
  Spacer, TextField, VStack, Window, signal,
} from "bunkit";

interface Todo { id: number; text: string; done: boolean; }
interface Row { root: any; check: InstanceType<typeof Checkbox>; label: InstanceType<typeof Label>; }

const app = new Application({ name: "Todo", theme: "default" });

const todos = signal<Todo[]>([]);
const draft = signal("");
let nextId = 1;

const cardBg: ThemeColor = { light: "#FFFFFF", dark: "#23233A" };
const textColor: ThemeColor = { light: "#202124", dark: "#E8E8F2" };
const doneColor: ThemeColor = { light: "#9AA0A6", dark: "#565675" };

function addTodo(): void {
  const text = draft.value.trim();
  if (!text) return;
  const todo = { id: nextId++, text, done: false };
  todos.set([todo, ...todos.value]);
  draft.set("");
  list.insert(makeRow(todo), 0); // one new row → one entrance animation
  updateMeta();
}
function toggleTodo(id: number): void {
  const todo = todos.value.find((t) => t.id === id);
  if (!todo) return;
  const done = !todo.done;
  todos.set(todos.value.map((t) => (t.id === id ? { ...t, done } : t)));
  const r = rows.get(id);
  if (r) {
    r.check.checked = done;
    r.label.color = done ? doneColor : textColor;
  }
  updateMeta();
}
function deleteTodo(id: number): void {
  todos.set(todos.value.filter((t) => t.id !== id));
  const r = rows.get(id);
  if (r) { list.remove(r.root); rows.delete(id); }
  updateMeta();
}
function clearCompleted(): void {
  const done = todos.value.filter((t) => t.done);
  todos.set(todos.value.filter((t) => !t.done));
  for (const t of done) {
    const r = rows.get(t.id);
    if (r) { list.remove(r.root); rows.delete(t.id); }
  }
  updateMeta();
}

// ─ dynamic list: rows are created once and kept per id ──────────────────────
const list = new VStack({ spacing: 8 });
const rows = new Map<number, Row>();
const countLabel = new Label({ text: "", font: { size: 12 }, color: "secondaryLabel" });
const emptyLabel = new Label({
  text: "Nothing here yet — add a task above.",
  color: "secondaryLabel",
  font: { size: 13 },
  textAlign: "center",
});

function makeRow(todo: Todo): any {
  const check = (
    <Checkbox checked={todo.done} onChange={() => toggleTodo(todo.id)} />
  );
  const label = (
    <Label
      text={todo.text}
      grow={1}
      font={{ size: 14 }}
      color={todo.done ? doneColor : textColor}
    />
  );
  const del = <Button title="✕" onClick={() => deleteTodo(todo.id)} />;
  const root = (
    <HStack
      spacing={10}
      alignItems="center"
      padding={12}
      backgroundColor={cardBg}
      borderRadius={10}
    >
      {check}{label}{del}
    </HStack>
  );
  rows.set(todo.id, { root, check, label });
  return root;
}

function updateMeta(): void {
  const left = todos.value.filter((t) => !t.done).length;
  countLabel.text = todos.value.length === 0
    ? "no tasks"
    : `${left} left · ${todos.value.length} total`;
  emptyLabel.hidden = todos.value.length > 0;
}

// ─ the window ────────────────────────────────────────────────────────────────
const win = (
  <Window
    title="Todo"
    size={{ width: 380, height: 560 }}
    minSize={{ width: 320, height: 420 }}
    titlebarColor={{ light: "#F4F5F7", dark: "#16161E" }}
    titlebarTextColor={{ light: "#202124", dark: "#E8E8F2" }}
    background={{ light: "#F4F5F7", dark: "#16161E" }}
  >
    <VStack
      spacing={16}
      padding={24}
      backgroundColor={{ light: "#F4F5F7", dark: "#16161E" }}
    >
      <HStack spacing={8} alignItems="center">
        <Label text="Today" font={{ style: "title", weight: "semibold" }} grow={1} />
        {countLabel}
      </HStack>
      <Label text="Get things done." font={{ size: 12 }} color="secondaryLabel" />

      <HStack spacing={10}>
        <TextField
          value={draft}
          placeholder="Add a task…"
          grow={1}
          borderRadius={10}
          textColor={textColor}
          placeholderColor="secondaryLabel"
          onSubmit={addTodo}
        />
        <Button title="Add" primary onClick={addTodo} />
      </HStack>

      <Separator />

      <ScrollView grow={1} border={false}>
        <VStack spacing={8}>
          {list}
          {emptyLabel}
        </VStack>
      </ScrollView>

      <HStack spacing={10} alignItems="center">
        <Label text="Check an item to mark it done." font={{ size: 11 }} color="tertiaryLabel" grow={1} />
        <Spacer />
        <Button title="Clear completed" onClick={clearCompleted} />
      </HStack>
    </VStack>
  </Window>
);
win.quitOnClose();

void win; // the window is alive; app.run() pumps it
await app.run();
