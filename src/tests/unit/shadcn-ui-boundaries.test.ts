import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const uiRoot = join(sourceRoot, "components/ui");
const visualRoots = [join(sourceRoot, "app"), join(sourceRoot, "modules"), join(sourceRoot, "shared")];

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("shadcn/ui design-system boundaries", () => {
  it("keeps shadcn configured as the sole component-system foundation", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "components.json"), "utf8")) as { style?: string; base?: string };
    expect(config.style).toBe("radix-nova");
    expect(filesUnder(uiRoot).length).toBeGreaterThan(10);
  });

  it("routes visible controls through shadcn primitives", () => {
    const violations = visualRoots.flatMap(filesUnder)
      .filter((path) => !path.startsWith(uiRoot))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const withoutPermittedFileInput = source.replace(/<input className="sr-only"/g, "<FileInput");
        return /<(button|input|select|textarea|dialog|details|summary)(\s|>)/.test(withoutPermittedFileInput)
          ? [relative(process.cwd(), path)]
          : [];
      });
    expect(violations).toEqual([]);
  });

  it("encodes the documented Rhasia palette and rejects the former indigo system", () => {
    const css = readFileSync(join(sourceRoot, "app/globals.css"), "utf8").toLowerCase();
    for (const color of ["#273039", "#171d22", "#e5a72e", "#c88717", "#f5d998", "#91867e", "#b9ada3", "#f8f4ed", "#fffdf9", "#ded8d0", "#3d7452", "#a5661b", "#a4433d", "#526d82"]) expect(css).toContain(color);
    expect(css).not.toMatch(/#312e81|#4f46e5|#172554|#f8fafc/);
    expect(css).not.toContain("gradient");
  });
});
