import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/shared/presentation/styles/globals.css"), "utf8");
const statusBanner = readFileSync(join(process.cwd(), "src/shared/presentation/app-ui.tsx"), "utf8");

function cssVariable(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`Missing CSS color token: ${name}`);
  return value;
}

function channels(color: string): [number, number, number] {
  const values = color.match(/[0-9a-f]{2}/gi)?.map((channel) => Number.parseInt(channel, 16));
  if (!values || values.length !== 3) throw new Error(`Invalid CSS color: ${color}`);
  return [values[0]!, values[1]!, values[2]!];
}

function luminance(color: string): number {
  const [red, green, blue] = channels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function composite(foreground: string, background: string, opacity: number): string {
  return `#${channels(foreground)
    .map((channel, index) => Math.round(channel * opacity + channels(background)[index]! * (1 - opacity)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("UI text contrast tokens", () => {
  it("keeps warning banner copy at WCAG AA contrast, including its reduced-opacity description", () => {
    const foreground = cssVariable("warning");
    const background = cssVariable("warning-surface");
    const descriptionClass = statusBanner.match(/<AlertDescription className="([^"]+)"/)?.[1];
    if (!descriptionClass) throw new Error("StatusBanner description styling is missing.");
    const opacity = descriptionClass.includes("text-current/90") ? 0.9 : 1;

    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(composite(foreground, background, opacity), background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps Vault badges readable on the muted surface", () => {
    expect(contrast(cssVariable("muted-foreground"), cssVariable("muted"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps public-document links at WCAG AA contrast on the page background", () => {
    expect(contrast(cssVariable("foreground"), cssVariable("background"))).toBeGreaterThanOrEqual(4.5);
  });
});
