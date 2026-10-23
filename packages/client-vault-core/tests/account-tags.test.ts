import { describe, expect, it } from "vitest";
import {
  AccountTagValidationError,
  MAX_AUTHENTICATOR_ACCOUNT_TAGS,
  matchesAuthenticatorAccountTagFilter,
  normalizeAuthenticatorAccountTags,
} from "../src/modules/authenticator-account/domain/account-tags";

describe("Authenticator Account tags", () => {
  it("matches accounts when any selected tag is present and treats no selection as unfiltered", () => {
    expect(matchesAuthenticatorAccountTagFilter(undefined, [])).toBe(true);
    expect(matchesAuthenticatorAccountTagFilter(["Work"], [])).toBe(true);
    expect(matchesAuthenticatorAccountTagFilter(["Work", "Recovery"], ["Recovery", "Other"])).toBe(true);
    expect(matchesAuthenticatorAccountTagFilter(["Work"], ["Recovery"])).toBe(false);
    expect(matchesAuthenticatorAccountTagFilter(undefined, ["Recovery"])).toBe(false);
  });

  it("allows no tags and trims accepted tag names", () => {
    expect(normalizeAuthenticatorAccountTags([])).toEqual([]);
    expect(normalizeAuthenticatorAccountTags(["  Work  ", "Recovery"])).toEqual(["Work", "Recovery"]);
  });

  it("rejects empty names, duplicate names, and excessive tag counts", () => {
    expect(() => normalizeAuthenticatorAccountTags([" "])).toThrowError(expect.objectContaining({ code: "empty" }));
    expect(() => normalizeAuthenticatorAccountTags(["Work", "work"])).toThrowError(
      expect.objectContaining({ code: "duplicate" }),
    );
    expect(() =>
      normalizeAuthenticatorAccountTags(
        Array.from({ length: MAX_AUTHENTICATOR_ACCOUNT_TAGS + 1 }, (_, index) => `Tag ${index}`),
      ),
    ).toThrowError(expect.objectContaining({ code: "tooMany" }));
  });

  it("bounds tag length by Unicode code points and rejects control characters and non-string values", () => {
    expect(normalizeAuthenticatorAccountTags(["😀".repeat(32)])).toEqual(["😀".repeat(32)]);
    expect(() => normalizeAuthenticatorAccountTags(["😀".repeat(33)])).toThrowError(
      expect.objectContaining({ code: "tooLong" }),
    );
    expect(() => normalizeAuthenticatorAccountTags(["x".repeat(33)])).toThrowError(
      expect.objectContaining({ code: "tooLong" }),
    );
    expect(() => normalizeAuthenticatorAccountTags(["work\nnotes"])).toThrowError(
      expect.objectContaining({ code: "controlCharacter" }),
    );
    expect(() => normalizeAuthenticatorAccountTags([1])).toThrowError(expect.objectContaining({ code: "notString" }));
    expect(() => normalizeAuthenticatorAccountTags("work")).toThrowError(AccountTagValidationError);
  });
});
