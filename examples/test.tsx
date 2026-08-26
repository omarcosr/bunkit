import { Application, Button, Label, VStack, Window } from "@omarcos/bunkit";

const app = new Application({ name: "Counter" });
let count = 0;
const label = <Label text="0" />;

const window = (
  <Window title="Counter" size={{ width: 280, height: 160 }}>
    <VStack spacing={12} padding={20}>
      {label}
      <Button
        title="Add"
        borderRadius={14}
        shadow="0 0 14px #ff00ff"
        onClick={() => {
          label.text = String(++count);
        }}
      />
    </VStack>
  </Window>
);

window.quitOnClose();
await app.run();
