export enum MachineState {
  IDLE = "idle",
  RUNNING = "running",
  PAUSED = "paused",
  STOPPED = "stopped",
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LogEntry {
  command: string;
  result: ExecutionResult;
  timestamp: number;
}

export type OnOutput = (data: string) => void | Promise<void>;
export type OnExit = (code: number) => void | Promise<void>;
export type OnEvent = (
  event: string,
  data: Record<string, unknown>
) => void | Promise<void>;

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  onStdout?: OnOutput;
  onStderr?: OnOutput;
  onExit?: OnExit;
}
