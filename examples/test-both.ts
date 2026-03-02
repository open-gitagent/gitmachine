import { GitMachine, E2BMachine } from "../src/index.js";

const E2B_KEY = process.env.E2B_API_KEY!;
const REPO = "https://github.com/open-gitagent/gitagent.git";

// ─── Pattern 1: Sequential async ─────────────────────────────────

async function sequentialPattern() {
  console.log("\n══════ PATTERN 1: Sequential Async ══════\n");

  const machine = new E2BMachine({ apiKey: E2B_KEY, timeout: 120 });

  const gm = new GitMachine({
    machine,
    repository: REPO,
    token: "dummy", // public repo, no push
    session: "test-sequential",
    autoCommit: false, // skip push since no real PAT
    onStart: async (gm) => {
      console.log("  [onStart] sandbox:", gm.id);
    },
    onPause: async (gm) => {
      console.log("  [onPause] sandbox:", gm.id);
    },
    onResume: async (gm) => {
      console.log("  [onResume] sandbox:", gm.id);
    },
    onEnd: async (gm) => {
      console.log("  [onEnd] sandbox:", gm.id);
    },
    onEvent: (event, data) => {
      console.log(`  [event:${event}]`, JSON.stringify(data));
    },
  });

  console.log("1. Starting machine...");
  await gm.start();
  console.log("   State:", gm.state, "| ID:", gm.id);

  console.log("2. Listing repo files...");
  const ls = await gm.run("ls -1");
  console.log("   Files:", ls.stdout.trim().split("\n").join(", "));

  console.log("3. Getting git hash...");
  const hash = await gm.hash();
  console.log("   HEAD:", hash);

  console.log("4. Making a change + diffing...");
  await gm.run("echo 'hello from gitmachine' > test-file.txt");
  const diff = await gm.diff();
  console.log("   Diff:\n", diff.slice(0, 300));

  console.log("5. Committing...");
  const sha = await gm.commit("test commit from sequential pattern");
  console.log("   Commit SHA:", sha);

  console.log("6. Pausing...");
  await gm.pause();
  console.log("   State:", gm.state);

  console.log("7. Resuming...");
  await gm.resume();
  console.log("   State:", gm.state);

  console.log("8. Checking logs...");
  console.log("   Commands executed:", gm.logs().length);

  console.log("9. Stopping...");
  await gm.stop();
  console.log("   State:", gm.state);
  console.log("\n✓ Sequential pattern complete\n");
}

// ─── Pattern 2: Fire-and-forget + reconnect ──────────────────────

async function fireAndForgetPattern() {
  console.log("\n══════ PATTERN 2: Fire & Forget + Reconnect ══════\n");

  const machine = new E2BMachine({ apiKey: E2B_KEY, timeout: 120 });

  const gm = new GitMachine({
    machine,
    repository: REPO,
    token: "dummy",
    session: "test-fire-forget",
    autoCommit: false,
    onStart: async (gm) => {
      console.log("  [onStart] sandbox:", gm.id);
    },
    onEvent: (event, data) => {
      console.log(`  [event:${event}]`, JSON.stringify(data));
    },
  });

  // Start and grab ID
  await gm.start();
  const sandboxId = gm.id!;
  console.log("1. Started, got sandbox ID:", sandboxId);

  // Fire and forget — kick off work, don't await
  const workPromise = gm.run("echo 'working...' && sleep 2 && echo 'done!'", {
    onStdout: (data) => {
      console.log("   [stdout]", data.trim());
    },
  });
  console.log("2. Work kicked off (not awaiting)");

  // Simulate returning ID to client immediately
  console.log("3. → Would return { sandboxId:", sandboxId, "} to HTTP client\n");

  // Simulate a different server/request reconnecting
  console.log("4. Reconnecting from 'another server'...");
  const machine2 = await E2BMachine.connect(sandboxId, { apiKey: E2B_KEY });
  const gm2 = await GitMachine.connect(machine2, {
    repository: REPO,
    token: "dummy",
    session: "test-fire-forget",
    autoCommit: false,
    onEvent: (event, data) => {
      console.log(`  [reconnected:${event}]`, JSON.stringify(data));
    },
  });
  console.log("   Reconnected! State:", gm2.state, "| ID:", gm2.id);

  // Query state from reconnected instance
  const hash = await gm2.hash();
  console.log("   HEAD from reconnected instance:", hash);

  // Wait for original work to finish
  console.log("\n5. Waiting for original fire-and-forget work...");
  const result = await workPromise;
  console.log("   Exit code:", result.exitCode);

  // Clean up from original reference
  console.log("6. Stopping...");
  await gm.stop();
  console.log("   State:", gm.state);
  console.log("\n✓ Fire-and-forget pattern complete\n");
}

// ─── Run both ────────────────────────────────────────────────────

async function main() {
  try {
    await sequentialPattern();
    await fireAndForgetPattern();
    console.log("═══════════════════════════════════════════");
    console.log("Both patterns work ✓");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
