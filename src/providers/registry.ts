import type { DocStore } from "../store/docstore";

const COLLECTION = "providers";

export interface AuthField {
  name: string;
  label: string;
  type: "text" | "password" | "number";
  placeholder?: string;
  required?: boolean;
  help?: string;
  secret?: boolean;
}

export interface Credential {
  kind?: "oauth";
  fields: AuthField[];
}

export interface SandboxPolicy {
  egressDomain?: string;
}

export type AuthSpec =
  | { type: "none" }
  | { type: "apiKey"; fields: AuthField[] }
  | {
      type: "oauth2";
      authUrl: string;
      tokenUrl: string;
      scopes: string[];
      clientIdEnv: string;
      clientSecretEnv: string;
    };

export interface SetupStep {
  title: string;
  detail?: string;
  link?: { label: string; href: string };
  copyRedirectUrl?: boolean;
}

export interface SetupGuide {
  intro?: string;
  steps: SetupStep[];
}

export interface PublicAuth {
  type: AuthSpec["type"];
  name: string;
  fields?: AuthField[];
  scopes?: string[];
  setupGuide?: SetupGuide;
}

export interface ProviderSpec {
  id: string;
  name: string;
  scopes: string[];
  keywords: string[];
  apiDoc: string;
  env?: string;
  auth?: AuthSpec;
  credential?: Credential;
  setupGuide?: SetupGuide;
  sandbox?: SandboxPolicy;
  aiWritten?: boolean;
  clientSource?: string;
  dependencies?: string[];
}

export interface ProviderDraft {
  id: string;
  name: string;
  keywords: string[];
  authEnv: string;
  sandbox: SandboxPolicy;
  apiDoc: string;
  clientSource: string;
  dependencies?: string[];
  credential?: Credential;
  setupGuide?: SetupGuide;
}

const builtins = new Map<string, ProviderSpec>();

builtins.set("slack", {
  id: "slack",
  name: "Slack",
  scopes: ["chat:write", "channels:read"],
  keywords: ["slack", "message", "notify", "notification", "chat", "channel", "alert"],
  sandbox: { egressDomain: "slack.com" },
  apiDoc:
    "give the func a 'channel' input and a 'text' input, then call: const ts = await ctx.connections.<name>.postMessage(input.channel, input.text); return { ts }. Connection: name 'slack', provider 'slack', scope 'chat:write'.",
  env: "SLACK_TOKEN",
  dependencies: [],
  clientSource: `
    export default (cred, fetch) => {
      const send = async (a, b) => {
        const arg = (typeof a === 'object' && a !== null) ? a : null;
        const channel = arg ? arg.channel : a;
        const text = arg ? arg.text : b;
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + cred.value, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ channel, text }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error('slack error: ' + data.error);
        return data.ts || '';
      };
      return new Proxy({}, { get: () => send });
    };
  `,
});

builtins.set("github", {
  id: "github",
  name: "GitHub",
  scopes: ["repo"],
  keywords: ["github", "git", "issue", "repo", "repository", "pull request", "pr", "commit"],
  sandbox: { egressDomain: "api.github.com" },
  apiDoc:
    "methods: const me = await ctx.connections.<name>.getUser(); returns { login, id, name }. const issue = await ctx.connections.<name>.createIssue({ owner, repo, title, body }); returns { number, url }. Connection: name 'github', provider 'github'.",
  auth: {
    type: "oauth2",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
  },
  setupGuide: {
    intro: "GitHub needs an OAuth App that you own — it takes about a minute.",
    steps: [
      {
        title: "Open GitHub Developer Settings",
        detail: "Go to Settings → Developer settings → OAuth Apps → New OAuth App.",
        link: {
          label: "Open OAuth Apps",
          href: "https://github.com/settings/developers",
        },
      },
      {
        title: "Set the Authorization callback URL",
        detail: "Paste this exact value into the callback URL field.",
        copyRedirectUrl: true,
      },
      {
        title: "Copy your credentials",
        detail:
          "Copy the Client ID, then click 'Generate a new client secret' and copy that too. Paste both below.",
      },
    ],
  },
  dependencies: [],
  clientSource: `
    export default (cred, fetch) => {
      const api = async (path, init) => {
        const res = await fetch('https://api.github.com' + path, {
          ...init,
          headers: {
            Authorization: 'Bearer ' + cred.accessToken,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'workflow-builder',
            ...((init && init.headers) || {}),
          },
        });
        const data = await res.json();
        if (!res.ok) throw new Error('github error: ' + (data.message || res.status));
        return data;
      };
      return {
        getUser: async () => {
          const u = await api('/user');
          return { login: u.login, id: u.id, name: u.name };
        },
        createIssue: async (arg) => {
          const a = arg || {};
          const issue = await api('/repos/' + a.owner + '/' + a.repo + '/issues', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: a.title, body: a.body }),
          });
          return { number: issue.number, url: issue.html_url };
        },
      };
    };
  `,
});

builtins.set("http", {
  id: "http",
  name: "HTTP",
  scopes: [],
  keywords: ["http", "https", "api", "fetch", "request", "rest", "url", "webhook", "get", "post"],
  apiDoc:
    "call: const data = await ctx.connections.<name>.get(url); (returns parsed JSON) or .post(url, jsonBody). Connection: name 'http', provider 'http', no scopes.",
  dependencies: [],
  clientSource: `
    export default (cred, fetch) => ({
      get: async (url) => {
        const res = await fetch(String(url));
        return res.json();
      },
      post: async (url, body) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.json();
      },
    });
  `,
});

function specFromDraft(d: ProviderDraft): ProviderSpec {
  return {
    id: d.id,
    name: d.name,
    scopes: [],
    keywords: d.keywords,
    apiDoc: d.apiDoc,
    env: d.authEnv || undefined,
    credential: d.credential,
    setupGuide: d.setupGuide,
    sandbox: d.sandbox,
    aiWritten: true,
    clientSource: d.clientSource,
    dependencies: d.dependencies ?? [],
  };
}

function humanize(env: string): string {
  const cleaned = env.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!cleaned) return "API key";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function authOf(spec: ProviderSpec): AuthSpec {
  if (spec.auth?.type === "oauth2") return spec.auth;
  if (spec.credential?.fields?.length)
    return { type: "apiKey", fields: spec.credential.fields };
  if (spec.env)
    return {
      type: "apiKey",
      fields: [
        {
          name: "value",
          label: humanize(spec.env),
          type: "password",
          required: true,
        },
      ],
    };
  return { type: "none" };
}

export function publicAuth(spec: ProviderSpec): PublicAuth {
  const auth = authOf(spec);
  const guide = spec.setupGuide;
  if (auth.type === "apiKey")
    return {
      type: "apiKey",
      name: spec.name,
      fields: auth.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        placeholder: f.placeholder,
        required: f.required,
        help: f.help,
        secret: f.secret,
      })),
      setupGuide: guide,
    };
  if (auth.type === "oauth2")
    return { type: "oauth2", name: spec.name, scopes: auth.scopes, setupGuide: guide };
  return { type: "none", name: spec.name, setupGuide: guide };
}

export interface Registry {
  ensureSpace(spaceId: string): Promise<void>;
  getProvider(spaceId: string, id: string): ProviderSpec | undefined;
  searchProviders(spaceId: string, query: string): ProviderSpec[];
  registerProviderFromDraft(spaceId: string, draft: ProviderDraft): ProviderSpec;
  persistProvider(spaceId: string, draft: ProviderDraft): Promise<void>;
  getProviderDraft(spaceId: string, id: string): Promise<ProviderDraft | null>;
  needsAuth(spaceId: string, providerId: string): boolean;
}

export function createRegistry(store: DocStore): Registry {
  const spaceDrafts = new Map<string, Map<string, ProviderSpec>>();
  const loaded = new Set<string>();

  function draftsFor(spaceId: string): Map<string, ProviderSpec> {
    let m = spaceDrafts.get(spaceId);
    if (!m) {
      m = new Map();
      spaceDrafts.set(spaceId, m);
    }
    return m;
  }

  function getProvider(spaceId: string, id: string): ProviderSpec | undefined {
    return draftsFor(spaceId).get(id) ?? builtins.get(id);
  }

  function registerProviderFromDraft(
    spaceId: string,
    draft: ProviderDraft,
  ): ProviderSpec {
    const spec = specFromDraft(draft);
    draftsFor(spaceId).set(spec.id, spec);
    return spec;
  }

  return {
    getProvider,
    registerProviderFromDraft,

    async ensureSpace(spaceId) {
      if (loaded.has(spaceId)) return;
      loaded.add(spaceId);
      const docs = (await store.list(
        spaceId,
        COLLECTION,
      )) as unknown as ProviderDraft[];
      const m = draftsFor(spaceId);
      for (const draft of docs) {
        if (builtins.has(draft.id)) continue;
        try {
          m.set(draft.id, specFromDraft(draft));
        } catch {
          continue;
        }
      }
    },

    searchProviders(spaceId, query) {
      const q = query.toLowerCase().trim();
      const all = [...builtins.values(), ...draftsFor(spaceId).values()];
      if (!q) return all;
      const terms = q.split(/\s+/);
      return all.filter((p) => {
        const hay = [p.id, p.name, p.apiDoc, ...p.keywords]
          .join(" ")
          .toLowerCase();
        return terms.some((t) => hay.includes(t));
      });
    },

    async persistProvider(spaceId, draft) {
      await store.put(
        spaceId,
        COLLECTION,
        draft.id,
        draft as unknown as Record<string, unknown>,
      );
    },

    async getProviderDraft(spaceId, id) {
      return (await store.get(
        spaceId,
        COLLECTION,
        id,
      )) as unknown as ProviderDraft | null;
    },

    needsAuth(spaceId, providerId) {
      const spec = getProvider(spaceId, providerId);
      return !!spec && authOf(spec).type !== "none";
    },
  };
}
