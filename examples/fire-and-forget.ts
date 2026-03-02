import { GitMachine, E2BMachine } from "../src/index.js";

/**
 * Fire-and-forget pattern for server use.
 *
 * Same process:  hooks survive — onStart/onEnd/onEvent fire as normal.
 * Cross process: pass fresh hooks when reconnecting via GitMachine.connect().
 */

// Shared hook factories — reuse across create and reconnect
function makeHooks() {
  return {
    onStart: async (gm: GitMachine) => {
      console.log(`[onStart] sandbox=${gm.id} — installing tools`);
      await gm.run("npm install -g @anthropic-ai/claude-code");
    },
    onPause: async (gm: GitMachine) => {
      console.log(`[onPause] sandbox=${gm.id} — saving state`);
    },
    onResume: async (gm: GitMachine) => {
      console.log(`[onResume] sandbox=${gm.id} — back online`);
    },
    onEnd: async (gm: GitMachine) => {
      console.log(`[onEnd] sandbox=${gm.id} — tearing down`);
    },
    onEvent: (event: string, data: Record<string, unknown>, gm: GitMachine) => {
      console.log(`[event:${event}] sandbox=${gm.id}`, data);
    },
  };
}

// ─── 1. Start a job, return ID immediately ──────────────────────

async function startJob(): Promise<string> {
  const machine = new E2BMachine({
    template: "base",
    timeout: 600,
  });

  const gm = new GitMachine({
    machine,
    repository: "https://github.com/user/my-agent.git",
    token: process.env.GITHUB_PAT!,
    session: "job-123",
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
    ...makeHooks(), // all hooks wired up
  });

  await gm.start();
  // onStart fires ✓ — installs claude code

  const sandboxId = gm.id!;

  // Fire and forget — don't await
  gm.run("claude -p 'review this codebase' --print", {
    onStdout: (data) => { process.stdout.write(data); },
  }).then(async (result) => {
    console.log("Agent finished:", result.exitCode);
    // onEnd fires ✓ — auto-commits, pushes, tears down
    await gm.stop();
  });

  return sandboxId; // return immediately to caller
}

// ─── 2. Reconnect from another request / process ────────────────

async function reconnectAndCheck(sandboxId: string) {
  const machine = await E2BMachine.connect(sandboxId);

  // Pass fresh hooks — previous ones don't survive across processes
  const gm = await GitMachine.connect(machine, {
    repository: "https://github.com/user/my-agent.git",
    token: process.env.GITHUB_PAT!,
    session: "job-123",
    ...makeHooks(), // hooks work on reconnect too
  });

  console.log("Reconnected, state:", gm.state);

  const diff = await gm.diff();
  console.log("Current diff:\n", diff);

  const hash = await gm.hash();
  console.log("HEAD:", hash);

  // Can pause — onPause fires ✓
  await gm.pause();

  // Can resume later — onResume fires ✓
  await gm.resume();

  // Stop — onEnd fires ✓
  await gm.stop();
}

// ─── 3. Example flow ────────────────────────────────────────────

async function main() {
  const sandboxId = await startJob();
  console.log("Job started, sandbox:", sandboxId);

  // Simulate reconnecting 10s later (e.g. from a different HTTP request)
  setTimeout(() => reconnectAndCheck(sandboxId), 10_000);
}

main().catch(console.error);
