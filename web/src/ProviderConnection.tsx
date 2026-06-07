import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useProviderAuth,
} from "./queries";

export function ProviderConnection({ provider }: { provider: string }) {
  const { data: conns = [] } = useConnections();
  const auth = useProviderAuth(provider);
  const create = useCreateConnection();
  const del = useDeleteConnection();
  const [cred, setCred] = useState<Record<string, string>>({});
  const conn = conns.find((c) => c.provider === provider);
  const fields = auth.data?.fields ?? [];
  const missingRequired = fields.some(
    (f) => f.required && !(cred[f.name] ?? "").trim(),
  );

  if (conn) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-mono">{provider}</span>
        <Badge variant="secondary" className="shrink-0 gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          connected
        </Badge>
        <button
          onClick={() => del.mutate(conn.id)}
          className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
        >
          disconnect
        </button>
      </div>
    );
  }

  const submit = () => {
    const trimmed: Record<string, string> = {};
    for (const f of fields) {
      const v = (cred[f.name] ?? "").trim();
      if (v) trimmed[f.name] = v;
    }
    create.mutate({ provider, cred: trimmed });
    setCred({});
  };

  return (
    <div className="space-y-1">
      <div className="truncate font-mono text-xs">{provider}</div>
      <div className="flex gap-2">
        {fields.map((f, i) => (
          <Input
            key={f.name}
            value={cred[f.name] ?? ""}
            onChange={(e) =>
              setCred((c) => ({ ...c, [f.name]: e.target.value }))
            }
            type={
              f.type === "number"
                ? "number"
                : f.type === "text"
                  ? "text"
                  : "password"
            }
            placeholder={f.placeholder ?? f.label}
            autoFocus={i === 0}
            className="h-8 min-w-0 flex-1 text-xs"
          />
        ))}
        <Button
          size="sm"
          disabled={missingRequired || create.isPending}
          onClick={submit}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}
