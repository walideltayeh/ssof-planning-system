import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIncludeFoc } from "./useIncludeFoc";

function Toggle({ country }: { country: "Libya" | "Syria" }) {
  const { includeFoc, setIncludeFoc } = useIncludeFoc(country);
  return <button type="button" onClick={() => setIncludeFoc(!includeFoc)}>{country}: {String(includeFoc)}</button>;
}

describe("country-scoped Include FOC", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("defaults on and restores each country's independent selection", () => {
    const view = render(<Toggle country="Libya" />);
    expect(screen.getByRole("button")).toHaveTextContent("Libya: true");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("Libya: false");
    view.rerender(<Toggle country="Syria" />);
    expect(screen.getByRole("button")).toHaveTextContent("Syria: true");
    fireEvent.click(screen.getByRole("button"));
    view.rerender(<Toggle country="Libya" />);
    expect(screen.getByRole("button")).toHaveTextContent("Libya: false");
  });
});
