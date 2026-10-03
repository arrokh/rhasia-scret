import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const braces = require("braces");
const fastUri = require("fast-uri");
const { Address4, Address6 } = require("ip-address");

function nestedBraces(depth) {
  return `${"{".repeat(depth)}a,b${"}".repeat(depth)}`;
}

function nestedParentheses(depth) {
  return `${"(".repeat(depth)}a${")".repeat(depth)}`;
}

function nestedAst(depth) {
  let node = { type: "text", value: "leaf" };

  for (let index = 0; index < depth; index += 1) {
    node = { type: "brace", nodes: [node] };
  }

  return { type: "root", nodes: [node] };
}

test("braces bounds parsed nesting and preserves the stringifier's existing output", () => {
  assert.throws(() => braces(nestedBraces(101)), /exceeds max depth/);
  assert.throws(() => braces(nestedBraces(101), { expand: true }), /exceeds max depth/);
  assert.throws(() => braces.parse(nestedParentheses(101)), /exceeds max depth/);
  assert.doesNotThrow(() => braces.parse(nestedBraces(100)));
  assert.throws(() => braces.parse("{{a,b},c}", { maxDepth: 1 }), /exceeds max depth/);
  assert.doesNotThrow(() => braces.parse("{{a,b},c}", { maxDepth: 2 }));
  assert.throws(() => braces.parse("{{a,b},c}", { maxDepth: 1.5 }), /exceeds max depth/);

  const patterns = ["{{a}}", "{a,{b}}", "{1..8}"];
  const stringified = patterns.map((pattern) => braces.stringify(braces.parse(pattern), { escapeInvalid: true }));
  assert.deepEqual(stringified, patterns);
});

test("braces guards recursive operations on caller-supplied ASTs", () => {
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => operation(nestedAst(101)), { name: "RangeError" });
  }
});

test("fast-uri normalizes percent-encoded host case consistently", () => {
  assert.equal(fastUri.parse("//%41.example.test").host, "a.example.test");
  assert.equal(fastUri.equal("//%41.example.test", "//a.example.test"), true);
});

test("ip-address rejects cross-family subnet comparisons", () => {
  assert.equal(new Address6("a00::1").isInSubnet(new Address4("10.0.0.0/8")), false);
  assert.equal(new Address4("32.1.13.184").isInSubnet(new Address6("2001:db8::/32")), false);
  assert.equal(new Address6("2001:db8::1").isInSubnet(new Address6("2001:db8::/32")), true);
  assert.equal(new Address4("10.0.0.1").isInSubnet(new Address4("10.0.0.0/8")), true);
});

test("ip-address rejects overlong IPv6 diagnostics before constructing them", () => {
  assert.throws(
    () => new Address6("!".repeat(46)),
    (error) => {
      return error instanceof Error && error.name === "AddressError" && error.parseMessage === undefined;
    },
  );
});
