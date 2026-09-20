import { describe, expect, it } from "vitest";
import { ApiRequest, ApiResponse } from "./api-request";
import { appendSetCookies } from "./cookies";

describe("API HTTP adapters", () => {
  it("parses request cookies without making them mutable", () => {
    const request = new ApiRequest("https://api.example.test/v1/me", {
      headers: { cookie: "session=abc%20123; empty=; malformed" },
    });
    expect(request.nextUrl.pathname).toBe("/v1/me");
    expect(request.cookies.get("session")).toEqual({ value: "abc 123" });
    expect(request.cookies.get("empty")).toEqual({ value: "" });
    expect(request.cookies.get("missing")).toBeUndefined();
  });

  it("appends secure response cookies while preserving the response", async () => {
    const response = ApiResponse.json({ ok: true }, { status: 200 });
    response.cookies.set("session", "opaque value", {
      httpOnly: true,
      maxAge: 60,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    const forwarded = appendSetCookies(response, response.cookies);
    expect(forwarded.status).toBe(200);
    expect(await forwarded.json()).toEqual({ ok: true });
    expect(forwarded.headers.get("set-cookie")).toContain("session=opaque%20value");
    expect(forwarded.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
