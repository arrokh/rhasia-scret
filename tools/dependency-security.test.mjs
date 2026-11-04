import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const braces = require("braces");
const fastUri = require("fast-uri");
const { Address4, Address6 } = require("ip-address");
const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const testcontainersRequire = createRequire(apiRequire.resolve("testcontainers"));
const archiverRequire = createRequire(testcontainersRequire.resolve("archiver"));
const archiverUtilsRequire = createRequire(archiverRequire.resolve("archiver-utils"));
const glob = archiverUtilsRequire("glob");
const eslintRequire = createRequire(apiRequire.resolve("eslint"));
const { Minimatch } = eslintRequire("minimatch");

test("modern minimatch bounds optimization-level-2 pattern amplification", () => {
  const matcher = new Minimatch(Array(30).fill("**/../a/b").join("/"), {
    optimizationLevel: 2,
    braceExpandMax: 64,
  });
  assert.equal(matcher.set.length, 64);
  const large = new Minimatch("{x,*}/{0..999}", { optimizationLevel: 2 });
  assert.equal(large.set.length, 2000);
  assert.equal(large.match("y/999"), true);
  assert.equal(large.match(".y/5"), false);
});

test("legacy minimatch callers retain the callable API without the affected preprocessing", () => {
  const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const nextRequire = createRequire(webRequire.resolve("eslint-config-next"));
  const importRequire = createRequire(nextRequire.resolve("eslint-plugin-import"));
  const readdirRequire = createRequire(archiverRequire.resolve("readdir-glob"));
  for (const legacyRequire of [importRequire, readdirRequire]) {
    const minimatch = legacyRequire("minimatch");
    assert.equal(typeof minimatch, "function");
    assert.equal(minimatch("example.ts", "*.ts"), true);
    assert.equal(minimatch.Minimatch.prototype.firstPhasePreProcess, undefined);
    assert.equal(minimatch.Minimatch.prototype.secondPhasePreProcess, undefined);
  }
});

test("archiver-utils retains CommonJS glob expansion and exclusion behavior", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "rhasia-glob-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "nested"));
  await writeFile(join(cwd, "nested", "example.txt"), "synthetic fixture");
  await writeFile(join(cwd, "nested", "skip.txt"), "synthetic fixture");
  const { file } = archiverRequire("archiver-utils");
  assert.deepEqual(file.expand({ cwd, nodir: true }, ["**/*.txt", "!**/skip.txt"]), ["nested/example.txt"]);
});

test("glob stops filesystem traversal after cancellation", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "rhasia-glob-abort-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "nested", "deeper"), { recursive: true });
  await writeFile(join(cwd, "nested", "deeper", "example.txt"), "synthetic fixture");
  for (const stream of [false, true]) {
    const controller = new AbortController();
    const reason = new Error("synthetic cancellation");
    let reads = 0;
    const filesystem = {
      ...fs,
      readdir(...args) {
        reads += 1;
        controller.abort(reason);
        return fs.readdir(...args);
      },
    };
    const options = { cwd, fs: filesystem, signal: controller.signal };
    const walk = stream
      ? (async () => {
          for await (const entry of glob.globStream("**/*", options)) {
            assert.fail(`Unexpected entry after abort: ${entry}`);
          }
        })()
      : glob.glob("**/*", options);
    await assert.rejects(walk, reason);
    await setImmediate();
    await setImmediate();
    assert.equal(reads, 1);
  }
});

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
