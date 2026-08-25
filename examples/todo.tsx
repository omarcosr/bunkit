// A todo list, written declaratively in JSX.
//
//   bun run examples/todo.tsx
//
// Rows are created once and kept per id: a change touches only the affected
// row (checkbox + label in place), so the entrance animation plays on the new
// element alone instead of every row. Colours are theme-adaptive
// (`{ light, dark }`), following the system theme on both platforms.
import type { ThemeColor, ThemeShadow } from "bunkit";
import {
  Application, Button, Checkbox,
  For,
  HStack, ImageView, Label,
  ScrollView, Separator, Spacer,
  TextField, VStack, Window,
  defineTheme,
  signal
} from "bunkit";

interface Todo { id: number; text: string; done: boolean; }

const app = new Application({ name: "Todo", theme: "default" });

const todos = signal<Todo[]>([]);
const draft = signal("");
let nextId = 1;

const cardBg: ThemeColor = { light: "#FFFFFF", dark: "#23233A" };
const textColor: ThemeColor = { light: "#202124", dark: "#E8E8F2" };
const doneColor: ThemeColor = { light: "#9AA0A6", dark: "#565675" };

const addShadow: ThemeShadow = {
  light: "0px 0px 10px #000000",
  dark: "0px 0px 10px #FFFFFF",
};

function addTodo(): void {
  const text = draft.value.trim();
  if (!text) return;
  const todo = { id: nextId++, text, done: false };
  todos.set([todo, ...todos.value]);
  draft.set("");
}
function toggleTodo(id: number): void {
  const todo = todos.value.find((t) => t.id === id);
  if (!todo) return;
  const done = !todo.done;
  todos.set(todos.value.map((t) => (t.id === id ? { ...t, done } : t)));
}
function deleteTodo(id: number): void {
  todos.set(todos.value.filter((t) => t.id !== id));
}
function clearCompleted(): void {
  todos.set(todos.value.filter((t) => !t.done));
}

// ─ the list: a declarative <For> reconciles the rows from the signal ────────
const countLabel = new Label({ text: "", font: { size: 12 }, textColor: "secondaryLabel" });
const emptyLabel = new Label({
  text: "Nothing here yet — add a task above.",
  textColor: "secondaryLabel",
  font: { size: 13 },
  textAlign: "center",
});

// Derived UI (count, empty state) is reactive too: it follows the signal.
todos.subscribe(() => {
  const left = todos.value.filter((t) => !t.done).length;
  countLabel.text = todos.value.length === 0
    ? "no tasks"
    : `${left} left · ${todos.value.length} total`;
  emptyLabel.hidden = todos.value.length > 0;
});

function row(todo: Todo) {
  return (
    <HStack
      spacing={10}
      alignItems="center"
      padding={10}
      backgroundColor={cardBg}
      borderRadius={10}
    >
      <Checkbox checked={todo.done} onChange={() => toggleTodo(todo.id)} />
      <Label
        text={todo.text}
        grow={1}
        font={{ size: 14 }}
        textColor={todo.done ? doneColor : textColor}
      />
      <Button title="✕" onClick={() => deleteTodo(todo.id)} />
    </HStack>
  );
}

const theme = defineTheme({
  colors: {
    buttonBackground: {
      light: "#2D7DD2",
      dark: "#315A91",
    },
    buttonHover: {
      light: "#3A8BE0",
      dark: "#4776B7",
    },
    focus: {
      light: "#2457D6",
      dark: "#8BA7FF",
    },
  },

  shadows: {
    button: {
      light: "0 2px 8px #00000040",
      dark: "0 2px 8px #FFFFFF40",
    },
    buttonHover: {
      light: "0 3px 10px #00000060",
      dark: "0 3px 10px #FFFFFF60",
    },
  },
});

// ─ the window ────────────────────────────────────────────────────────────────
const win = (
  <Window
    title="Todo"
    size={{ width: 380, height: 560 }}
    minSize={{ width: 320, height: 420 }}
    titlebarColor={{ light: "#F4F5F7", dark: "#16161E" }}
    titlebarTextColor={{ light: "#202124", dark: "#E8E8F2" }}
    background={{ light: "#F4F5F7", dark: "#16161E" }}
    icon="./icons/sparkle.ico"
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
      <ImageView src="./icons/sparkle.svg" width={24} height={24} tint="#5bd680" />
      <Label text="Get things done." font={{ size: 12 }} textColor="secondaryLabel" />

      <HStack spacing={10}>
        <TextField
          value={draft}
          placeholder="Add a task…"
          grow={1}
          borderRadius={4}
          textColor={textColor}
          borderColor={{ light: "#DADCE0", dark: "#3939fd" }}
          backgroundColor={{ light: "#FFFFFF", dark: "#0000ff" }}
          placeholderColor="#ffffff"
          onSubmit={addTodo}

          shadow={{
            light: "0px 0px 10px #FFFFFF",
            dark: "0px 0px 10px #0000ff",
          }}

          states={{
            hover: {
              placeholderColor: "#011213",
              textColor: "#011213",
              shadow: {
                light: "0px 0px 10px #000000",
                dark: "0px 0px 10px #FFFFFF",
              }
            },
            focus: {
              shadow: {
                light: "0px 0px 10px #000000",
                dark: "0px 0px 10px #FFFFFF",
              }
            },
          }}


        // shadow="0px 0px 10px #0000ff"
        />
        <Button title="Add" onClick={addTodo} style={{
          border: 1,
          borderColor: "#ffffff",
          textColor: {
            light: "#1900ff",
            dark: "#011213",
          },
          borderRadius: 4,
          shadow: addShadow
        }} states={{
          hover: {
            backgroundColor: "#ff00ff", borderColor: "#ff00ff", textColor: "#ffffff", shadow: {
              light: "0px 0px 10px #000000",
              dark: "0px 0px 10px #ff00ff",
            }
          },
          focus: { borderColor: "#ff00ff" },
          pressed: { alpha: 0.8 },
          disabled: { alpha: 0.45, textColor: "#011213" },
        }} />
      </HStack>


      <Separator />

      <ScrollView grow={1} border={false}>
        <VStack spacing={8}>
          <For each={todos} by={(todo: Todo) => todo.id} spacing={8}>
            {row}
          </For>
          {emptyLabel}
        </VStack>
      </ScrollView>

      <HStack spacing={10} alignItems="center">
        <Label text="Check an item to mark it done." font={{ size: 11 }} textColor="tertiaryLabel" grow={1} />
        <Spacer />
        <Button title="Clear completed" onClick={clearCompleted} />
      </HStack>
    </VStack>
  </Window>
);
win.quitOnClose();

void win; // the window is alive; app.run() pumps it
await app.run();
