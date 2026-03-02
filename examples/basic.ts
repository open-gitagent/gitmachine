import { GitMachine, E2BMachine } from "../src/index.js";

async function main() {
  const machine = new E2BMachine({
    apiKey: '',
    template: "base",
    timeout: 600,
  });

  const gm = new GitMachine({
    machine,
    repository: "https://github.com/open-gitagent/gitagent.git",
    token: process.env.GITHUB_PAT!,
    session: "review-session",
    autoCommit: true,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    },
    onStart: async (gm) => {
      console.log("Setting up environment...");
      await gm.run("apt-get update && apt-get install -y git");
      await gm.run("npm install -g @anthropic-ai/claude-code");
    },
    onEnd: async () => {
      console.log("Session complete.");
    },
    onEvent: (event, data) => {
      console.log(`[${event}]`, JSON.stringify(data));
    },
  });

  // Start — spins up VM, clones repo, checks out branch, runs onStart
  await gm.start();
  console.log("Machine started, repo at:", gm.path);

  // Run a command inside the sandbox
  const result = await gm.run("ls -la");
  console.log(result.stdout);

  // Check git state
  console.log("HEAD:", await gm.hash());
  console.log("Diff:", await gm.diff());

  // Pause — auto-commits, disconnects from VM
  await gm.pause();
  console.log("Paused. State:", gm.state);

  // Resume — reconnects to the same sandbox
  await gm.resume();
  console.log("Resumed. State:", gm.state);

  // Manual commit and push
  await gm.run("echo 'hello from gitmachine' > gitmachine.txt");
  const sha = await gm.commit("add gitmachine marker file");
  console.log("Committed:", sha);
  await gm.push();

  // Check logs
  console.log("Commands run:", gm.logs().length);

  // Stop — auto-commits, pushes, kills VM
  await gm.stop();
  console.log("Done. State:", gm.state);
}

main().catch(console.error);
