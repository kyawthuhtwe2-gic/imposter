import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SelectBox from "./SelectBox";

function renderSelect(props = {}) {
  return render(
    <SelectBox id="category" value="tea" onValueChange={vi.fn()} {...props}>
      <option value="tea">Tea</option>
      <option value="coffee">Coffee</option>
      <option value="juice">Juice</option>
    </SelectBox>,
  );
}

describe("SelectBox", () => {
  it("opens a styled list and changes the selected value", () => {
    const onValueChange = vi.fn();
    renderSelect({ onValueChange });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Coffee" }));

    expect(onValueChange).toHaveBeenCalledWith("coffee");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox").textContent).toContain("Tea");
  });

  it("supports keyboard selection and Escape", () => {
    const onValueChange = vi.fn();
    renderSelect({ onValueChange });
    const select = screen.getByRole("combobox");

    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("coffee");

    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not open when disabled", () => {
    renderSelect({ disabled: true });

    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});