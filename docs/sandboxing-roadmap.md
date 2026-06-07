# Sandboxing Roadmap

Workflow step kodu (func body) ve AI-yazılı provider kodu untrusted'dır ve izole
çalıştırılmalıdır. Bu roadmap, kod çalıştırmayı güvenli, açık-uçlu (arbitrary kod +
arbitrary npm lib) ve multi-tenant hale getirmenin fazlarını tanımlar.

İlgili repolar: `flowbaker/workflowv2` (app/orchestrator) ve
`flowbaker/msb-codeexec` (microsandbox exec servisi / broker).

---

## Sabitlenen kararlar (önkoşul)

- **Sandbox tech:** microsandbox (microVM/KVM). Açık-uçlu + arbitrary lib (native
  dahil) + güçlü izolasyon için microVM sınıfı zorunlu. V8 isolate (native lib yok)
  ve plain container (shared kernel, güvensiz) elenir.
- **Topoloji:** exec ayrı **dedicated** makinede, app data-plane'inden (Mongo,
  Better Auth secret, vault) izole.
- **Güvenlik sınırı:** "her şey per-space VM'de, cred o space'e scoped,
  host'a/cross-space erişim yok, egress filtreli". Korunan sınır cross-space + host.
- **Cred delivery:** microsandbox **native secret injection** (TLS-intercept).
  VM'in env'inde sadece **placeholder** (`$MSB_<env>`) durur; provider client onu
  header'a koyar; microsandbox TLS'i intercept edip placeholder'ı **yalnız
  `allowHost` (egressDomain)** giden istekte gerçek secret'la değiştirir. Gerçek
  secret VM'e hiç girmez. CA otomatik (`interceptCaCert` opsiyonel custom).
  - **Sınır:** bearer / api-key / basic-auth çalışır. **Request-signing** (AWS
    SigV4 gibi) çalışmaz — client placeholder üzerinden imza üretir, swap imzayı
    bozar. Bu provider'lar ileride VM-env'e gerçek secret ister (Faz 3 sonrası).
- **Host-mode kaldırıldı:** broker / `/broker/call` / host'taki `new Function`
  silindi → exec-host RCE kapandı. Tek yol VM-mode; flag yok.

---

## Faz 1 — Temel: provider'ı VM'e taşı + env cred (RCE'yi kapat) [BLOKLAYICI]

**Hedef:** Untrusted kod (func ve provider) yalnız per-space VM'de çalışır; host'ta
hiç çalışmaz; cred env'le gelir; egress kilitli.

**Mevcut açık:** Provider `clientSource` (AI-yazılı) şu an broker HOST'unda
`new Function("token","fetch", clientSource)` ile çalışıyor → exec-host'ta arbitrary
code execution + tüm space'lerin secret'ları o host'ta transit.

**Durum:** Kod YAPILDI + box'ta (`ssh root@195.201.198.247`, microsandbox 0.5.4)
microVM probe ile DOĞRULANDI. Branch `faz1-provider-vm` (commit'li, push edilmedi).
Kalan: branch'i `/opt/msb-codeexec`'e deploy + app'i `CODE_RUNTIME=remote` + HTTPS
`CODE_EXEC_URL` ile gerçek workflow üstünden e2e.

**Kapsam (yapılan):**
- msb-codeexec: `broker.ts` / `/broker/call` / `registerProviders` / host'taki
  `new Function` **silindi** → RCE kapandı. Provider client artık **harness
  içinde, VM'de** kuruluyor (`new Function` VM içinde = untrusted kod untrusted
  sandbox'ta). Provider spec'leri (secret HARİÇ) `/tmp/fb_providers.json`'a yazılıyor.
- **Cred:** native secret injection — `network(nb => nb.secret(s => s.env(FB_SECRET_i)
  .value(secret).allowHost(egressDomain).injectHeaders/BasicAuth/Query(true)))`.
  VM env'inde placeholder; gerçek secret tel üstünde swap. CA otomatik.
- **Network flip:** `VM_EGRESS=public` (default) → `NetworkPolicy` defaultEgress
  allow + `denyEgress` metadata / loopback / link-local / private / host / multicast
  + `allowDns`. `VM_EGRESS=all` ile gevşetilebilir.
- workflowv2: `/run` payload AYNEN aynı (`{name, clientSource, secret, egressDomain}`)
  — app tarafı değişmedi. `CODE_EXEC_URL` **HTTPS** olmalı (secret dedicated
  makineye gidiyor). Prod in-process yasağı zaten var.

**Doğrulama sonuçları (box probe, microVM):**
- [x] secret guest env'de placeholder (`$MSB_FB_SECRET_0`), gerçek değer yok.
- [x] negatif: metadata `169.254.169.254` ve loopback `127.0.0.1` **bloklu**
  (ECONNREFUSED); public egress (example.com) çalışıyor.
- [x] HTTPS + auto-CA: status 200, cert hatası yok (CA guest'te otomatik güvenli).
- [x] secret wire-swap: **`tls()` interception açıkken** placeholder gerçek
  secret'la değişiyor; **kapalıyken DEĞİŞMİYOR** (placeholder API'ye gider).

**Kritik düzeltme (commit b7f68b6):** native secret injection tek başına yetmiyor;
provider varsa `network().tls(t => t.interceptedPorts([443]).blockQuic(true))`
**şart**. Aksi halde upstream'e placeholder gider, auth patlar.

---

## Faz 2 — Performans: dependency & snapshot katmanı

**Hedef:** Arbitrary npm lib (native dahil) kabul edilebilir latency'de.
(Ürünün make-or-break'i; sandbox değil bu katman.)

**Ölçüm (box, microsandbox 0.5.4 — kararların dayanağı):**
| | pg (küçük) | aws-sdk (ağır, 108MB) |
|---|---|---|
| cold microVM start | 244 ms | 247 ms |
| npm install | 1880 ms | 5726 ms |
| snapshot create (CoW) | 42 ms | 175 ms |
| snapshot'tan boot | ~1350 ms | ~336 ms |
| **per-run-install toplam** | 2172 ms | **6135 ms** |
| **snapshot path toplam** | 1476 ms | **625 ms** |

Çıkarımlar: (1) **microVM cold start ~250ms = ihmal edilebilir**, VM hiç darboğaz
değil. (2) **npm install tüm maliyet**, lib boyutuyla büyür. (3) snapshot CoW —
create ucuz, logical 4.3GB ama fiziksel delta; boot <1.4s. (4) snapshot ROI install
maliyetiyle ölçekleniyor: küçük lib'de marjinal, **ağır lib'de ~10x kazanç**. Snapshot
build offline (install + ~8s stop + snapshot), run-time sadece boot.

**Çıkan mimari:**
- **Execution modeli değişimi (önkoşul):** harness `new Function(source)` → gerçek
  **modül** dosyası. `import`'un çalışması için kaynak modül olmalı + node_modules VM'de.
  Kontrat: `export default async (ctx, input) => …`.
- **Dep beyanı:** provider explicit `dependencies` verir (parse değil).
- **Per-provider snapshot lifecycle:** provider yazılınca/değişince exec servisi
  deps'i kurup snapshot alır, **deps-hash** ile tag'ler (`POST /prepare`). `/run`
  snapshot ref'iyle boot eder, install yok. Deps değişince yeniden build.
- **Pre-baked base image:** en yaygın lib'ler base'de → snapshot'suz/ilk run da OK,
  snapshot'lar küçük kalır.
- (Opsiyonel) **Registry cache** (Verdaccio) → "yeni çıkmış lib" install'ını hızlandırır.

**Uygulama sırası:** (1) execution modeli + dep beyanı + per-run install → "AI lib
import edebiliyor" e2e (yavaş ama çalışır). (2) snapshot lifecycle → hızlı yap.

**Adım 1 — exec servisi YAPILDI + box'ta doğrulandı** (branch `faz1-provider-vm`,
commit 4ec64f7). Harness `new Function` → ESM modül (`export default`); func
`async (ctx, input)`, provider `(secret, fetch)` factory; `dependencies` alanı →
per-run `npm install`. Box e2e: func `import pg`, modül-provider + secret injection,
provider `import nanoid` — üçü de geçti. Yan-fix (d9f1dc8): runCode artık stop sonrası
`Sandbox.remove` ediyor (canlıda ~4500 leftover stopped VM birikmişti).
**Adım 1 — app tarafı YAPILDI + lokalde doğrulandı.** `Runtime` interface'i zaten
vardı (`engine/worker.ts`); `EvalRuntime` → **`LocalRuntime`** (host'ta, izolasyonsuz
ama **depli**: deps-hash cache + `npm install` + modül import). Resolver tek
carrier-tabanlı (her iki runtime). Provider builtin'leri (slack/github/http) çift
`createClient` kaydından tek modül `clientSource`'a indi; `createClient`/
`buildClientWithSecret` silindi. AI prompt+şemalar (provider-author, func-author,
workflow-designer) modül kontratı (`export default`) + `dependencies`. `RemoteSandboxRuntime`
func+provider deps'lerini birleştirip forward ediyor. Lokal e2e: func `import dayjs`,
modül-provider+fetch, provider `import nanoid` — üçü de geçti.

**Faz 2 Adım 1 TAMAM.** Kalan: **Adım 2 — snapshot lifecycle** (per-provider/deps-hash
snapshot, `POST /prepare`, run snapshot'tan boot) hem exec hem LocalRuntime cache'i.

**Çıkış kriteri:** "Yeni çıkmış lib" yolu çalışıyor; provider'lı tipik run snapshot'tan
<1s'de boot ediyor (install yok); snapshot'lar cred İÇERMİYOR.

**Risk:** (1) Snapshot'a cred sızması — snapshot build'i secret'sız yapılmalı (env
injection run-time'da, snapshot author-time'da). (2) Snapshot storage/GC — fiziksel
delta'yı + eski snapshot eviction'ı Faz 3'te kotalan.

---

## Faz 3 — Ölçek & kontrol: limit, kota, gözlemlenebilirlik

**Hedef:** Multi-tenant adalet + denetlenebilirlik + maliyet kontrolü.

**Kapsam:**
- Per-space resource limit (cpu/mem/timeout) + concurrency kota (bir space
  diğerlerini aç bırakamaz).
- Audit log: hangi space, hangi run, hangi egress, hangi cred kullanıldı.
- Cost attribution (run/space başına), abuse/anomali tespiti (crypto-mining,
  egress patlaması).
- Secret hijyeni denetimi: log scrub, error redaction, env minimizasyonu (sadece
  run'ın kullandığı provider cred'i enjekte).

**Çıkış kriteri:** Tek space sistemi boğamıyor; her run audit'lenebilir; space
başına maliyet görünür.

---

## Faz 4 — Stateful: warm per-space pool + session [sadece gerekince]

**Hedef:** Persistent bağlantı gerektiren entegrasyonlar (NATS / Kafka / DB pool /
websocket).

**Kapsam:**
- Warm per-space VM pool + lifecycle (idle TTL, eviction).
- Session modeli: run boyunca (veya ötesinde) kalıcı connection; pub/sub için
  broker↔VM streaming kanalı.
- Warm pool izolasyon dikkati: snapshot zehirlenmesi, state taşınması, idle maliyet.

**Çıkış kriteri:** NATS subscribe-tarzı bir workflow çalışıyor; warm pool izolasyonu
+ lifecycle doğrulanmış.

**Karar tetikleyici:** Stateful entegrasyon gerçekten birinci sınıf olunca aç; yoksa
YAGNI, ephemeral kal.

---

## Bağımlılık & sıra

```
Faz 1 (RCE kapat) ──► her şeyin önkoşulu
       │
       ├──► Faz 2 (perf)      ─┐  kısmen paralel
       └──► Faz 3 (kontrol)   ─┘
                  │
                  └──► Faz 4 (stateful)  ← sadece ihtiyaç doğunca
```

## Cross-cutting (her fazda canlı)

- **Secret hijyeni:** runtime env injection, snapshot/image'a gömme yok, log scrub.
- **NetworkPolicy** her fazda load-bearing — her değişiklikte negatif test.
- **İki-repo kontrat versiyonlama:** msb-codeexec ↔ workflowv2 arası flag'li geçiş.
