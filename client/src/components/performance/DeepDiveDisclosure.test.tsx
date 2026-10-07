import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DeepDiveDisclosure from "./DeepDiveDisclosure";

describe("DeepDiveDisclosure", () => {
  it("starts collapsed and reveals the existing analysis only when opened", () => {
    render(<DeepDiveDisclosure><p>Existing analysis contents</p></DeepDiveDisclosure>);
    const trigger = screen.getByRole("button", { name: /deep dive/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Existing analysis contents")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Existing analysis contents")).toBeInTheDocument();
  });
});
