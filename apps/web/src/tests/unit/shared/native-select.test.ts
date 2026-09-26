/** @vitest-environment jsdom */

import { act, createElement, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeSelect } from "@/components/ui/native-select";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("NativeSelect", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
  });

  it("keeps an accessible native combobox, standard geometry, and controlled change events", async () => {
    const onChange = vi.fn((event: ChangeEvent<HTMLSelectElement>) => event.currentTarget.value);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(
          NativeSelect,
          { "aria-label": "Vault", value: "personal", onChange },
          createElement("option", { value: "personal" }, "Personal Vault"),
          createElement("option", { value: "shared" }, "Shared Vault"),
        ),
      ),
    );

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Vault"]');
    expect(select?.getAttribute("data-slot")).toBe("native-select");
    expect(select?.className).toContain("h-11");
    expect(select?.value).toBe("personal");
    expect(container.querySelector('svg[aria-hidden="true"]')?.getAttribute("class")).toContain("lucide-chevron-down");

    await act(async () => {
      if (!select) throw new Error("Expected a native select.");
      select.value = "shared";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.results[0]?.value).toBe("shared");
  });
});
