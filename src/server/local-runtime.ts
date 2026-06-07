import { mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { FuncDefinition, FuncContext } from "../atoms/index";
import type { Runtime } from "../engine/index";

interface Carrier {
  __remoteProvider?: boolean;
  clientSource?: string;
  cred?: Record<string, string>;
  egressDomain?: string;
  dependencies?: string[];
}

interface ResolvedProvider {
  name: string;
  clientSource: string;
  cred: Record<string, string>;
  egressDomain?: string;
}

function guardedFetch(domain?: string) {
  return async (i: unknown, init?: unknown): Promise<Response> => {
    const url =
      typeof i === "string"
        ? i
        : i instanceof URL
          ? i.href
          : i instanceof Request
            ? i.url
            : String(i);
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new Error("egress blocked: invalid url");
    }
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) {
      throw new Error(`egress blocked: ${host} (allowed: ${domain})`);
    }
    return fetch(url, init as RequestInit | undefined);
  };
}

function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 0, out }));
    p.on("error", (e) => resolve({ code: 1, out: String(e) }));
  });
}

function depsKey(deps: string[]): string {
  if (deps.length === 0) return "none";
  return createHash("sha256").update([...deps].sort().join("\n")).digest("hex").slice(0, 16);
}

function toDependencyObject(deps: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of deps) {
    const d = raw.trim();
    if (!d) continue;
    const at = d.lastIndexOf("@");
    if (at > 0) out[d.slice(0, at)] = d.slice(at + 1);
    else out[d] = "latest";
  }
  return out;
}

const installLocks = new Map<string, Promise<void>>();

async function ensureDeps(cacheDir: string, deps: string[]): Promise<void> {
  if (deps.length === 0) return;
  const nodeModules = join(cacheDir, "node_modules");
  if (await exists(nodeModules)) return;
  const key = cacheDir;
  let lock = installLocks.get(key);
  if (!lock) {
    lock = (async () => {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(
        join(cacheDir, "package.json"),
        JSON.stringify({ name: "fb-local", private: true, type: "module", dependencies: toDependencyObject(deps) }),
      );
      const r = await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], cacheDir);
      if (r.code !== 0) throw new Error(`local dependency install failed: ${r.out.slice(-400)}`);
    })();
    installLocks.set(key, lock);
  }
  try {
    await lock;
  } finally {
    installLocks.delete(key);
  }
}

export class LocalRuntime implements Runtime {
  async run(
    def: FuncDefinition,
    ctx: FuncContext,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const providers: ResolvedProvider[] = [];
    for (const [name, value] of Object.entries(ctx.connections ?? {})) {
      const c = value as Carrier;
      if (!c?.__remoteProvider || !c.clientSource) continue;
      providers.push({ name, clientSource: c.clientSource, cred: c.cred ?? {}, egressDomain: c.egressDomain });
    }

    const deps = [
      ...(def.body.dependencies ?? []),
      ...providers.flatMap((p) => {
        const c = ctx.connections[p.name] as Carrier;
        return c?.dependencies ?? [];
      }),
    ].filter((v, i, a) => a.indexOf(v) === i);

    const cacheDir = join(tmpdir(), "fb-local", depsKey(deps));
    await ensureDeps(cacheDir, deps);

    const runDir = join(cacheDir, "runs", randomUUID());
    await mkdir(join(runDir, "providers"), { recursive: true });

    try {
      const connections: Record<string, unknown> = {};
      for (let i = 0; i < providers.length; i++) {
        const p = providers[i];
        const file = join(runDir, "providers", `p${i}.mjs`);
        await writeFile(file, p.clientSource);
        const mod = await import(pathToFileURL(file).href);
        if (typeof mod.default !== "function") {
          throw new Error(`provider ${p.name} must export default a factory function`);
        }
        connections[p.name] = await mod.default(p.cred, guardedFetch(p.egressDomain));
      }

      const funcFile = join(runDir, "fb_func.mjs");
      await writeFile(funcFile, def.body.source);
      const fnMod = await import(pathToFileURL(funcFile).href);
      if (typeof fnMod.default !== "function") {
        throw new Error("func must export default an async (ctx, input) function");
      }
      const localCtx: FuncContext = { idempotencyKey: ctx.idempotencyKey, connections };
      return await fnMod.default(localCtx, input);
    } finally {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
