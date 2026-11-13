import assert from "node:assert/strict";
import test from "node:test";
import { runSqitchOperation, sqitchComposeArguments } from "./sqitch-operation.mjs";

test("keeps supported Sqitch operations bounded to the development Compose migration job", () => {
  assert.deepEqual(sqitchComposeArguments("deploy"), [
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.dev.yml",
    "run",
    "--build",
    "--rm",
    "migrate",
    "deploy",
    "--verify",
  ]);
  assert.deepEqual(sqitchComposeArguments("verify").slice(-2), ["migrate", "verify"]);
  assert.throws(() => sqitchComposeArguments("deploy --target production"), /supported Sqitch operation/);
});

test("requires confirmation before invoking the migration container", () => {
  let confirmations = 0;
  let invocations = 0;
  const result = runSqitchOperation("deploy", {
    confirm: (description) => {
      confirmations += 1;
      assert.match(description, /rhasia-scret-dev development database/);
      return 1;
    },
    run: () => {
      invocations += 1;
      return { status: 0 };
    },
  });
  assert.equal(result, 1);
  assert.equal(confirmations, 1);
  assert.equal(invocations, 0);
});

test("runs only the selected Sqitch operation after explicit confirmation", () => {
  let invocation;
  const result = runSqitchOperation("verify", {
    confirm: () => 0,
    run: (command, arguments_, options) => {
      invocation = { command, arguments_, options };
      return { status: 0 };
    },
  });
  assert.equal(result, 0);
  assert.equal(invocation.command, "docker");
  assert.deepEqual(invocation.arguments_.slice(-2), ["migrate", "verify"]);
  assert.equal(invocation.options.env.COMPOSE_PROJECT_NAME, "rhasia-scret-dev");
  assert.ok(!invocation.arguments_.some((argument) => argument.includes("DIRECT_URL")));
});

test("rejects unsupported operations before prompting or running Docker", () => {
  let confirmations = 0;
  let invocations = 0;
  const result = runSqitchOperation("deploy --log-only", {
    confirm: () => {
      confirmations += 1;
      return 0;
    },
    run: () => {
      invocations += 1;
      return { status: 0 };
    },
  });
  assert.equal(result, 2);
  assert.equal(confirmations, 0);
  assert.equal(invocations, 0);
});
