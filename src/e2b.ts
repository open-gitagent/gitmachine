import { Sandbox } from "e2b";
import type { CommandResult } from "e2b";
import { Machine, type ExecuteOptions } from "./machine.js";
import { MachineState, type ExecutionResult } from "./types.js";

export interface E2BMachineConfig {
  apiKey?: string;
  template?: string;
  timeout?: number;
  envs?: Record<string, string>;
  metadata?: Record<string, string>;
}

export class E2BMachine extends Machine {
  private sandbox: Sandbox | null = null;
  private sandboxId: string | null = null;
  private _state: MachineState = MachineState.IDLE;
  private readonly apiKey: string;
  private readonly template: string;
  private readonly timeoutMs: number;
  private readonly envs: Record<string, string>;
  private readonly metadata: Record<string, string>;

  constructor(config?: E2BMachineConfig) {
    super();
    this.apiKey = config?.apiKey ?? process.env.E2B_API_KEY ?? "";
    this.template = config?.template ?? "base";
    this.timeoutMs = (config?.timeout ?? 300) * 1000;
    this.envs = config?.envs ?? {};
    this.metadata = config?.metadata ?? {};
  }

  get id(): string | null {
    return this.sandboxId;
  }

  get state(): MachineState {
    return this._state;
  }

  static async connect(sandboxId: string, config?: E2BMachineConfig): Promise<E2BMachine> {
    const machine = new E2BMachine(config);
    machine.sandboxId = sandboxId;
    machine.sandbox = await Sandbox.connect(sandboxId, {
      apiKey: machine.apiKey,
    });
    machine._state = MachineState.RUNNING;
    return machine;
  }

  async start(): Promise<void> {
    if (this._state === MachineState.RUNNING) return;

    this.sandbox = await Sandbox.create(this.template, {
      apiKey: this.apiKey,
      timeoutMs: this.timeoutMs,
      envs: this.envs,
      metadata: this.metadata,
    });
    this.sandboxId = this.sandbox.sandboxId;
    this._state = MachineState.RUNNING;
  }

  async pause(): Promise<void> {
    if (this._state !== MachineState.RUNNING || !this.sandbox) return;

    // E2B v1 has no native pause — we disconnect but keep the sandbox alive.
    // The sandbox continues running until its timeout expires.
    this.sandbox = null;
    this._state = MachineState.PAUSED;
  }

  async resume(): Promise<void> {
    if (this._state !== MachineState.PAUSED || !this.sandboxId) return;

    this.sandbox = await Sandbox.connect(this.sandboxId, {
      apiKey: this.apiKey,
    });
    this._state = MachineState.RUNNING;
  }

  async stop(): Promise<void> {
    if (this._state === MachineState.STOPPED) return;

    if (this._state === MachineState.PAUSED && this.sandboxId) {
      // Reconnect to kill it properly
      this.sandbox = await Sandbox.connect(this.sandboxId, {
        apiKey: this.apiKey,
      });
    }

    if (this.sandbox) {
      await this.sandbox.kill();
      this.sandbox = null;
    }

    this.sandboxId = null;
    this._state = MachineState.STOPPED;
  }

  async execute(
    command: string,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    const sandbox = this.requireSandbox();
    const result = (await sandbox.commands.run(command, {
      cwd: options?.cwd,
      envs: options?.env,
      timeoutMs: options?.timeout ? options.timeout * 1000 : undefined,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    })) as CommandResult;

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async readFile(path: string): Promise<string> {
    return this.requireSandbox().files.read(path);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const data =
      content instanceof Uint8Array ? content.buffer as ArrayBuffer : content;
    await this.requireSandbox().files.write(path, data);
  }

  async listFiles(path: string): Promise<string[]> {
    const entries = await this.requireSandbox().files.list(path);
    return entries.map((e) => e.name);
  }

  // --- E2B-specific API ---

  getSandbox(): Sandbox {
    return this.requireSandbox();
  }

  getSandboxId(): string | null {
    return this.sandboxId;
  }

  async setTimeout(timeout: number): Promise<void> {
    await this.requireSandbox().setTimeout(timeout * 1000);
  }

  async getInfo(): Promise<Record<string, unknown>> {
    const info = await this.requireSandbox().getInfo();
    return info as unknown as Record<string, unknown>;
  }

  async makeDir(path: string): Promise<void> {
    await this.requireSandbox().files.makeDir(path);
  }

  async remove(path: string): Promise<void> {
    await this.requireSandbox().files.remove(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.requireSandbox().files.exists(path);
  }

  async isRunning(): Promise<boolean> {
    if (!this.sandbox) return false;
    return this.sandbox.isRunning();
  }

  getHost(port: number): string {
    return this.requireSandbox().getHost(port);
  }

  private requireSandbox(): Sandbox {
    if (!this.sandbox) {
      throw new Error(
        `Machine is ${this._state} — call start() or resume() first`
      );
    }
    return this.sandbox;
  }
}
