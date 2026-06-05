import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AuthoredFunc, RunStepData, Wire } from "./types";
import { spaceHeaders } from "./space";
import { useRuns, fetchRun } from "./queries";

interface RunRecord {
  nodeId: string;
  status: string;
  output?: unknown;
  error?: string;
  resolvedInput?: unknown;
}

const STATUS_DOT: Record<string, string> = {
  done: "bg-emerald-500",
  failed: "bg-rose-500",
  pending: "bg-amber-500 animate-pulse",
};

function pretty(v: unknown): string {
  if (v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function RunPanel({
  funcs,
  wires,
  config,
  workflowId,
  workflowName,
  onStatus,
  onData,
  onRepair,
}: {
  funcs: AuthoredFunc[];
  wires: Wire[];
  config: Record<string, Record<string, string>>;
  workflowId: string | null;
  workflowName: string;
  onStatus: (status: Record<string, string>) => void;
  onData: (data: Record<string, RunStepData>) => void;
  onRepair: (
    provider: string,
    ctx: {
      error: string;
      callSite: string;
      sampleInput: string;
      declaredInputs: string[];
    },
  ) => void;
}) {
  const qc = useQueryClient();
  const runsQuery = useRuns(workflowId);
  const [input, setInput] = useState("{}");
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const [tab, setTab] = useState<"input" | "state" | "runs">("input");

  const titleOf = (nodeId: string) =>
    nodeId === "trigger"
      ? "Trigger"
      : (funcs.find((x) => x.id === nodeId)?.title ?? nodeId);

  const providerForNode = (nodeId: string): string | undefined => {
    const f = funcs.find((x) => x.id === nodeId);
    return f && !f.pure && f.requires[0] ? f.requires[0].provider : undefined;
  };

  const run = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(input || "{}");
    } catch {
      setError("Invalid JSON input");
      return;
    }
    setRunning(true);
    setRecords([]);
    setTab("state");
    onStatus({});
    onData({});
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...spaceHeaders() },
        body: JSON.stringify({
          funcs,
          wires,
          config,
          input: parsed,
          workflowId: workflowId ?? undefined,
          workflowName,
        }),
      });
      if (!res.body) throw new Error("no stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const recs: RunRecord[] = [];
      const status: Record<string, string> = {};
      const dataByNode: Record<string, RunStepData> = {};
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const rec = JSON.parse(data) as RunRecord;
          recs.push(rec);
          status[rec.nodeId] = rec.status;
          dataByNode[rec.nodeId] = {
            status: rec.status,
            resolvedInput: rec.resolvedInput,
            output: rec.output,
            error: rec.error,
          };
          setRecords([...recs]);
          onStatus({ ...status });
          onData({ ...dataByNode });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      if (workflowId)
        qc.invalidateQueries({ queryKey: ["runs", workflowId] });
    }
  };

  const openRun = async (id: string) => {
    setLoadingRun(id);
    try {
      const run = await fetchRun(id);
      setRecords(run.records as RunRecord[]);
      const status: Record<string, string> = {};
      const dataByNode: Record<string, RunStepData> = {};
      for (const r of run.records) {
        status[r.nodeId] = r.status;
        dataByNode[r.nodeId] = {
          status: r.status,
          resolvedInput: r.resolvedInput,
          output: r.output,
          error: r.error,
        };
      }
      onStatus(status);
      onData(dataByNode);
      setTab("state");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRun(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background-subtle/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          size="sm"
          onClick={run}
          disabled={running || funcs.length === 0}
          className="h-7 rounded-lg px-3"
        >
          {running ? "running…" : "▶ Run"}
        </Button>

        <div className="flex rounded-lg border border-border/50 bg-muted/50 p-0.5 text-xs">
          {(["input", "state", "runs"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2.5 py-1 capitalize transition-colors",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {error && (
          <span className="text-xs text-destructive">⚠ {error}</span>
        )}
        {!error && records.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {records.filter((r) => r.status === "done").length}/{records.length}{" "}
            done
          </span>
        )}
      </div>

      {tab === "input" ? (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <div className="mb-1 text-[11px] text-muted-foreground">
            trigger input (JSON)
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder='{ "email": "ada@x.com", "amount": 2000 }'
            className="min-h-0 flex-1 resize-none rounded-xl border border-border/50 bg-background p-3 font-mono text-xs outline-none transition-colors focus:border-foreground/20"
          />
        </div>
      ) : tab === "runs" ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {!workflowId ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              Save the workflow to keep a history of its runs.
            </div>
          ) : (runsQuery.data?.length ?? 0) === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No runs yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {runsQuery.data?.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openRun(r.id)}
                  className="flex w-full items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-2.5 py-2 text-left transition-colors hover:border-border"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      STATUS_DOT[r.status] ?? "bg-muted-foreground",
                    )}
                  />
                  <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r.trigger}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {r.stepCount} step{r.stepCount === 1 ? "" : "s"}
                  </span>
                  {loadingRun === r.id && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      loading…
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {records.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Run the workflow to see each step's state here.
            </div>
          ) : (
            <div className="space-y-2">
              {records.map((r, i) => {
                const provider =
                  r.status === "failed" ? providerForNode(r.nodeId) : undefined;
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-border/50 bg-background/60 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          STATUS_DOT[r.status] ?? "bg-muted-foreground",
                        )}
                      />
                      <span className="text-xs font-medium">
                        {titleOf(r.nodeId)}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        {r.status}
                      </span>
                      {provider && (
                        <button
                          onClick={() => {
                            const f = funcs.find((x) => x.id === r.nodeId);
                            onRepair(provider, {
                              error: r.error ?? "",
                              callSite: f?.bodySource ?? "",
                              sampleInput:
                                r.resolvedInput !== undefined
                                  ? JSON.stringify(r.resolvedInput)
                                  : "{}",
                              declaredInputs: f
                                ? f.inputs.map((p) => p.name)
                                : [],
                            });
                          }}
                          className="ml-auto rounded-md bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200 hover:bg-amber-500/30"
                        >
                          🔧 fix with AI
                        </button>
                      )}
                    </div>

                    {r.nodeId !== "trigger" && (
                      <div className="mt-2 space-y-1.5">
                        <div>
                          <div className="text-[10px] text-muted-foreground/60">
                            input
                          </div>
                          <pre className="mt-0.5 overflow-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground/85">
                            {pretty(r.resolvedInput ?? {})}
                          </pre>
                        </div>
                        {r.error ? (
                          <div>
                            <div className="text-[10px] text-rose-300/80">error</div>
                            <pre className="mt-0.5 overflow-auto rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 font-mono text-[11px] leading-relaxed text-rose-200">
                              {r.error}
                            </pre>
                          </div>
                        ) : (
                          r.output !== undefined && (
                            <div>
                              <div className="text-[10px] text-muted-foreground/60">
                                output
                              </div>
                              <pre className="mt-0.5 overflow-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-emerald-200/85">
                                {pretty(r.output)}
                              </pre>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
