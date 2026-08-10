import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelect, type SearchableSelectOption } from "./searchable-select.tsx";

const OPTIONS: SearchableSelectOption[] = [
  { value: "1", label: "Cimento CP-II", keywords: "saco" },
  { value: "2", label: "Areia média", keywords: "m3" },
  { value: "3", label: "Brita 1", keywords: "pedra" },
];

afterEach(cleanup);

function hidden(name: string) {
  return document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
}

test("mostra o rótulo da opção selecionada e reflete o valor no input oculto (defaultValue)", () => {
  render(<SearchableSelect name="insumo" options={OPTIONS} defaultValue="2" />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  assert.equal(input.value, "Areia média");
  assert.equal(hidden("insumo")?.value, "2");
});

test("digitar filtra a lista de opções", async () => {
  const user = userEvent.setup();
  render(<SearchableSelect name="insumo" options={OPTIONS} />);
  const input = screen.getByRole("combobox");
  await user.click(input);
  await user.type(input, "brita");
  const listbox = screen.getByRole("listbox");
  const opts = within(listbox).getAllByRole("option");
  assert.equal(opts.length, 1);
  assert.match(opts[0].textContent ?? "", /Brita 1/);
});

test("selecionar uma opção grava o valor, mostra o rótulo, fecha a lista e chama onValueChange", async () => {
  const user = userEvent.setup();
  const seen: string[] = [];
  render(<SearchableSelect name="insumo" options={OPTIONS} onValueChange={(v) => seen.push(v)} />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  await user.click(input);
  await user.click(within(screen.getByRole("listbox")).getByText("Cimento CP-II"));
  assert.equal(hidden("insumo")?.value, "1");
  assert.equal(input.value, "Cimento CP-II");
  assert.equal(screen.queryByRole("listbox"), null);
  assert.deepEqual(seen, ["1"]);
});

test("controlado: mudar a prop value atualiza o texto exibido no input (contrato do effect de sync)", () => {
  const { rerender } = render(<SearchableSelect name="insumo" options={OPTIONS} value="1" />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  assert.equal(input.value, "Cimento CP-II");
  rerender(<SearchableSelect name="insumo" options={OPTIONS} value="3" />);
  assert.equal(input.value, "Brita 1");
  assert.equal(hidden("insumo")?.value, "3");
});
