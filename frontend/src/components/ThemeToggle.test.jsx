import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("switches between day and night themes and remembers the selection", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "နေ့ဘက်ပုံစံသို့ ပြောင်းမည်" }));
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(window.localStorage.getItem("imposter-theme")).toBe("day");

    fireEvent.click(screen.getByRole("button", { name: "ညဘက်ပုံစံသို့ ပြောင်းမည်" }));
    expect(document.documentElement.dataset.theme).toBe("night");
    expect(window.localStorage.getItem("imposter-theme")).toBe("night");
  });
});
