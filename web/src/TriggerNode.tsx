import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";

interface TriggerNodeData {
  fields: string[];
  kind?: string;
}

export function TriggerNode({ data }: NodeProps) {
  const d = data as unknown as TriggerNodeData;
  return (
    <div className="w-56 rounded-3xl border border-amber-500/40 bg-amber-500/5 p-1">
      <div className="overflow-hidden rounded-[1.2rem] bg-background ring-1 ring-amber-500/20">
        <div className="flex gap-2 p-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1 px-1">
            <h3 className="text-base font-medium leading-none">Trigger</h3>
            <p className="text-xs capitalize leading-none text-muted-foreground">
              {d.kind ?? "manual"}
            </p>
          </div>
        </div>

        {d.fields.length > 0 && (
          <div className="flex flex-col gap-0.5 border-t border-amber-500/15 px-1.5 py-1.5">
            {d.fields.map((field) => (
              <div key={field} className="flex h-6 items-center justify-end gap-1.5">
                <span className="truncate font-mono text-[11px] text-amber-200/90">
                  {field}
                </span>
                <Handle
                  id={field}
                  type="source"
                  position={Position.Right}
                  style={{ position: "relative", transform: "none", top: "auto", right: "auto" }}
                  className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-amber-400 !bg-background"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
