import type { ExecutionResult, MachineState } from "./types.js";

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
}

export abstract class Machine {
  abstract get state(): MachineState;

  abstract start(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract stop(): Promise<void>;

  abstract execute(
    command: string,
    options?: ExecuteOptions
  ): Promise<ExecutionResult>;

  abstract readFile(path: string): Promise<string>;
  abstract writeFile(
    path: string,
    content: string | Uint8Array
  ): Promise<void>;
  abstract listFiles(path: string): Promise<string[]>;
}
