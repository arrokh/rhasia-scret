import { messages, translate } from "./localization";

describe("mobile localization", () => {
  it("keeps exact Indonesian and English catalog parity with non-empty copy", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.id).sort());
    expect(Object.values(messages.id).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.values(messages.en).every((value) => value.trim().length > 0)).toBe(true);
  });

  it("uses Indonesian as the deterministic initial locale", () => {
    expect(translate("id").emailLabel).toBe("Alamat email");
    expect(translate("en").emailLabel).toBe("Email address");
  });
});
