import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EvalBar } from "../src/index.js";

afterEach(cleanup);

describe("EvalBar", () => {
  it("fills Red's share and exposes the score to screen readers", () => {
    const { container } = render(<EvalBar value={0.5} label="+1.50" />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuetext")).toBe("+1.50");
    expect((container.querySelector("[role=meter] > div") as HTMLElement).style.height).toBe("75%");
  });
  it("shows an even bar while pending", () => {
    const { container } = render(<EvalBar value={1} pending />);
    expect((container.querySelector("[role=meter] > div") as HTMLElement).style.height).toBe("50%");
  });
});
