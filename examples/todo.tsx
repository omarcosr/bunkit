// A todo list, written declaratively in JSX.
//
//   bun run examples/todo.tsx
//
// The rows are signal-driven: every change re-renders them into a stack.
// Colours are theme-adaptive (`{ light, dark }`), so the app follows the
// system theme on both platforms.
import {
  Application, Button, Checkbox, HStack, Label, ScrollView, Separator,
  Spacer, TextField, VStack, Window, signal,
} from "bunkit";

interface Todo { id: number; text: string; done: boolean; }

const app = new Application({ name: "Todo", theme: "default" });

const todos = signal<Todo[]>([]);
const draft = signal("");
let nextId = 1;

function addTodo(): void {
  const text = draft.value.trim();
  if (!text) return;
  todos.set([{ id: nextId++, text, done: false }, ...todos.value]);
  draft.set("");
}
function toggleTodo(id: number): void {
  todos.set(todos.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
}
function deleteTodo(id: number): void {
  todos.set(todos.value.filter((t) => t.id !== id));
}
function clearCompleted(): void {
  todos.set(todos.value.filter((t) => !t.done));
}

// ─ dynamic list: the rows re-render into `list` whenever `todos` changes ─────
const list = new VStack({ spacing: 8 });
const countLabel = new Label({ text: "", font: { size: 12 }, color: "secondaryLabel" });
const emptyLabel = new Label({
  text: "Nothing here yet — add a task above.",
  color: "secondaryLabel",
  font: { size: 13 },
  textAlign: "center",
});

function row(todo: Todo) {
  return (
    <HStack
      spacing={10}
      alignItems="center"
      padding={12}
      backgroundColor={{ light: "#FFFFFF", dark: "#23233A" }}
      borderRadius={10}
    >
      <Checkbox checked={todo.done} onChange={() => toggleTodo(todo.id)} />
      <Label
        text={todo.text}
        grow={1}
        font={{ size: 14 }}
        color={todo.done
          ? { light: "#9AA0A6", dark: "#565675" }
          : { light: "#202124", dark: "#E8E8F2" }}
      />
      <Button title="✕" onClick={() => deleteTodo(todo.id)} />
    </HStack>
  );
}

function render(): void {
  list.removeAll();
  for (const todo of todos.value) list.add(row(todo));
  const left = todos.value.filter((t) => !t.done).length;
  countLabel.text = todos.value.length === 0
    ? "no tasks"
    : `${left} left · ${todos.value.length} total`;
  emptyLabel.hidden = todos.value.length > 0;
}
todos.subscribe(render);
render();

// ─ the window ────────────────────────────────────────────────────────────────
const win = (
  <Window title="Todo" size={{ width: 380, height: 560 }} minSize={{ width: 320, height: 420 }}>
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
          textColor={{ light: "#202124", dark: "#E8E8F2" }}
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
