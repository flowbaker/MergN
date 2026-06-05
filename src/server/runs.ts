import type { DocStore } from "../store/docstore";
import type { StepRecord } from "../atoms/index";

const COLLECTION = "runs";

export interface RunDoc {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  status: "done" | "failed";
  input: Record<string, unknown>;
  records: StepRecord[];
  startedAt: string;
  finishedAt: string;
}

export interface RunMeta {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  status: string;
  startedAt: string;
  stepCount: number;
}

export interface RunStore {
  saveRun(spaceId: string, run: RunDoc): Promise<void>;
  listRuns(spaceId: string, workflowId?: string): Promise<RunMeta[]>;
  getRun(spaceId: string, id: string): Promise<RunDoc | null>;
}

export function createRunStore(store: DocStore): RunStore {
  return {
    async saveRun(spaceId, run) {
      await store.put(
        spaceId,
        COLLECTION,
        run.id,
        run as unknown as Record<string, unknown>,
      );
    },

    async listRuns(spaceId, workflowId) {
      const docs = (await store.list(
        spaceId,
        COLLECTION,
      )) as unknown as RunDoc[];
      return docs
        .filter((r) => !workflowId || r.workflowId === workflowId)
        .map((r) => ({
          id: r.id,
          workflowId: r.workflowId,
          workflowName: r.workflowName,
          trigger: r.trigger,
          status: r.status,
          startedAt: r.startedAt,
          stepCount: Array.isArray(r.records)
            ? r.records.filter((x) => x.nodeId !== "trigger").length
            : 0,
        }))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    },

    async getRun(spaceId, id) {
      return (await store.get(
        spaceId,
        COLLECTION,
        id,
      )) as unknown as RunDoc | null;
    },
  };
}
