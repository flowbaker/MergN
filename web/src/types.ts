export interface Wire {
  from: string;
  fromOutput: string;
  to: string;
  toInput: string;
}

export type TriggerKind = "manual" | "webhook" | "schedule" | "poll" | "event";

export interface TriggerConfig {
  kind: TriggerKind;
}

export type WorkflowOp =
  | { key: string; kind: "funcs"; funcs: AuthoredFunc[] }
  | { key: string; kind: "wires"; wires: Wire[] }
  | { key: string; kind: "deleteFunc"; id: string }
  | { key: string; kind: "unwire"; to: string; toInput?: string };

export interface RunStepData {
  status: string;
  resolvedInput?: unknown;
  output?: unknown;
  error?: string;
}

export interface AuthoredFunc {
  id: string;
  title: string;
  summary: string;
  version: number;
  kind: string;
  pure: boolean;
  inputs: { name: string; role: string; type: string; required: boolean }[];
  outputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  bodySource: string;
  requires: { name: string; provider: string; scopes: string[] }[];
  dangerClass: string | null;
  idempotency: { key: string; mechanism: string } | null;
}
