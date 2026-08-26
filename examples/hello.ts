// The smallest useful app.
//
//   bun run examples/hello.ts

import { Application, Button, HStack, Label, TextField, VStack, Window } from "@omarcosr/bunkit";

const app = new Application({ name: "Hello" });

const name = new TextField({ placeholder: "Your name", grow: 1 });
const greeting = new Label({ text: "Type a name and press Greet.", textColor: "secondaryLabel" });

const greet = () => {
  greeting.text = name.value ? `Hello, ${name.value}!` : "Type a name first.";
};

new Window({
  title: "Hello",
  size: { width: 380, height: 260 },
  content: new VStack({ spacing: 14, padding: 20 }, [
    new Label({ text: "Greeter", font: { style: "title", weight: "semibold" } }),
    new HStack({ spacing: 8 }, [
      name,
      new Button({
        title: "Greet",
        onClick: greet,
        background: "#2D7DD2",
        borderRadius: 4,
        border: {
          top: 2,
          bottom: 2,
          left: 2,
          right: 2,
        },
        borderColor: "#4d1f1f",
        borderWidth: 2,
      }),
    ]),
    greeting,
  ]),
}).quitOnClose();

await app.run();
