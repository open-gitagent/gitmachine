import { GitMachine, E2BMachine } from "../src/index.js";

const E2B_KEY = process.env.E2B_API_KEY!;
const GH_TOKEN = process.env.GITHUB_PAT!;
const REPO = "https://github.com/open-gitagent/gitmachine-test.git";

async function testSequential() {
  console.log("\n══════ PATTERN 1: Sequential Async (real push) ══════\n");

  const machine = new E2BMachine({ apiKey: E2B_KEY, timeout: 120 });

  const gm = new GitMachine({
    machine,
    repository: REPO,
    token: GH_TOKEN,
    session: "session-sequential",
    autoCommit: true,
    onStart: async (gm) => console.log("  [onStart] id:", gm.id),
    onPause: async (gm) => console.log("  [onPause] id:", gm.id),
    onResume: async (gm) => console.log("  [onResume] id:", gm.id),
    onEnd: async (gm) => console.log("  [onEnd] id:", gm.id),
    onEvent: (event, data) => console.log(`  [${event}]`, JSON.stringify(data)),
  });

  // 1. Start — clone + create branch
  console.log("1. Starting...");
  await gm.start();
  console.log("   ID:", gm.id, "| State:", gm.state);

  // 2. Create files
  console.log("2. Creating files...");
  await gm.run("echo 'created by gitmachine' > machine.txt");
  await gm.run("echo '{\"test\": true}' > data.json");
  await gm.run("mkdir -p src && echo 'console.log(\"hello\")' > src/index.js");

  // 3. Diff
  console.log("3. Diff:");
  const diff = await gm.diff();
  console.log(diff);

  // 4. Manual commit
  console.log("4. Committing...");
  const sha = await gm.commit("feat: add initial files from gitmachine");
  console.log("   SHA:", sha);

  // 5. Push
  console.log("5. Pushing...");
  await gm.push();
  console.log("   Pushed to session-sequential branch ✓");

  // 6. Verify hash
  console.log("6. Hash:", await gm.hash());

  // 7. Pause — triggers auto-commit (no changes, so no-op)
  console.log("7. Pausing...");
  await gm.pause();
  console.log("   State:", gm.state);

  // 8. Resume
  console.log("8. Resuming...");
  await gm.resume();
  console.log("   State:", gm.state);

  // 9. Make another change
  console.log("9. Making another change...");
  await gm.run("echo 'second update' >> machine.txt");

  // 10. Stop — auto-commit + push kicks in
  console.log("10. Stopping (auto-commit + push)...");
  await gm.stop();
  console.log("    State:", gm.state);
  console.log("    Logs:", gm.logs().length, "commands executed");

  console.log("\n✓ Sequential done — check https://github.com/open-gitagent/gitmachine-test/tree/session-sequential\n");
}

async function testFireAndForget() {
  console.log("\n══════ PATTERN 2: Fire & Forget (real push) ══════\n");

  const machine = new E2BMachine({ apiKey: E2B_KEY, timeout: 120 });

  const gm = new GitMachine({
    machine,
    repository: REPO,
    token: GH_TOKEN,
    session: "session-fire-forget",
    autoCommit: true,
    onStart: async (gm) => console.log("  [onStart] id:", gm.id),
    onEnd: async (gm) => console.log("  [onEnd] id:", gm.id),
    onEvent: (event, data) => console.log(`  [${event}]`, JSON.stringify(data)),
  });

  // 1. Start
  await gm.start();
  const sandboxId = gm.id!;
  console.log("1. Started, sandbox:", sandboxId);

  // 2. Fire and forget — create files + don't await
  const workDone = gm.run(
    "echo 'fire-and-forget file' > ff.txt && echo 'timestamp:' $(date -u) >> ff.txt && sleep 2 && echo 'work complete'",
    { onStdout: (d) => { console.log("   [stdout]", d.trim()); } }
  );
  console.log("2. Work kicked off — not awaiting");
  console.log("   → Server would return { sandboxId:", sandboxId, "}\n");

  // 3. Reconnect from "another server"
  console.log("3. Reconnecting...");
  const machine2 = await E2BMachine.connect(sandboxId, { apiKey: E2B_KEY });
  const gm2 = await GitMachine.connect(machine2, {
    repository: REPO,
    token: GH_TOKEN,
    session: "session-fire-forget",
    autoCommit: true,
    onEvent: (event, data) => console.log(`  [reconnected:${event}]`, JSON.stringify(data)),
  });
  console.log("   State:", gm2.state, "| ID:", gm2.id);

  // 4. Query from reconnected instance
  const hash = await gm2.hash();
  console.log("4. HEAD from reconnected:", hash);

  // 5. Wait for fire-and-forget to finish
  console.log("5. Waiting for background work...");
  const result = await workDone;
  console.log("   Exit code:", result.exitCode);

  // 6. Commit + push from original gm
  console.log("6. Committing + pushing...");
  const sha = await gm.commit("feat: fire-and-forget file");
  console.log("   SHA:", sha);
  await gm.push();
  console.log("   Pushed ✓");

  // 7. Stop
  console.log("7. Stopping...");
  await gm.stop();
  console.log("   State:", gm.state);

  console.log("\n✓ Fire-and-forget done — check https://github.com/open-gitagent/gitmachine-test/tree/session-fire-forget\n");
}

async function main() {
  try {
    await testSequential();
    await testFireAndForget();
    console.log("═══════════════════════════════════════════");
    console.log("ALL TESTS PASSED ✓");
    console.log("Verify at: https://github.com/open-gitagent/gitmachine-test/branches");
  } catch (err) {
    console.error("\nFAILED:", err);
    process.exit(1);
  }
}

main();
