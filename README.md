# GitMachine

A TypeScript package for running git-aware sandboxed virtual machines. Clone a repo into an isolated VM, run commands, and auto-commit results back — with branch-based session persistence.

GitMachine is the infrastructure layer for [GitAgent](https://github.com/open-gitagent/gitagent). It handles VM lifecycle + git operations so agent orchestration layers can focus on what matters.

## Install

```bash
npm install gitmachine
# or
bun add gitmachine
```

## Quick Start

```typescript
import { GitMachine, E2BMachine } from "gitmachine";

const machine = new E2BMachine({ apiKey: "e2b_..." });

const gm = new GitMachine({
  machine,
  repository: "https://github.com/user/my-agent.git",
  token: "ghp_...",
  session: "feature-work",
  autoCommit: true,
  env: { ANTHROPIC_API_KEY: "sk-..." },
  onStart: async (gm) => {
    await gm.run("npm install -g @anthropic-ai/claude-code");
  },
  onEvent: (event, data) => console.log(`[${event}]`, data),
});

await gm.start();   // VM up → repo cloned → branch checked out → onStart runs

const result = await gm.run("claude -p 'review this code' --print");
console.log(result.stdout);

await gm.pause();   // auto-commits → VM paused

// ... later ...

await gm.resume();  // VM comes back, repo state intact
await gm.run("claude -p 'continue the review' --print");

await gm.stop();    // auto-commits → pushes → VM torn down
```

## Architecture

```
┌─────────────────────────────────────────┐
│              GitMachine                 │
│  git clone / commit / push / sessions   │
│  auto-commit on pause/stop              │
├─────────────────────────────────────────┤
│              Machine (ABC)              │
│  start / pause / resume / stop          │
│  execute / readFile / writeFile         │
├─────────────────────────────────────────┤
│            E2BMachine                   │
│  E2B Sandbox SDK wrapper                │
│  Full API access via getSandbox()       │
└─────────────────────────────────────────┘
```

**Machine** — Abstract base class. Any VM provider (E2B, Fly, bare metal) implements this.

**E2BMachine** — Concrete implementation using [E2B](https://e2b.dev) sandboxes. Thin wrapper that exposes the full E2B SDK via `getSandbox()`.

**GitMachine** — Wraps any Machine with git lifecycle management. Clones a repo on start, auto-commits on pause/stop, persists sessions as branches.

## API

### `E2BMachine`

```typescript
const machine = new E2BMachine({
  apiKey?: string,      // defaults to E2B_API_KEY env var
  template?: string,    // default "base"
  timeout?: number,     // seconds, default 300
  envs?: Record<string, string>,
  metadata?: Record<string, string>,
});
```

Implements the `Machine` interface and exposes additional E2B-specific methods:

| Method | Description |
|--------|-------------|
| `getSandbox()` | Raw E2B `Sandbox` instance for full API access |
| `getSandboxId()` | Current sandbox ID |
| `setTimeout(seconds)` | Extend sandbox timeout |
| `getInfo()` | Sandbox metadata |
| `makeDir(path)` | Create directory |
| `remove(path)` | Remove file/directory |
| `exists(path)` | Check if path exists |
| `isRunning()` | Check sandbox status |
| `getHost(port)` | Get host address for a sandbox port |

### `GitMachine`

```typescript
const gm = new GitMachine({
  machine: Machine,                   // VM provider instance
  repository: string,                 // git repo URL (https)
  token: string,                      // PAT for git auth
  onStart?: (gm) => Promise<void>,    // called after clone, before work
  onEnd?: (gm) => Promise<void>,      // called before stop
  env?: Record<string, string>,       // env vars for all commands
  timeout?: number,                   // seconds
  session?: string,                   // branch name for persistence
  autoCommit?: boolean,               // default true
  onEvent?: (event, data) => void,    // lifecycle event callback
});
```

#### Lifecycle

| Method | Description |
|--------|-------------|
| `start()` | Start VM → clone repo → checkout session branch → run onStart |
| `pause()` | Auto-commit (if enabled) → pause VM |
| `resume()` | Resume VM |
| `stop()` | Auto-commit → push → run onEnd → kill VM |

#### Git Operations

| Method | Description |
|--------|-------------|
| `diff()` | Git diff against HEAD |
| `commit(message?)` | Stage all + commit, returns SHA or null if clean |
| `push()` | Push to origin |
| `pull()` | Pull from origin |
| `hash()` | Current HEAD SHA |

All git operations use the **whileRunning** pattern — if the machine is paused, they transparently resume, do the work, and re-pause.

#### Runtime

| Method | Description |
|--------|-------------|
| `run(command, options?)` | Execute a command in the sandbox |
| `update({ env?, onUpdate? })` | Update environment variables |
| `logs()` | Get command execution history |

#### Properties

| Property | Description |
|----------|-------------|
| `state` | Current `MachineState` (idle/running/paused/stopped) |
| `path` | Repo path inside the VM |

### Events

The `onEvent` callback receives lifecycle events:

| Event | Data |
|-------|------|
| `started` | `{ session, repoPath }` |
| `paused` | `{}` |
| `resumed` | `{}` |
| `stopping` | `{}` |
| `stopped` | `{}` |
| `committed` | `{ sha, message }` |
| `pushed` | `{}` |
| `pulled` | `{}` |

## Sessions

Sessions map to git branches. When you specify a `session`:

1. **Start** — checks out the branch (creates it if new)
2. **Pause** — auto-commits all changes to the branch
3. **Stop** — auto-commits and pushes to the branch
4. **Next run** — resumes from the same branch state

This gives you persistent, resumable agent sessions backed by git.

## Extending

### Custom Machine Provider

```typescript
import { Machine, MachineState, type ExecutionResult } from "gitmachine";

class FlyMachine extends Machine {
  get state(): MachineState { /* ... */ }
  async start(): Promise<void> { /* ... */ }
  async pause(): Promise<void> { /* ... */ }
  async resume(): Promise<void> { /* ... */ }
  async stop(): Promise<void> { /* ... */ }
  async execute(command: string, options?): Promise<ExecutionResult> { /* ... */ }
  async readFile(path: string): Promise<string> { /* ... */ }
  async writeFile(path: string, content: string | Uint8Array): Promise<void> { /* ... */ }
  async listFiles(path: string): Promise<string[]> { /* ... */ }
}

// Use it with GitMachine
const gm = new GitMachine({
  machine: new FlyMachine({ /* config */ }),
  repository: "...",
  token: "...",
});
```

## License

MIT
