import { Machine } from "./machine.js";
import {
  MachineState,
  type ExecutionResult,
  type LogEntry,
  type RunOptions,
} from "./types.js";

export type LifecycleHook = (gm: GitMachine) => Promise<void> | void;

export interface GitMachineConfig {
  machine: Machine;
  repository: string;
  token: string;
  onStart?: LifecycleHook;
  onPause?: LifecycleHook;
  onResume?: LifecycleHook;
  onEnd?: LifecycleHook;
  env?: Record<string, string>;
  timeout?: number;
  session?: string;
  autoCommit?: boolean;
  onEvent?: (event: string, data: Record<string, unknown>, gm: GitMachine) => void | Promise<void>;
}

export class GitMachine {
  private readonly machine: Machine;
  private readonly repository: string;
  private readonly token: string;
  private readonly onStartCb?: LifecycleHook;
  private readonly onPauseCb?: LifecycleHook;
  private readonly onResumeCb?: LifecycleHook;
  private readonly onEndCb?: LifecycleHook;
  private env: Record<string, string>;
  private readonly session: string | null;
  private readonly autoCommit: boolean;
  private readonly onEventCb?: (event: string, data: Record<string, unknown>, gm: GitMachine) => void | Promise<void>;
  private readonly repoPath = "/home/user/repo";
  private readonly _logs: LogEntry[] = [];
  private skipAutoCommit = false;

  constructor(config: GitMachineConfig) {
    this.machine = config.machine;
    this.repository = config.repository;
    this.token = config.token;
    this.onStartCb = config.onStart;
    this.onPauseCb = config.onPause;
    this.onResumeCb = config.onResume;
    this.onEndCb = config.onEnd;
    this.env = { ...config.env };
    this.session = config.session ?? null;
    this.autoCommit = config.autoCommit !== false;
    this.onEventCb = config.onEvent;
  }

  get id(): string | null {
    return this.machine.id;
  }

  get state(): MachineState {
    return this.machine.state;
  }

  get path(): string {
    return this.repoPath;
  }

  /**
   * Reconnect to an already-running GitMachine by its machine ID.
   * The sandbox must still be alive and the repo already cloned.
   */
  static async connect(
    machine: Machine,
    config: Omit<GitMachineConfig, "machine">
  ): Promise<GitMachine> {
    const gm = new GitMachine({ machine, ...config });
    // Machine is already running and repo is already cloned — just wire up
    gm.emit("reconnected", { id: machine.id });
    return gm;
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    await this.machine.start();

    // Clone with token embedded in URL (stays inside sandbox)
    const authUrl = this.authUrl();
    await this.exec(
      `git clone ${authUrl} ${this.repoPath}`
    );

    // Checkout session branch if specified
    if (this.session) {
      await this.exec(
        `git checkout ${this.session} 2>/dev/null || git checkout -b ${this.session}`
      );
    }

    // Configure git identity for commits
    await this.exec(`git config user.email "gitagent@machine"`);
    await this.exec(`git config user.name "GitMachine"`);

    this.emit("started", {
      session: this.session,
      repoPath: this.repoPath,
    });

    await this.onStartCb?.(this);
  }

  async pause(): Promise<void> {
    if (this.autoCommit && !this.skipAutoCommit) {
      await this.autoCommitChanges();
    }

    await this.onPauseCb?.(this);
    await this.machine.pause();
    this.emit("paused", {});
  }

  async resume(): Promise<void> {
    await this.machine.resume();
    await this.onResumeCb?.(this);
    this.emit("resumed", {});
  }

  async stop(): Promise<void> {
    if (this.autoCommit) {
      await this.autoCommitChanges();
      await this.pushChanges();
    }

    this.emit("stopping", {});
    await this.onEndCb?.(this);
    await this.machine.stop();
    this.emit("stopped", {});
  }

  // --- Git operations ---

  async diff(): Promise<string> {
    return this.whileRunning(async () => {
      const result = await this.exec("git diff HEAD");
      return result.stdout;
    });
  }

  async commit(message?: string): Promise<string | null> {
    return this.whileRunning(async () => {
      await this.exec("git add -A");

      // Check if there are staged changes
      const check = await this.exec(
        "git diff --cached --quiet",
      );
      if (check.exitCode === 0) return null; // nothing to commit

      const msg = message ?? "checkpoint";
      await this.exec(`git commit -m "${msg}"`);

      const sha = await this.exec("git rev-parse HEAD");
      const commitSha = sha.stdout.trim();

      this.emit("committed", { sha: commitSha, message: msg });
      return commitSha;
    });
  }

  async push(): Promise<void> {
    return this.whileRunning(async () => {
      await this.pushChanges();
      this.emit("pushed", {});
    });
  }

  async pull(): Promise<void> {
    return this.whileRunning(async () => {
      const branch = this.session ?? "main";
      await this.exec(`git pull origin ${branch}`);
      this.emit("pulled", {});
    });
  }

  async hash(): Promise<string> {
    return this.whileRunning(async () => {
      const result = await this.exec("git rev-parse HEAD");
      return result.stdout.trim();
    });
  }

  // --- Runtime ---

  async update(opts: {
    env?: Record<string, string>;
    onUpdate?: (gm: GitMachine) => Promise<void> | void;
  }): Promise<void> {
    if (opts.env) {
      this.env = { ...this.env, ...opts.env };
    }
    await opts.onUpdate?.(this);
  }

  async run(command: string, options?: RunOptions): Promise<ExecutionResult> {
    const mergedEnv = { ...this.env, ...options?.env };
    const cwd = options?.cwd ?? this.repoPath;

    const result = await this.machine.execute(command, {
      cwd,
      env: mergedEnv,
      timeout: options?.timeout,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });

    this._logs.push({
      command,
      result,
      timestamp: Date.now(),
    });

    await options?.onExit?.(result.exitCode);
    return result;
  }

  logs(): LogEntry[] {
    return [...this._logs];
  }

  // --- Internal ---

  private async whileRunning<T>(fn: () => Promise<T>): Promise<T> {
    const wasPaused = this.state === MachineState.PAUSED;
    if (wasPaused) {
      await this.machine.resume();
    }

    try {
      return await fn();
    } finally {
      if (wasPaused) {
        this.skipAutoCommit = true;
        await this.machine.pause();
        this.skipAutoCommit = false;
      }
    }
  }

  private async autoCommitChanges(): Promise<void> {
    try {
      await this.exec(
        `git add -A && git diff --cached --quiet || git commit -m "auto: checkpoint"`
      );
    } catch {
      // Swallow — auto-commit is best-effort
    }
  }

  private async pushChanges(): Promise<void> {
    const branch = this.session ?? "main";
    try {
      await this.exec(`git push origin ${branch}`);
    } catch {
      // Swallow — push failure during teardown shouldn't crash
    }
  }

  private async exec(command: string): Promise<ExecutionResult> {
    return this.machine.execute(command, { cwd: this.repoPath });
  }

  private authUrl(): string {
    // Insert token into https URL: https://token@github.com/user/repo.git
    const url = this.repository.replace(
      /^https:\/\//,
      `https://${this.token}@`
    );
    return url;
  }

  private emit(event: string, data: Record<string, unknown>): void {
    try {
      this.onEventCb?.(event, data, this);
    } catch {
      // Event callbacks should never crash the machine
    }
  }
}
