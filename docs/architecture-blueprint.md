# Angular Web MCP — Architecture Blueprint & Implementation Plan

> An open-source enterprise Sales & Deals CRM that exposes its Signal state and Signal Forms to AI agents through Angular's native WebMCP APIs.
>
> It serves two purposes:
>
> 1. a long-lived reference app for Angular and WebMCP best practices
> 2. the live demo at **Google DevFest Mumbai** (12–15 min)
>
> **Status:** ✅ Approved. Implemented session by session (§8).

---

## 0. Baseline

### 0.1 Version pins (npm, verified 2026-11-09). Install with `--save-exact`

| Concern         | Package                                                                   | Version    | Notes                                                           |
| --------------- | ------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| Framework       | `@angular/*`                                                              | **22.2.5** | Zoneless by default (v21+), OnPush by default (v22)             |
| CLI / build     | `@angular/cli`, `@angular/build`                                          | **22.2.6** | `unit-test` builder, Vitest runner                              |
| TypeScript      | `typescript`                                                              | **6.0.3**  | Angular 22 requires `>=6.0 <6.1`, so **not** 7.x                |
| State           | `@ngrx/signals`                                                           | **22.0.1** |                                                                 |
| UI              | `@angular/material`, `@angular/cdk`                                       | **22.2.6** | M3                                                              |
| Headless a11y   | `@angular/aria`                                                           | **22.2.6** | `ngListbox` / `ngOption`                                        |
| CSS             | `tailwindcss`, `@tailwindcss/postcss`                                     | **4.3.5**  | A separate `tailwind.css` entry that doesn't go through Sass    |
| Fonts           | `@fontsource-variable/inter` 5.3.0, `material-symbols` 0.48.3             |            | Self-hosted, which keeps the CSP tight                          |
| LLM SDK         | `@google/genai`                                                           | **3.0.0**  | Lazy-loaded through `injectAsync()`                             |
| WebMCP polyfill | `@mcp-b/webmcp-polyfill`                                                  | **6.0.3**  | For browsers without a native registry. Not an offline fallback |
| Tests           | `vitest` / `@vitest/coverage-v8` 5.1.0, `jsdom` 31.0.0, `axe-core` 4.14.0 |            |                                                                 |
| Lint / format   | `angular-eslint` 22.6.0, `prettier` 3.9.10                                |            |                                                                 |
| Runtime         | Node 24.18.0 / npm 11.16.0                                                |            |                                                                 |
| Stage browser   | Chrome **158.0.8127.18**                                                  |            | Native `document.modelContext` (flag)                           |

### 0.2 Platform facts (verified in the Angular 22.2.5 source and Chrome docs)

**`declareExperimentalWebMcpTool(tool, injector?)`** (`@angular/core`):

- It resolves `document.modelContext ?? navigator.modelContext`, and **returns silently if neither exists**. So the polyfill must be installed before bootstrap.
- It calls `registerTool(wrapped, { signal })`. The signal aborts when the injector's `DestroyRef` fires, which unregisters the tool.
- `execute(args, client)` runs in `runInInjectionContext` and receives `{ …client, signal }`, where `signal = AbortSignal.any([injectorDestroyed, client.signal])`.
- `provideExperimentalWebMcpTools(tools)` is an environment initializer that calls the function above for each tool.

**`ToolDescriptor`** (bundled `webmcp-types@0.1.10`):

- Fields: `name` (1–128 characters of `[A-Za-z0-9_.-]`), `title?`, `description`, `inputSchema?`, `execute`, and `annotations?`.
- Annotations: `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging`.
- `execute` returns `MaybePromise<unknown>`.

**Signal Forms tool** (`@angular/forms/signals`, `provideExperimentalWebMcpForms()`, `[formField]`):

- The schema is inferred from the model value, as **types only**: string, number, boolean, objects and non-empty arrays. `required` comes from `required()` validators, and `additionalProperties: false` is set. It emits no description, enum, min or format, so constraints go in the tool description.
- `execute` calls `value.set(args)` (the UI updates live) and then `submit()`. It returns `"Form submitted successfully."` or `"Form submission failed:\n<path>: <message>"`.
- ⚠️ `value.set` replaces the whole model, so omitted keys become `undefined`. **Every agent-facing field must be `required()`.**
- `options.annotations` is spread into the tool, but `readOnlyHint` and `untrustedContentHint` are forced to `false`.

**Chrome 158:**

- Client API: `document.modelContext` with `getTools()` (sorted), `executeTool(tool, args, { signal })` (args as an object), and the `toolchange` event.
- Status: origin trial / flag, with no Intent-to-Ship yet ([source](https://developer.chrome.com/docs/ai/webmcp/secure-tools)). Enable `chrome://flags/#enable-webmcp-testing` on the stage laptop.
- Other browsers get the polyfill. Hosting (Vercel) is owner-managed.

### 0.3 Open assumptions

| ID  | Assumption                                                                                                                                                                                    | Verify in | Fallback                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| A6  | The polyfill exposes an install entry point for `document.modelContext`                                                                                                                       | 4.1       | A ~60-line `installRegistryShim()`, which is also the base of the test fake |
| A7  | The `withHooks` factory and `withFeature` run in an injection context                                                                                                                         | 2.2       | Pass `inject(Injector)` through `withProps`                                 |
| A8  | `@google/genai` supports `thinkingConfig.{thinkingLevel, includeThoughts}`, per-request `config.tools`/`abortSignal` on `sendMessageStream`, `parametersJsonSchema`, and `thoughtsTokenCount` | 8.2       | No thinking config; recreate the chat when tools change; use `parameters`   |
| A9  | The Aria listbox supports single-select through a `value` model                                                                                                                               | 8.1       | Native `radiogroup` with roving tabindex                                    |
| A10 | `security.autoCsp` coexists with a production CSP `<meta>`                                                                                                                                    | 8.1       | The `<meta>` only, with build hashes                                        |

### 0.4 Coding standards

These are based on the [official Angular v22 rules](https://angular.dev/assets/context/best-practices.md) and enforced by review and ESLint.

- **TypeScript:**
  - `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  - no `any` (use `unknown`)
  - `import type` for types-only imports
  - `readonly` on injected fields and signals
- **Components:**
  - Never write `standalone: true` or `changeDetection`.
  - Use `input()`, `input.required()`, `output()` and `model()`.
  - Use `host: {}` instead of `@HostBinding` and `@HostListener`.
  - Template members are `protected`.
  - Files follow the v20+ style guide naming, with no `.component` or `.service` suffixes.
- **Templates:**
  - **Always `templateUrl`.** Every component is a `.ts` file plus a sibling `.html` file. There is never an inline `template:` or `styles:`, and `styleUrl` is used only when it's needed (most styling is Tailwind). A component listed as `name.ts` implies `name.html`.
  - `@if`, `@for` (with `track`), `@switch`, `@let`, `@defer`, and self-closing tags.
  - `class` and `style` bindings, never `ngClass` or `ngStyle`. No `CommonModule`.
  - Logic stays minimal; derived values belong in `computed()`.
- **Signals:**
  - `computed` for derived state, `linkedSignal` for a resettable writable value, `debounced` for typed input, and `resource` for async reads.
  - `effect` only for side effects at the boundary.
  - `set` or `update`, never `mutate`.
- **DI:**
  - `inject()` only.
  - `@Service()` for app singletons and `signalStore({ providedIn: 'root' })` for root stores. Route-level stores go in route `providers`.
  - `injectAsync()` for the Gemini agent.
- **Forms:** Signal Forms only.
- **Routing:**
  - Lazy `loadComponent`.
  - `withAutoCleanupInjectors()`, `withComponentInputBinding()`, and the `isActive()` signal.
- **Accessibility:**
  - WCAG AA. Interactive components are axe-clean (`expectNoA11yViolations()`).
  - Visible focus, `prefers-reduced-motion`, a data-table fallback for the chart, and labelled dialogs.
- **Security:**
  - BYOK only (§6).
  - A production CSP. Model output is rendered as text, never `innerHTML`.
- **Comments are minimal.**
  - **Allowed:**
    - a one-line _why_ for something non-obvious
    - a link behind a workaround for an experimental API
    - a one-line JSDoc on the exported `mcp/` platform API (`defineTool`, `withWebMcpTools`, `withAgentHistory`, `ensureModelContext`)
  - **Not allowed:**
    - comments that restate the code
    - file headers and banners
    - `@param`/`@returns` that repeat the types
    - commented-out code
    - TODOs without an issue link
    - comments inside test bodies
- **ESLint:**
  - `angular-eslint` recommended, template, and template accessibility configs
  - `prefer-signals`, `prefer-output-readonly`
  - `template/prefer-control-flow`, `template/prefer-self-closing-tags`
  - `no-explicit-any`, `consistent-type-imports`
  - `component-max-inline-declarations` set to `{ template: 0, styles: 0, animations: 0 }`
  - `no-warning-comments`
  - `no-restricted-imports` for the layering rules (§2)

---

## 1. Architecture

### 1.1 System diagram

```
╔═══════════════════════════════════════════════════════════════════════════════════╗
║ AGENTS   In-app GeminiAgent (BYOK, injectAsync)        External WebMCP agents      ║
║          ⚡ 3.5-flash-lite · 🛠️ 3.8-flash · 🧠 4-argon     (Chrome agent, Tool        ║
║          streaming · thoughts · usage → cost            Inspector ext.) — no key   ║
║          AgentSessionStore → McpToolGateway (only in-app registry client) ──┐      ║
╚══════════════════════════════╪════════════════════════════════════════════│══════╝
                               ▼ getTools() / executeTool(tool, args, {signal})   │ telemetry
╔══════════════════════════════════════════════════════════════════════════════│══════╗
║ REGISTRY  document.modelContext  (Chrome 158 native │ @mcp-b polyfill)        │      ║
╚════════▲══════════════════▲═════════════════════▲═══════════▲════════════════│══════╝
         │ registerTool     │                     │           │ toolchange      │
╔════════╧══════════════════╧═════════════════════╧═══════════╧════════════════│══════╗
║ ANGULAR WebMCP                                                               │      ║
║ ① provideExperimentalWebMcpTools (route)   getPipelineSummary · searchDeals · getDealDetails
║ ② withWebMcpTools() store feature          setDealFilter · applyBatchDiscount ·      ║
║    → declareExperimentalWebMcpTool(t, inj)  updateDealStages · terminateContract ·   ║
║                                             openProposalDrawer                       ║
║ ③ Signal Forms experimentalWebMcpTool      draftDealProposal (dynamic)              ║
║ defineTool(): telemetry → validation → human approval → snapshot → run ─────┘      ║
╚═══════════════════════════════════╪═══════════════════╪═════════════════════════════╝
                    HUMAN_APPROVAL_GATE                  store.recordSnapshot()
             ApprovalService → MatDialog      DealsStore = signalStore(withDeals(),
             WireTelemetryStore (packets)       withAgentHistory(), withFeature(withWebMcpTools))
╔═══════════════════════════════════════════════════════════════════════════════════╗
║ VIEWS  MetricsStrip · PipelineChart · DealsTable · ProposalDrawer · ApprovalDialog  ║
║        HistoryPanel/Undo · AgentConsole · WireInspector · BYOK/ModelPicker · Lab     ║
╚═══════════════════════════════════════════════════════════════════════════════════╝
```

### 1.2 Decisions

| #   | Decision                                                                                               | Why                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The in-app agent reaches state **only** through `document.modelContext`                                | It sees exactly what Chrome's agent sees, and every call is traced                                                                                          |
| D2  | **NgRx SignalStore**, plus two custom features: **`withWebMcpTools()`** and **`withAgentHistory()`**   | It is the standard for structured signal state, and is built on Angular signals. Agent capabilities become composable store features ("agent-ready stores") |
| D3  | `HUMAN_APPROVAL_GATE` and `AGENT_CONFIG` tokens are owned by `mcp/` and implemented by `features/`     | `mcp/` stays a reusable platform with no Material and no feature imports                                                                                    |
| D4  | `defineTool()` middleware                                                                              | Cross-cutting concerns live in one place, so each tool body is 10–20 lines                                                                                  |
| D5  | Resolve all dependencies synchronously at the start of `execute`                                       | The injection context ends at the first `await`                                                                                                             |
| D6  | Results are `{ content: [{ type: 'text', text: JSON }] }`                                              | MCP-compatible, and it matches Angular's form tool                                                                                                          |
| D7  | Invalid input throws `ToolInputError`. A human rejection returns `status: 'rejected_by_human'`         | The model adapts to a rejection instead of failing                                                                                                          |
| D8  | Undo is human-only; there is no undo tool                                                              | "The agent can't erase its own audit trail"                                                                                                                 |
| D9  | Telemetry uses MCP JSON-RPC 2.0 framing                                                                | Familiar to the audience. WebMCP itself is an in-page API, and the talk says so                                                                             |
| D10 | Live-only, BYOK                                                                                        | No mock or recorded fallback. Fakes exist only in `src/testing`                                                                                             |
| D11 | Feature-owned state and tools (`features/dashboard/`)                                                  | State, UI and agent surface stay together                                                                                                                   |
| D12 | The `/dashboard` parent route owns the domain providers; `lab` is a child route and `about` is outside | Leaving to `/about` unregisters the tools. The Lab keeps the store alive                                                                                    |
| D13 | A deterministic seed (24 deals, `D-1001…D-1024`)                                                       | Acts, tests and evals share one known starting state                                                                                                        |
| D14 | No `provideZonelessChangeDetection()`                                                                  | It's redundant since v21. A test asserts `globalThis.Zone === undefined`                                                                                    |

---

## 2. Directory Structure

```
.github/workflows/ci.yml        # tests only, push to main
docs/  architecture-blueprint.md · demo-script.md · eval-log.md
src/
├── main.ts                     # await ensureModelContext() → bootstrapApplication()
├── index.html                  # production CSP
├── styles.scss · tailwind.css
├── testing/                    # fake-model-context · fake-genai · act-scripts · deal-fixtures · a11y · test-providers
└── app/
    ├── app.ts/.html · app.config.ts · app.routes.ts
    ├── core/                   # LEAF
    │   ├── models/ (deal, proposal) · data/seed-deals.ts · util/ (money, clock)
    │   ├── services/theme.ts
    │   └── store-features/with-agent-history.ts
    ├── mcp/                    # reusable WebMCP platform → core only
    │   ├── registry/ (model-context, ensure-model-context)
    │   ├── schema/validate-args.ts
    │   ├── tooling/ (define-tool, with-telemetry, with-validation, with-human-approval, with-snapshot, approval-gate, tool-errors)
    │   ├── store-features/with-webmcp-tools.ts
    │   ├── telemetry/ (wire-packet, wire-telemetry-store)
    │   └── agent/ (agent-events, agent-config, mcp-tool-gateway, agent-session-store, system-prompt,
    │              gemini/ (gemini-models, genai-client, tool-adapter, gemini-agent))
    ├── features/
    │   ├── layout/layout-store.ts
    │   ├── dashboard/  dashboard-shell · dashboard-page · metrics-strip/ · pipeline-chart/ · deals-table/
    │   │   ├── data/ (with-deals, deals-store, dashboard-ui-store)
    │   │   └── tools/ (deal-context-tools, deal-mutation-tools, risk-policy)
    │   ├── proposal/   proposal-drawer · proposal-form · proposals-store
    │   ├── approvals/  approval-service · approval-dialog
    │   ├── history/    agent-history-panel · undo-notifier
    │   ├── agent-console/ agent-console · transcript-item · demo-prompts
    │   ├── settings/   settings-store · api-key-dialog · model-picker
    │   ├── wire-inspector/ wire-inspector · packet-detail · json-view
    │   ├── lab/        lab-page · isolated-run · model-race · act-evals
    │   └── about/      about-page
    └── shared/                 # LEAF: ui/ (glass-card, stat-tile, stage-badge) · pipes/compact-currency
```

**Layering**, enforced by `no-restricted-imports`: `core ◄ mcp ◄ features ► shared`.

- `core` and `shared` import no other app layer.
- `mcp` never imports `features` or `@angular/material`.

---

## 3. State Design

### 3.1 Domain types

```ts
type DealStage =
  'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed-won' | 'closed-lost';
type Region = 'APAC' | 'EMEA' | 'NA' | 'LATAM';
interface Deal {
  id: string;
  account: string;
  title: string;
  owner: string;
  region: Region;
  stage: DealStage;
  listValue: number;
  discountPct: number;
  probability: number;
  closeDate: string;
  contractStatus: 'none' | 'active' | 'terminated';
  contactEmail: string;
  lastActivityDays: number;
}
interface DealFilter {
  stages: DealStage[];
  regions: Region[];
  minValue: number | null;
  query: string;
}
```

### 3.2 `DealsStore`

```ts
export function withDeals() {
  return signalStoreFeature(
    withEntities<Deal>(),
    withState<{ filter: DealFilter }>({ filter: EMPTY_FILTER }),
    withComputed(({ entities, filter }) => ({
      filteredDeals: computed(() => applyFilter(entities(), filter())),
      pipelineByStage: computed(() => byStage(entities())),
      byRegion: computed(() => byRegion(entities())),
      kpis: computed(() => kpis(entities())),
      atRiskDeals: computed(() => entities().filter(isAtRisk)),
    })),
    withMethods((store) => ({
      setFilter,
      clearFilter,
      search,
      applyDiscount,
      moveStages,
      terminateContract,
      reset,
    })),
    withHooks({ onInit: (store) => store.reset() }),
  );
}

export const DealsStore = signalStore(
  withDeals(),
  withAgentHistory({ capacity: 20 }),
  withFeature((store) => withWebMcpTools(() => dealMutationTools(store))),
);
```

- Mutations return `MutationResult` (`changed` and `skipped`).
- `applyDiscount` clamps to 0–50. `moveStages` never reopens a `closed-*` deal. `terminateContract` only works on a closed-won deal with an active contract.

### 3.3 `withAgentHistory()` (generic, `core/store-features`)

- **State:** `history: { id, label, at, snapshot }[]`. The snapshot is `structuredClone(getState(store))` without `history`.
- **Computed:** `canUndo`, `lastEntry`.
- **Methods:** `recordSnapshot(label)`, `undo()`, `undoTo(id)`, `clearHistory()`, all through `patchState`.
- FIFO eviction at the configured capacity.

### 3.4 `withWebMcpTools()` (generic, `mcp/store-features`)

```ts
export function withWebMcpTools(tools: () => readonly ToolDescriptor[]) {
  return signalStoreFeature(
    withHooks(() => {
      const injector = inject(Injector);
      return {
        onInit: () => tools().forEach((t) => void declareExperimentalWebMcpTool(t, injector)),
      };
    }),
  );
}
```

- Tools close over the typed store from `withFeature`, with no `inject()` inside `execute`.
- The tools' lifetime equals the store's lifetime.

### 3.5 Other stores

| Store                | Scope | Key members                                                                                                                                        |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DashboardUiStore`   | route | `proposalOpen`, and `selectedDealId` (`withLinkedState`, which resets when the deal is filtered out). Tool: `openProposalDrawer`                   |
| `ProposalsStore`     | route | `withEntities<ProposalDraft>`, `saveDraft()`                                                                                                       |
| `LayoutStore`        | root  | `consoleOpen`, `inspectorOpen`                                                                                                                     |
| `SettingsStore`      | root  | `apiKey`, `remember`, `model`, `keyCheck` (`resource`), `forgetKey()`                                                                              |
| `WireTelemetryStore` | root  | `withEntities<WirePacket>`, `begin`/`end`/`record`, `stats`, `byModel`, `pause`, `clear`, `exportJson`                                             |
| `AgentSessionStore`  | root  | `status` (`idle`, `running`, `awaiting-approval` or `error`; derived from `gate.pending`), `transcript`, `run`, `stop`, `lastUsage`, `lastCostUsd` |

---

## 4. WebMCP Tools

**Conventions:**

- camelCase names.
- `additionalProperties: false` everywhere.
- Every mutation requires `reason` (3–200 characters).
- Each description says _when_ to use the tool, and is tuned through the Lab (§5.2).

### 4.0 `defineTool()`

```ts
defineTool({ name, description, inputSchema, annotations?, risk?, snapshot?, run }): ToolDescriptor
```

Inside `execute(args, { signal })`:

1. Resolve the telemetry store, the gate (optional) and `CLOCK` synchronously.
2. **Telemetry** opens a span.
3. **Validation** runs `validateArgs()`. On failure it throws `ToolInputError` with field paths.
4. **Approval:** if `risk` requires it, await `gate.request(req, signal)`. **If no gate is provided, the call is rejected (fail-safe).**
5. **Snapshot:** `snapshot.recordSnapshot()` runs after approval.
6. **`run`**, then `toToolResult()`. Telemetry closes the span with latency and status.

### 4.1 ① Read-context tools: Act 1 (route `providers`)

| Tool                 | Input                                                                                             | Annotations                            | Output                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `getPipelineSummary` | `{}`                                                                                              | `readOnlyHint`                         | `{ kpis, byStage, byRegion, topDeals[5], generatedAt }`                                                    |
| `searchDeals`        | `{ stages?, regions?, minValue?, maxValue?, minProbability?, stalledOnly?, query?, limit? 1–25 }` | `readOnlyHint`                         | `{ total, deals: [{ id, account, region, stage, netValue, discountPct, probability, lastActivityDays }] }` |
| `getDealDetails`     | `{ dealId: ^D-\d{4}$ }`                                                                           | `readOnlyHint`, `untrustedContentHint` | the full `Deal`. An unknown ID → `ToolInputError`                                                          |

### 4.2 ② Mutation tools: Acts 2 and 4 (`withWebMcpTools` on `DealsStore`)

| Tool                 | Input                                              | Annotations         | Needs approval when                                   | Output                                                  |
| -------------------- | -------------------------------------------------- | ------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `setDealFilter`      | `{ stages?, regions?, minValue?, query?, clear? }` | —                   | never (view state, no snapshot)                       | `{ applied, visibleCount }`                             |
| `applyBatchDiscount` | `{ dealIds[1..25], discountPct 0–50, reason }`     | `consequentialHint` | the discount is over 15 % or the impact is over $250k | `{ status, changed[{id,before,after}], revenueImpact }` |
| `updateDealStages`   | `{ updates[1..25]{dealId,stage}, reason }`         | `consequentialHint` | a deal over $100k moves to `closed-lost`              | `{ status, moved[], skipped[{id,why}] }`                |
| `terminateContract`  | `{ dealId, reason }`                               | `consequentialHint` | always (critical)                                     | `{ status, dealId, terminatedAt }`                      |

### 4.3 Human-in-the-loop gate

```ts
interface HumanApprovalGate {
  readonly pending: Signal<ApprovalRequest | null>;
  request(r: ApprovalRequest, signal: AbortSignal): Promise<{ approved: boolean; note?: string }>;
}
```

`ApprovalService` (`features/approvals`) implements it:

- A FIFO queue, so there is one dialog at a time.
- `MatDialog` with `disableClose`. Reject gets focus for critical requests.
- An abort becomes a rejection with the note `'aborted'`.
- It emits `hitl/requested` and `hitl/resolved` packets, so human wait time is tracked separately from tool latency.
- `setAutoDecider(fn | null)` supports the Lab's eval mode.

### 4.4 ③ Signal Form tool: Act 3

**`openProposalDrawer`** (`withWebMcpTools` on `DashboardUiStore`):

- Input: `{ dealId }`.
- It opens the drawer, the form tool registers, and `toolchange` fires.

**`draftDealProposal`** (`form()` option on `ProposalDrawer`, rendered at most once with `@if`):

- **Model.** All fields are concrete and **all are `required()`**:
  `{ dealId:'', clientName:'', contactEmail:'', productTier:'Growth', seats:1, termMonths:12, discountPct:0, startDate:'', lineItems:['Platform license'] }`
- **Validators.** Each has a human-readable message:
  - `email`
  - seats 1–5000, term 6–60 months, discount 0–40
  - tier is Starter, Growth or Enterprise
  - `dealId` must exist
  - **`startDate` must be the 1st of a month** (billing cycle). This triggers a natural self-correction on stage.
- **Description:** lists the tier values and the ISO date format, because the inferred schema has types only.
- **`submission.action`:**
  - A discount over 15 % → the approval gate.
  - Starter tier with more than 1000 seats → a submission error.
  - Otherwise → `saveDraft()`.
- **Agent-fill shimmer:** an `effect()` diff sets `data-agent-filled` on changed fields, for a 1.2 s glow. The animation respects reduced motion.

### 4.5 Gateway and agent

```ts
type AgentEvent =
  | { type: 'thought' | 'text-delta'; text: string }
  | { type: 'tool-call'; callId: string; name: string; args: unknown }
  | {
      type: 'tool-result';
      callId: string;
      name: string;
      result: unknown;
      ok: boolean;
      latencyMs: number;
    }
  | { type: 'tools-changed'; added: string[]; removed: string[] }
  | { type: 'awaiting-approval'; toolName: string }
  | {
      type: 'error';
      message: string;
      kind: 'auth' | 'quota' | 'model-access' | 'network' | 'max-steps' | 'unknown';
    }
  | {
      type: 'done';
      usage: { input: number; output: number; thinking: number };
      costUsd: number;
      model: string;
      ms: number;
    };
```

**`McpToolGateway`** (`@Service()`) provides `listTools()`, `callTool(name, args, signal)`, `waitForTool(name, ms)` and a `toolsVersion` signal. It emits the `tools/list`, `tools/call` and `notifications/tools/list_changed` packets.

**`GeminiAgent`** (lazy chunk):

1. Map the tools to `functionDeclarations` with `parametersJsonSchema`.
2. Create the chat with `chats.create({ model, config: { systemInstruction, tools, thinkingConfig: { thinkingLevel, includeThoughts: true }, automaticFunctionCalling: { disable: true } } })`.
3. Run a `sendMessageStream` loop for at most **8 steps**. Send each `functionResponse` back on the **same chat**, so thought signatures are preserved. Refresh the tools after a `toolchange`.
4. Record `usageMetadata` (including `thoughtsTokenCount`) and `costUsd` in a `generateContent` packet.
5. Map errors:
   - 401/403 for the key → `auth`
   - 429 → `quota`
   - 403/404 for the model → `model-access`
   - fetch failure → `network`

### 4.6 Telemetry packet

```ts
interface WirePacket {
  id: number;
  at: number;
  correlationId: string;
  runId?: string;
  channel: 'mcp' | 'llm' | 'hitl' | 'human';
  method:
    | 'tools/list'
    | 'tools/call'
    | 'notifications/tools/list_changed'
    | 'generateContent'
    | 'hitl/requested'
    | 'hitl/resolved'
    | 'human/undo';
  envelope: unknown;
  status: 'pending' | 'ok' | 'error' | 'rejected';
  latencyMs?: number;
  bytes: number;
  model?: string;
  tokens?: { input: number; output: number; thinking: number };
  costUsd?: number;
}
```

- Packets are capped at 500.
- **Redaction:** the `x-goog-api-key` header, any `key=` value, and the raw key itself are replaced with `•••`.

### 4.7 Gemini models (verified 2026-11-09, [models](https://aistudio.google.com/docs/models), [pricing](https://aistudio.google.com/docs/pricing))

| Persona               | Model ID                | `thinkingLevel` | Free tier | $ / 1M in / out                             | Role                                                                     |
| --------------------- | ----------------------- | --------------- | --------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| ⚡ Sprinter           | `gemini-3.5-flash-lite` | low             | ✅        | 0.30 / 2.50                                 | Act 1, fast reads                                                        |
| 🛠️ Operator (default) | `gemini-3.8-flash`      | medium          | ✅        | 0.75 / 3.75 (1.50 / 7.50 from 2027-01-01)   | Acts 2–4                                                                 |
| 🧠 Strategist         | `gemini-4-argon`        | high            | ❌        | 2.00 / 10.00 (4.00 / 20.00 from 2026-12-01) | The user's choice. Shown with a "paid tier" badge; **not used on stage** |

- All three have a ~1M-token context window. The contrasts are latency, reasoning depth, tool calls and cost.
- The catalog stores dated `priceSchedule[]` entries. The picker never hides a model, and every run shows its cost.
- A Gemini app subscription doesn't fund API calls. Users need an AI Studio key, and Argon needs billing enabled.

---

## 5. Live-Demo Arc (12–15 min, all live)

| Time        | Act                      | Prompt (chip)                                                                                               | Tools                                                               | Audience sees                                                                                            |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0:00–1:30   | Cold open                | —                                                                                                           | —                                                                   | The Inspector Tools tab shows 8 tools. Go to `/about` and they vanish; come back and they return         |
| 1:30–4:00   | **1 · Context** (⚡)     | "Give me a pipeline summary — where are we exposed this quarter?"                                           | getPipelineSummary, searchDeals                                     | Fast streamed answer and thoughts                                                                        |
| 4:00–7:00   | **2 · Multi-step** (🛠️)  | "Show EMEA deals in Negotiation, give them 10% off, and move anything above 70% probability to Closed Won." | setDealFilter → searchDeals → applyBatchDiscount → updateDealStages | The table filters, bars animate, KPIs tick, and an UNDO snackbar appears                                 |
| 7:00–9:30   | **3 · Signal Form** (🛠️) | "Draft a 24-month Enterprise renewal for Konkan Freight, 250 seats, starting mid-December."                 | openProposalDrawer → _toolchange_ → draftDealProposal ✗ → ✓         | A new tool appears, fields glow as they fill, and the agent fixes the start date                         |
| 9:30–12:00  | **4 · Governance** (🛠️)  | "End of quarter: give Arcadia Bank 25% off and terminate the Monsoon Retail contract."                      | applyBatchDiscount ⏸ Approve; terminateContract ⏸ Reject            | The agent pauses on a diff dialog and adapts. Then Undo rolls the chart back                             |
| 12:00–14:00 | **5 · Wire + Race**      | Lab → Model Race (⚡ vs 🛠️): "Which three deals should I prioritise this week and why?"                     | read tools                                                          | Packets, then latency, tool calls, thinking tokens and $ side by side. Mention that 🧠 is one click away |
| 14:00–15:00 | Close                    | —                                                                                                           | —                                                                   | The registration styles, `withWebMcpTools()`, and the audit trail                                        |

### 5.1 WebMCP feature notes per act

- **Cold open:**
  - `provideExperimentalWebMcpTools` in route providers, plus `withAutoCleanupInjectors()`.
  - Leaving the route destroys its injector. The `DestroyRef` aborts the registration signals, and `toolchange` fires.
- **Act 1:**
  - Registration style ①, with `readOnlyHint` (and `untrustedContentHint` on `getDealDetails`).
  - `execute` runs in the route injector's injection context and calls `inject(DealsStore)`. It returns data derived from computed signals.
  - Arguments are validated by us, because Angular doesn't validate them.
  - The agent uses `getTools()` and `executeTool()`.
- **Act 2:**
  - Registration style ②, `withWebMcpTools()` → `declareExperimentalWebMcpTool(tool, storeInjector)`, so the tools live as long as the store.
  - `consequentialHint` on the mutations.
  - `execute`'s `{ signal }` combines the agent's abort with injector destruction, so Stop cancels the call in flight.
- **Act 3:**
  - Registration style ③, with `provideExperimentalWebMcpForms()`, `form(…, { experimentalWebMcpTool })` and `[formField]`.
  - Rendering the drawer registers the tool and destroying it unregisters it, each time with a `toolchange`.
  - The schema is inferred as types only. `value.set(args)` fills the UI, then `submit()` runs.
  - Validation errors go back to the agent, which retries.
  - Gotcha: omitted keys become `undefined`, hence every field is `required()`.
- **Act 4:**
  - `consequentialHint`, and an async `execute` that stays pending while the dialog is open.
  - The abort signal counts as a rejection, and a rejection is a result, not an error.
  - The gate is inside the tool, so it also protects external agents. Undo is human-only.
- **Act 5:**
  - Client registry calls traced by the gateway, with the same 9 tools served to different models.
  - JSON-RPC framing is a visual convention only; say so on stage.

### 5.2 Lab-driven prompt tuning

There is no fallback, so reliability is **measured and tuned**. The Lab (`/dashboard/lab`) runs act prompts against the live API many times, scores every run, and links failures to their packets. Only text the model reads is tuned; business logic never changes to pass an eval.

| Knob                  | Location                                                      | Example                                                                 |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tool description      | `tools/*.ts`, form options                                    | "Use `setDealFilter` to change the view; use `searchDeals` to find IDs" |
| Argument descriptions | `inputSchema` (reaches Gemini through `parametersJsonSchema`) | "`discountPct`: the final percentage, not an increment"                 |
| System prompt         | `system-prompt.ts`                                            | "Look up IDs before mutating; never retry a rejected action"            |
| Stage prompt wording  | `demo-prompts.ts`                                             | "above 70% probability" rather than "likely"                            |
| Model per act         | the chip                                                      | ⚡ for Act 1, 🛠️ for Acts 2–4                                           |

```ts
interface ActEval {
  id: 'act1' | 'act2' | 'act3' | 'act4';
  prompts: string[]; // stage prompt + paraphrases (anti-overfitting)
  model: GeminiModelId;
  requiredSequence: string[]; // ordered subsequence
  allowedExtras: 'read-only' | 'none';
  forbidden: string[];
  approvals?: ('approve' | 'reject')[]; // scripted HITL decisions
  assertState: (deals: DealsStoreView, proposals: ProposalsView) => string | null;
}
```

**Scoring.** A run passes when:

- the required sequence appears in order
- no forbidden call or unexpected mutation is made
- the state assertion holds
- it finishes in ≤ 8 steps with no error

**Reporting** per act: pass rate, p50/p90 wall time, median tool calls, tokens, cost, and the Act 3 self-correction rate.

**Tuning loop:**

1. Get a baseline of 5 runs per act.
2. Classify each failure: wrong tool, wrong arguments, an invented ID, extra steps, a retry after rejection, or too slow.
3. Change one knob and re-run.
4. Log a row in `docs/eval-log.md` (date | act | change | pass before → after | p90).

**Sign-off and cadence:**

- Sign off with 10 runs per act: at least 9/10, with p90 inside the act's time slot.
- Freeze the text and model IDs about 5 days before the talk. Re-run the sign-off the day before, and on the venue Wi-Fi that morning.
- Estimated cost: about $0.01–0.03 per Operator run, so under ~$1 per sign-off sweep.

**Live readiness:**

- the sign-off above
- pre-flight (`docs/demo-script.md`): the Chrome flag is on and the chip says "native"; the key works for ⚡ and 🛠️; tethering is ready
- safety rails: Stop aborts the agent, any approval and in-flight fetches; `Shift+R` resets; `maxSteps` is 8

---

## 6. BYOK & Security

- **Entry:**
  - a masked input with `autocomplete=off`, and a link to `aistudio.google.com/apikey`
  - the model picker (`ngListbox` cards)
  - `keyCheck`, a `resource()` that calls `models.list()` with an abort signal
- **Storage:**
  - memory and `sessionStorage` by default
  - an opt-in "Remember on this device" option uses `localStorage`
  - "Forget key" clears both, and every storage access is in try/catch
- **No key needed for external agents.** Only the in-app console needs one, and an onboarding banner explains this.
- **Never:** the key never appears in source, environment files, the build, URLs, logs or telemetry (redacted).
- **CSP** (production `<meta>`): `default-src 'self'; script-src 'self' (+autoCsp); style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://generativelanguage.googleapis.com; base-uri 'self'; form-action 'self'`.
- **README guidance:**
  - restrict the key to the Generative Language API and your own referrers
  - free-tier traffic may be used by Google to improve products, which is acceptable because the data is fictional

---

## 7. Test Strategy

**Coverage:**

- Vitest in jsdom with V8 coverage.
- `coverageThresholds` of **60 %** on all four metrics fails the run. The internal target is **≥ 80 %**.
- `src/main.ts` and `src/testing/**` are excluded.

**Rules:**

- **No network:**
  - `GENAI_CLIENT_FACTORY` is always replaced with `FakeGenAI`.
  - `test-setup.ts` makes `fetch` throw.
- `FakeModelContext` is installed on `document.modelContext` in `beforeEach` and reset in `afterEach`.
- Material and Aria components are tested through CDK and Aria harnesses.
- Stores are tested through `TestBed` and `unprotected()`.
- Time-dependent code uses `vi.useFakeTimers()` and `CLOCK`.
- Interactive components must pass `expectNoA11yViolations()`. jsdom skips the contrast check, so Lighthouse is in pre-flight.

**Mix:**

- pure units ~45 %
- stores and services ~25 %
- components ~20 %
- **act acceptance** ~10 % (`demo-acts.spec.ts`): real tools, the real `GeminiAgent` and the real approval dialog, with `FakeGenAI` scripts

`FakeGenAI` script turns are either `functionCalls` or `text`, and can depend on previous responses. They can also stream, include thoughts, report usage, or throw HTTP-shaped errors.

---

## 8. Session Roadmap

### 8.0 Rules for every session

1. **Read §0–§7, then your session.** Don't re-architect. If assumption A6–A10 fails, use its fallback and note it in the commit body.
2. **Commits:**
   - Author: `Ankit Sharma <33789321+AnkitSharma-007@users.noreply.github.com>`, the repo-local config.
   - **No `Co-Authored-By` or any other trailer.** Verify with `git log -1 --format='%an <%ae>%n%(trailers)'`.
   - Use Conventional Commits.
   - Push only when asked, after `gh auth switch -u AnkitSharma-007`.
3. **Local gate before each commit:** `npm run lint && npm run test:coverage && npm run build`, with coverage ≥ 60 %. This gate is implied in every "Acceptance" below. CI runs tests only.
4. **Deployment is out of scope.** No `vercel.json`, no deploy workflows, no base-href changes.
5. **Follow §0.4, especially:**
   - `templateUrl` only
   - minimal comments
   - no `changeDetection`, `standalone`, constructor injection, `@HostListener`, `any` or `CommonModule`
6. **Keep §5.1 current** when a commit changes a WebMCP surface.

### Session 1 — Workspace, Tooling & Design System

**1.1** `chore(workspace): scaffold Angular 22 app with Vitest coverage gates, ESLint and CI`

- **Files:**
  - Scaffold with `npx @angular/cli@22.2.6 new angular-web-mcp --directory . --style=scss --routing --ssr=false --skip-git`. Keep `LICENSE` and pin `typescript@6.0.3`.
  - `ng add angular-eslint@22.6.0` with the §0.4 rules. Add `.prettierrc`.
  - `angular.json`: the vitest runner, thresholds of 60 on all four metrics, and the coverage excludes.
  - `tsconfig.json` strict flags.
  - Scripts: `start`, `build`, `lint`, `test`, `test:coverage`.
  - `src/test-setup.ts` with the fetch guard.
  - `app.ts/.html` (shell), `app.config.ts` (`provideBrowserGlobalErrorListeners`, and `provideRouter` with `withAutoCleanupInjectors` and `withComponentInputBinding`), `app.routes.ts`.
  - `README.md` stub with a CI badge.
  - `.github/workflows/ci.yml`:
    ```yaml
    name: CI
    on: { push: { branches: [main] } }
    concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
    jobs:
      test:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: 24, cache: npm }
          - run: npm ci
          - run: npm run test:coverage
    ```
- **Tests** (`app.spec.ts`): the app renders its title; `globalThis.Zone` is undefined; the router outlet is present; `fetch` throws the guard error.
- **Acceptance:** there is no `zone.js` dependency.

**1.2** `feat(theme): add Material 3 + Tailwind v4 design system with self-hosted fonts and dark mode`

- **Files:**
  - `styles.scss`: `mat.theme` with the azure/violet palettes and Inter, plus `color-scheme`.
  - `tailwind.css`: the `dark` custom variant and the `glass`/`glow` utilities, with reduced-motion guards.
  - `.postcssrc.json`.
  - `angular.json` styles.
  - `core/services/theme.ts`: `@Service()`, a `mode` signal, `toggle()`, persistence, and an `effect` that sets `.dark` on `documentElement`.
  - `shared/ui/glass-card`: `title`, and an `accent` input of `'primary' | 'warn' | 'success'`.
  - A toolbar theme toggle.
- **Acceptance:** the dark glass toolbar renders.

**1.3** `test(theme): cover ThemeService persistence, GlassCard projection and a11y baseline`

- **Files:** `testing/a11y.ts`, `theme.spec.ts`, `glass-card.spec.ts`, plus extensions to `app.spec.ts`.
- **Scenarios:**
  - **Theme:** dark by default; `toggle` flips the `<html>` class after `TestBed.tick()`; the mode persists and restores; a throwing `localStorage` falls back to the default.
  - **GlassCard:** projection, the title, and each accent class.
  - **Shell:** axe-clean.

### Session 2 — Domain & SignalStore

**2.1** `feat(core): add deal domain model, deterministic seed and money utilities`

- **Files:**
  - `core/models/*` and `core/data/seed-deals.ts`. The seed has 24 deals with these anchors:
    - ≥ 4 EMEA Negotiation deals, 2 of them with probability > 70
    - Konkan Freight (closed-won, active)
    - Arcadia Bank (Negotiation, $420k)
    - Monsoon Retail (closed-won, active)
    - ≥ 3 stalled deals
  - `core/util/{money,clock}.ts`, `shared/pipes/compact-currency.ts`, `shared/ui/stage-badge`.
  - `npm i -E @ngrx/signals@22.0.1`.
- **Tests** (in this commit):
  - **money:** rounding; net value at 0, 15 and 50 %; compact k/M/B.
  - **seed:** IDs are unique and sequential; the anchors are present; every value is valid.
  - **pipe and badge:** label and color for each stage.

**2.2** `feat(state): add withDeals SignalStore feature and generic withAgentHistory feature`

- **Files:** `core/store-features/with-agent-history.ts` (§3.3), `features/dashboard/data/with-deals.ts`, and `deals-store.ts` without the tools yet (§3.2).
- **Spike:** A7.

**2.3** `test(state): cover DealsStore analytics, mutations, guards and agent history`

- **Files:** `with-deals.spec.ts`, `with-agent-history.spec.ts` (against a minimal store), `deals-store.spec.ts`.
- **Scenarios:**
  - **Stage breakdown:** stage order; the percentages sum to ≈ 100.
  - **KPIs:** `weightedForecast`; `winRate`.
  - **Filter:** regions and stages narrow the deals; the query is case-insensitive; `clearFilter`; `search({ stalledOnly })`.
  - **Mutation guards:** the discount clamp; unknown IDs are reported as `skipped`; no reopening; the termination rules; `reset`.
  - **History:**
    - snapshot, then mutation, then undo restores deep equality
    - the snapshot is a deep clone
    - FIFO at 20
    - `undoTo` drops later entries
    - undo on an empty history is a no-op
    - `canUndo`

### Session 3 — Dashboard Views

**3.1** `feat(dashboard): add route shell, KPI strip and Material deals table with debounced search`

- **Files:**
  - `app.routes.ts`: `dashboard` (`DashboardShell`, `providers: [DealsStore, DashboardUiStore, ProposalsStore]`) with children `''` (`DashboardPage`) and `lab` (a placeholder). Also `about`, and a redirect from `''`.
  - `layout-store.ts`, `dashboard-shell`, `dashboard-page`, `dashboard-ui-store` (linked `selectedDealId`).
  - `metrics-strip`, `shared/ui/stat-tile`.
  - `deals-table`: `MatTable` and `MatSort`, filter chips, `debounced(query, 250)` feeding `setFilter`, and `row-flash` on rows changed in the last 2 s.
  - `about-page`.
  - Nav links using `isActive()`.
- **Acceptance:** 24 rows render.

**3.2** `feat(dashboard): add reactive SVG pipeline distribution chart`

- **Files:** `pipeline-chart`.
  - Stacked stage bars with `computed` geometry and CSS transitions (with reduced-motion guards).
  - `role="img"`, plus an sr-only table.
  - A region mini-row.

**3.3** `test(dashboard): cover KPI strip, deals table, chart reactivity and route tree`

- **Scenarios:**
  - **KPI strip:** tiles update after a mutation.
  - **Table** (harness): 24 rows; the EMEA filter; chip removal; sorting by net value; search filters only after 250 ms (fake timers); `row-flash`.
  - **Chart:** one rect per stage, with proportional widths; widths recompute after `moveStages`; an empty state with no NaN; the sr-only table matches.
  - **Linked state:** `selectedDealId` resets when the deal is filtered out.
  - **Routes:** `/dashboard/lab` shares the `DealsStore` instance; `/about` destroys it.
  - **A11y:** the dashboard is axe-clean.

### Session 4 — WebMCP Platform & Read Tools (Act 1)

**4.1** `feat(mcp): add registry bootstrap, polyfill fallback and JSON-schema argument validator`

- **Files:**
  - `mcp/registry/*`, with native, then polyfill, then shim (A6).
  - `main.ts`: `await ensureModelContext()`, then the `REGISTRY_KIND` token and a toolbar chip.
  - `validate-args.ts`, `tool-errors.ts`.
  - `testing/fake-model-context.ts`, `test-providers.ts`.
  - `npm i -E @mcp-b/webmcp-polyfill@6.0.3`.
- **Tests** (in this commit):
  - **validator:** type; required; `additionalProperties`; enum, min/max, pattern, minItems/maxItems; nested paths (`updates[1].stage`); success.
  - **ensure:** native, then polyfill, then shim.
  - **fake registry:** sorted output; a duplicate name throws; an abort unregisters and fires `toolchange`.

**4.2** `feat(mcp): add defineTool middleware and expose read-only context tools on the dashboard route`

- **Files:**
  - `mcp/tooling/define-tool.ts`, `with-validation.ts`, `with-telemetry.ts` (a no-op sink for now), and `approval-gate.ts` (the token).
  - `tools/deal-context-tools.ts` (§4.1), wired with `provideExperimentalWebMcpTools` in the dashboard providers.
- **Acceptance:** with the Chrome flag on, the Tool Inspector extension lists 3 tools, and they disappear on `/about`.

**4.3** `test(mcp): cover defineTool composition, context tools and route-scoped registration`

- **Scenarios:**
  - **defineTool:** invalid args → an error with the field path; the D5 regression (an await, then using `ctx`); the result envelope; no gate → a risky call is rejected.
  - **Tools:** the summary matches the computeds and `topDeals` is sorted; search filters combine, with `limit` vs `total` and an empty result; unknown and malformed IDs give helpful errors.
  - **Registration:** `/dashboard` → 3 read-only tools; `/about` → 0; back → 3.

### Session 5 — Telemetry, `withWebMcpTools()` & Batch Tools (Act 2)

**5.1** `feat(telemetry): add wire telemetry store with JSON-RPC envelopes, stats and key redaction`

- **Files:** `wire-packet.ts`, `wire-telemetry-store.ts` (§4.6), and `with-telemetry.ts`, now wired to the store.
- **Tests** (in this commit):
  - begin/end pairing and latency
  - the 500 cap
  - p50/p95
  - error rate
  - pause
  - redaction of the header, `key=` and the raw key
  - `byModel`
  - `with-telemetry`: the ok path, and an error path that rethrows

**5.2** `feat(state): add withWebMcpTools SignalStore feature and batch mutation tools`

- **Files:**
  - `with-webmcp-tools.ts` (§3.4).
  - `deal-mutation-tools.ts` with `setDealFilter`, `applyBatchDiscount` and `updateDealStages`, plus `risk-policy.ts`. Add them to `DealsStore`.
  - `history/undo-notifier.ts` (a snackbar; UNDO is wired in Session 6).
- **Acceptance:** the Chrome inspector lists 6 tools.

**5.3** `test(state): cover withWebMcpTools lifecycle, mutation tools and risk policy`

- **Scenarios:**
  - **Feature lifecycle:** tools register on init and unregister on injector destroy; the factory gets the typed store; a duplicate across two instances throws.
  - **Risk policy:** 15 % → none and 15.01 % → approval; an impact over $250k at 10 % → approval; closed-lost over $100k → approval.
  - **applyBatchDiscount:** the before/after payload; `maxItems`; with no gate, a risky call is rejected and the store is unchanged.
  - **updateDealStages:** partial `skipped`.
  - **setDealFilter:** `clear` and `visibleCount`.
  - **Snackbar:** shows the count.

### Session 6 — Human-in-the-Loop & Undo (Act 4)

**6.1** `feat(history): snapshot agent mutations and add undo panel with snackbar rollback`

- **Files:**
  - `with-snapshot.ts`, wired into `defineTool`; the mutation tools pass `snapshot: store`.
  - `agent-history-panel` ("Undo to here").
  - UNDO calls `store.undo()` and records a `human/undo` packet.
- **Tests** (in this commit):
  - **with-snapshot:** a snapshot before `run`; none for the filter tool or for rejections.
  - **Panel:** entries render; undo restores state; axe-clean.
  - **Snackbar:** UNDO restores state and records a packet.

**6.2** `feat(approvals): pause consequential tool calls behind a Material approval dialog and add terminateContract`

- **Files:**
  - `with-human-approval.ts`.
  - `approval-service.ts` (§4.3: queue, abort, packets, `pending`, `setAutoDecider`).
  - `approval-dialog` (diff table, reason, note, focus).
  - `HUMAN_APPROVAL_GATE` provided `useExisting: ApprovalService`.
  - `terminateContract`.
- **Acceptance:** calling `terminateContract` from the Chrome extension opens the dialog, so HITL covers external agents too.

**6.3** `test(approvals): cover approval gating, queueing, abort and dialog decisions`

- **Scenarios:**
  - **Middleware:** a non-risky call skips the gate; approve → run plus a snapshot; reject → `rejected_by_human`, the store is unchanged and there is no snapshot; an abort → `'aborted'`.
  - **Service:** FIFO across concurrent requests; packets with the wait time; `pending` reflects the open request; the auto-decider is used when set.
  - **Dialog** (harness): the diff rows; Approve returns the note; Reject is focused for critical requests; backdrop and Esc are disabled; axe-clean.
  - **terminateContract:** always gated.

### Session 7 — Signal Form Tool (Act 3)

**7.1** `feat(proposal): add deal proposal drawer exposed as an implicit WebMCP tool via Signal Forms`

- **Files:**
  - `provideExperimentalWebMcpForms()`.
  - `proposal-form.ts` (§4.4) and `proposals-store.ts`.
  - `proposal-drawer`: `form(…, { experimentalWebMcpTool, submission })`, `[formField]` fields with their errors, the shimmer effect, and a status banner.
  - In `dashboard-shell`: `@if (ui.proposalOpen()) { <app-proposal-drawer /> }`.
- **Acceptance:** opening the drawer adds `draftDealProposal` to the Chrome inspector, and closing it removes the tool.

**7.2** `feat(dashboard): register openProposalDrawer via withWebMcpTools and surface dynamic tool changes`

- **Files:**
  - `dashboard-ui-store.ts` with the tool.
  - `mcp/agent/mcp-tool-gateway.ts` (§4.5), including the added and removed tool diff.

**7.3** `test(proposal): cover proposal schema, form-tool lifecycle, submission rules and gateway tool discovery`

- **Scenarios:**
  - **Schema:** every field is required; email; bounds; tier values; an unknown `dealId`; the billing rule rejects `2026-12-15` and accepts `2027-01-01`; no nulls in the initial model and a non-empty array.
  - **Drawer:**
    - registering puts all fields in the schema's `required`, and destroying unregisters the tool
    - valid args fill the DOM inputs, add `data-agent-filled` and save a draft
    - invalid args return the failure paths
    - a discount of 20 → the gate
    - Starter tier with 2000 seats → a submission error
    - axe-clean
  - **openProposalDrawer:** sets the UI state.
  - **Gateway:** packets are emitted; an unknown tool → an error; `waitForTool` resolves or times out; the added/removed diff is correct.

### Session 8 — BYOK & Gemini Agent

**8.1** `feat(settings): add BYOK key vault, key validation resource, model picker and production CSP`

- **Files:**
  - `gemini-models.ts` (§4.7, `estimateCostUsd`), `genai-client.ts` (a lazy factory token), `agent-config.ts`.
  - `settings-store.ts`, `api-key-dialog`, `model-picker` (A9), and the onboarding banner.
  - `AGENT_CONFIG` provided `useFactory: () => inject(SettingsStore)`.
  - The CSP and `autoCsp` (A10).
  - `npm i -E @google/genai@3.0.0 @angular/aria@22.2.6`.
- **Tests** (in this commit):
  - **Catalog:** 3 IDs, with Operator as the default; dated prices (Argon before and after 2026-12-01); thinking billed as output; an unknown model → `undefined`.
  - **Store:** session vs. remember; forget clears both; throwing storage is safe; `keyCheck` states (using a `FakeGenAI` `models.list`); an abort when the key changes.
  - **Dialog:** an empty key is blocked; the remember checkbox; the model selection; the Argon "paid tier" badge; axe-clean.
  - **Picker:** keyboard selection through the harness.
- **Acceptance:** `@google/genai` is not in the initial chunk.

**8.2** `feat(agent): add streaming Gemini function-calling agent and agent session store`

- **Files:** `agent-events.ts`, `system-prompt.ts`, `tool-adapter.ts`, `gemini-agent.ts` (§4.5, A8), and `agent-session-store.ts` (`injectAsync` the agent; status derived from `gate.pending`).
- **Acceptance:** the agent is a separate lazy chunk.

**8.3** `test(agent): cover tool adaptation, streaming loop, thought signatures, usage telemetry and error mapping`

- **Files:** `tool-adapter.spec.ts`, `gemini-agent.spec.ts`, `agent-session-store.spec.ts`, `testing/fake-genai.ts`.
- **Scenarios:**
  - **Adapter:** passes the schema through; an empty schema gets a default.
  - **Loop:** call → gateway → response on the **same chat** (assert the history); text deltas in order; thoughts; parallel calls in order; tools refresh after `toolchange`.
  - **Limits:** max 8 steps; abort stops requests and aborts a pending approval.
  - **Usage:** usage and cost sums, including thinking; the config carries the model and `thinkingLevel`.
  - **Errors:** `auth`, `quota`, `model-access`, `network`.
  - **Redaction:** the key never appears in the packets.
  - **Session store:** loads lazily once; `run` while running is ignored; `stop`; `awaiting-approval`.

### Session 9 — Agent Console & Lab

**9.1** `feat(console): add agent console with streaming transcript, thoughts, demo prompts and presenter hotkeys`

- **Files:**
  - `agent-console` and `transcript-item`: thought and tool cards, streaming text, an approval-wait state, error cards with fixes (open the dialog, switch model), Stop, and a model badge.
  - `demo-prompts.ts`: Act 1–4 chips, each with its model.
  - Hotkeys on the App `host`: `` ` `` toggles the inspector, `1`–`4` fill a chip, and `Shift+R` resets. They are ignored while typing.
- **Tests** (in this commit):
  - **Chips and input:** a chip runs its prompt with its model; Enter sends and Shift+Enter adds a newline; the input is disabled while running; Stop.
  - **Rendering:** each event type; an `auth` error card opens the dialog; the console is disabled without a valid key.
  - **Hotkeys and a11y:** hotkeys work and are ignored while typing; axe-clean.

**9.2** `feat(lab): add agent lab with isolated runs, side-by-side model race and act eval runner`

- **Files:**
  - `isolated-run.ts`: snapshot, run, restore; a `runId` on every packet; the scripted auto-decider plus an "Eval mode" banner.
  - `model-race.ts`: only the selected models, with ⚡ and 🛠️ selected by default and 🧠 opt-in with its price and badge; a pre-run cost estimate.
  - `act-evals.ts` (§5.2): the definitions, `scoreRun`, `summarize`.
  - `lab-page`: race cards; an eval table with 5 or 10 runs per act; failures linked to the Inspector by `runId`; export to JSON and to an eval-log row.
  - `docs/eval-log.md` (header only).

**9.3** `test(lab): cover isolated runs, model race aggregation and act eval scoring`

- **Scenarios:**
  - **Isolation:** the store is identical before and after; the history is clean; scripted approvals are applied in order; an unscripted approval → reject; the decider is cleared even when the run fails; packets carry the `runId`.
  - **Race:** the defaults; Argon only when selected; catalog order; one failure doesn't stop the rest; an empty selection disables Run.
  - **Scoring:** a subsequence pass; read-only extras are tolerated, but not under `'none'`; a forbidden call, a missing mutation, a failed assertion (with its message) or an error all fail.
  - **Summary:** pass rate, p50/p90, median cost, the self-correction rate, the export row format.
  - **Page:** the race cards; Run is disabled without a key; axe-clean.

### Session 10 — Inspector, Act Acceptance & Docs

**10.1** `feat(inspector): add deferred wire inspector with packet list, tool schemas and per-model stats`

- **Files:** `wire-inspector` is a bottom drawer (`@defer (on interaction; prefetch on idle)`) with `MatTabs`:
  - **Packets:** an `ngListbox` showing channel, latency, tokens and cost.
  - **Tools:** a `resource()` on `toolsVersion` showing schemas and annotations, with new tools highlighted.
  - **Stats:** p50/p95, human wait time, `byModel`.
  - **Actions:** Pause, Clear, Copy JSON.
  - `packet-detail` and `json-view`.
- **Tests** (in this commit):
  - **Packets:** row styles; listbox keyboard navigation; a selected row shows its envelope.
  - **Tools tab:** lists the tools; highlights a new tool; refreshes on `toolchange`.
  - **Stats:** `byModel`.
  - **Controls:** Pause, Clear, Copy (clipboard spy).
  - **JSON view and a11y:** collapse and expand; axe-clean.

**10.2** `test(acts): add end-to-end act acceptance suite over real tools, agent and approval dialog`

- **Files:** `src/app/demo-acts.spec.ts`, `testing/act-scripts.ts`. The acts run sequentially on one app, as on stage.
- **Scenarios:**
  - **Act 1:** the sequence; the text cites the stalled accounts.
  - **Act 2:** filter EMEA + Negotiation; 10 % discounts; probability > 70 → closed-won; 4 call pairs; the snackbar.
  - **Act 3:** `toolchange`; the billing-rule failure, then a successful retry; the draft values.
  - **Act 4:**
    - approve (harness) → Arcadia at 25 %
    - reject → Monsoon stays active and the agent acknowledges it
    - UNDO restores Arcadia
  - **Reset:** `Shift+R` → the seed, with empty history and telemetry.
  - **Timing:** under 5 s with fake timers.

**10.3** `docs(release): add stage run-sheet and BYOK-focused README`

- **Files:**
  - `docs/demo-script.md`: the §5 arc, prompts, the expected visuals per beat, and pre-flight (the Chrome flag, the key for ⚡ and 🛠️, sign-off ≥ 9/10, tethering, Lighthouse).
  - `README.md`: pitch, quick start, BYOK and key restriction, model choice and cost (§4.7), browser support, an architecture summary, "Patterns you can reuse" (`withWebMcpTools`, `withAgentHistory`, `defineTool`), and contributing.

### 8.11 Roll-up

| #   | Theme                                     | Unlocks                    |
| --- | ----------------------------------------- | -------------------------- |
| 1   | Workspace, lint, CI, design system        | —                          |
| 2   | Domain + SignalStore + `withAgentHistory` | —                          |
| 3   | Dashboard views + route tree              | Visual baseline            |
| 4   | Registry, `defineTool`, read tools        | Act 1 tools                |
| 5   | Telemetry, `withWebMcpTools`, batch tools | Act 2 tools                |
| 6   | HITL + Undo                               | Act 4 tools                |
| 7   | Signal Form tool + discovery              | Act 3 tools                |
| 8   | BYOK + Gemini agent                       | In-app live agent          |
| 9   | Console + Lab                             | Acts 1–4 live, race, evals |
| 10  | Inspector, acceptance, docs               | Act 5, run-sheet, README   |

That is 10 sessions and 30 commits. Week 3 is reserved for tuning (§5.2) and rehearsal.

---

## 9. Risks

| Risk                                            | Mitigation                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Experimental WebMCP APIs change in a 22.x patch | Exact pins. The seams are `defineTool`, `withWebMcpTools` and `mcp/registry`. Re-verify a week before the talk |
| The Chrome flag is off on stage                 | Pre-flight and the registry chip. The polyfill keeps every act working                                         |
| The live model picks a different plan           | Sign-off ≥ 9/10; tool descriptions say _when_; Stop and `Shift+R`                                              |
| Act 3 self-correction doesn't happen            | Framed as "if it slips, watch it fix itself". The Lab measures the rate                                        |
| Slow venue network                              | Tethering, ⚡ for latency-sensitive beats, and streaming. No app fallback, by decision                         |
| Users surprised by Argon cost                   | Price shown, dated schedule, per-run cost, opt-in in the race                                                  |
| Key visible on the projector                    | Masked input, entered before the talk, redacted in telemetry                                                   |
| Duplicate tool names                            | Stores are provided once, the drawer is guarded by `@if`, and the fake registry resets in tests                |
| `inject()` after `await` in a tool              | D5 and its regression test                                                                                     |

---

## Handoff Note: Session 1 Completed

- **Exported Symbols & Contracts:**
  - `src/app/app.ts`: `App` shell. A glass `mat-toolbar` inside `<header>`, an `<h1>`, a theme toggle button, and `<main>` containing `<router-outlet />`. It injects `ThemeService` as `protected readonly theme`.
  - `src/app/app.config.ts`: `appConfig` with `provideBrowserGlobalErrorListeners()`, `provideRouter(routes, withAutoCleanupInjectors(), withComponentInputBinding())`, and `MAT_ICON_DEFAULT_OPTIONS = { fontSet: 'material-symbols-outlined' }`. Session 3 adds routes, and later sessions append providers here.
  - `src/app/app.routes.ts`: `routes: Routes = []`. Session 3 fills it.
  - `src/app/core/services/theme.ts`: `ThemeService` (`@Service()`), `type ThemeMode = 'light' | 'dark'`, `THEME_STORAGE_KEY = 'awm.theme'`. Members: `mode` (readonly signal), `isDark` (computed), `setMode(mode)` (also persists), `toggle()`. An `effect` toggles `.dark` on `document.documentElement`. Default is dark.
  - `src/app/shared/ui/glass-card/glass-card.ts`: `GlassCard` (`<app-glass-card>`) and `type GlassCardAccent = 'primary' | 'warn' | 'success'`. Inputs: `title` (default `''`, renders an `<h2>` only when non-empty) and `accent` (default `'primary'`). Content is projected.
  - `src/testing/a11y.ts`: `expectNoA11yViolations(root: Element = document.body): Promise<void>`. It runs axe-core with `color-contrast` disabled (jsdom can't compute it) and throws an `Error` listing `rule-id: help (selectors)`.
  - `src/test-setup.ts`: replaces `globalThis.fetch` with a function that **synchronously throws** `Unexpected network call: fetch is disabled in unit tests`.
  - `src/tailwind.css`: Tailwind v4 with the `theme` and `utilities` layers only. **No preflight**, so it can't fight Material.
    - `@custom-variant dark (&:where(.dark, .dark *))`.
    - `@theme inline` colors: `primary`, `on-primary`, `surface`, `on-surface`, `on-surface-variant`, `outline-variant`, `error`, `success`. They map to `--mat-sys-*` and `--app-success`, so classes like `text-on-surface` and `bg-surface` work.
    - Utilities: `glass`, `glow` (override the color with `--glow-color`), `glass-accent-primary|warn|success`.
  - `src/styles.scss`: `mat.theme` on `html` (azure primary, violet tertiary, `color-scheme` type, Inter Variable, density 0). `html { color-scheme: light }` and `html.dark { color-scheme: dark }`. Defines `--app-success`, the body gradient background, a global `:focus-visible` outline and `box-sizing`.
  - Tooling:
    - `eslint.config.mjs`: §0.4 rules, plus `no-restricted-imports` layering for `src/app/core|shared` (no `mcp` or `features`) and `src/app/mcp` (no `features` or `@angular/material`). The layering rules skip `*.spec.ts`.
    - `angular.json`: a `lint` target, and a `test` target using the Vitest runner with `setupFiles`, coverage thresholds of 60 on all four metrics, and the coverage excludes (`src/main.ts`, `src/test-setup.ts`, `src/testing/**`, specs).
    - npm scripts: `start`, `build`, `lint` (`ng lint`), `test` (`ng test --watch=false`), `test:coverage`.
    - `.npmrc` has `save-exact=true`, so plain `npm i` pins exactly.
  - Installed so far, all exact: Angular 22.2.5 (build/cli 22.2.6), `@angular/material` and `@angular/cdk` 22.2.6, `tailwindcss` and `@tailwindcss/postcss` 4.3.5, `@fontsource-variable/inter` 5.3.0, `material-symbols` 0.48.3, `typescript` 6.0.3, `vitest` and `@vitest/coverage-v8` 5.1.0, `jsdom` 31.0.0, `axe-core` 4.14.0, `prettier` 3.9.10, `angular-eslint` 22.6.0, `eslint` 10.14.0, `typescript-eslint` 8.72.1.
  - **Not installed yet:** `@ngrx/signals` (Session 2), `@angular/aria`, `@google/genai`, `@mcp-b/webmcp-polyfill` (later sessions).
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (24 tests, 100% on all four metrics) and `npm run build` all pass. The visual look (glass toolbar, gradient, fonts) was **not checked in a real browser**; only the build output and the CSS were inspected. Run `npm start` when convenient.
  - **Commit trailers:** no `Co-Authored-By` trailer. The user's memory rule and §8.0 override the harness attribution reminder. Verify with `git log -1 --format='%an <%ae>%n%(trailers)'`.
  - **`angular-eslint`** was installed with `npm i -D angular-eslint@22.6.0 eslint@10.14.0 typescript-eslint@8.72.1`, and the flat config was written by hand. `ng add` was blocked by the sandbox classifier, and the result is equivalent. `ng new` was run with `--defaults --ai-config=none --skip-install`.
  - **No inline templates, even in specs.** The `component-max-inline-declarations` rule fails on a test-host component with `template:`. Test projection with `createComponent(Cmp, { environmentInjector: TestBed.inject(EnvironmentInjector), hostElement, projectableNodes: [[document.createTextNode('x')]] })`, then `ref.setInput(...)` and `ref.changeDetectorRef.detectChanges()`. See `glass-card.spec.ts`.
  - **Zoneless timing:** use `await fixture.whenStable()` after DOM events. For root-service effects (such as `ThemeService`), call `TestBed.tick()`. Reset the global state that tests touch: `localStorage.clear()` and remove the `dark` class from `documentElement` in `afterEach`.
  - **`GlassCard.title` is a native HTML attribute name.** The host binding `'[attr.title]': 'null'` removes it, so the card doesn't show a tooltip. Keep it if you add inputs with native names.
  - **Tailwind dynamic classes:** Tailwind scans source files for full class strings, so keep class names as complete literals (as in the `ACCENT_CLASSES` map) and never build them with string concatenation. Arbitrary properties such as `[--mat-toolbar-container-background-color:transparent]` work in templates and are used to un-paint `mat-toolbar` under `.glass`.
  - **Fonts:** Inter and Material Symbols are loaded as global CSS entries in `angular.json` `styles` (from `node_modules`), and the build hashes the woff2 files into `media/`. Icons use `<mat-icon>name</mat-icon>`, and `MAT_ICON_DEFAULT_OPTIONS` selects the `material-symbols-outlined` font set, so tests that render `mat-icon` don't need extra setup. The Symbols font is about 4 MB, but it is not counted in the JS/CSS budgets.
  - **`index.html`** has `<html class="dark">` so the default theme doesn't flash. `ThemeService` takes over once it is constructed. A user who stored `light` sees a brief dark flash, because an inline script would break the planned CSP.
  - **`app.ts`** keeps `title` as a plain `protected readonly` string, not a signal, because it is a constant.
  - **Prettier:** `.prettierrc` has `printWidth: 100` and `singleQuote`. `.github/workflows/ci.yml` uses block YAML, since Prettier can't parse the blueprint's flow-style `${{ }}` snippet.
  - **Blueprint deviation (non-functional):** to keep each commit green under the 60% gate, commit 1.2 shipped small smoke tests for `ThemeService` (via the `App` toggle test) and `GlassCard`. Commit 1.3 expanded them into the full scenarios.
  - `npm audit` reports advisories on dev dependencies at install time. Nothing was changed, since the pins are mandated by §0.1. Revisit near release.
- **Ready for Session 2:**
  - **Domain & SignalStore.** It covers 2.1 (deal model, deterministic seed, money utilities, `compact-currency` pipe, `stage-badge`, `npm i -E @ngrx/signals@22.0.1`), 2.2 (`withDeals`, `withAgentHistory` and the A7 spike) and 2.3 (the store tests).

## Handoff Note: Session 2 Completed

- **Exported Symbols & Contracts:**
  - `src/app/core/models/deal.ts`:
    - Types: `Deal`, `DealFilter`, `DealStage`, `Region`, `ContractStatus`.
    - Constants: `DEAL_STAGES` and `REGIONS` (ordered `as const` arrays), `DEAL_STAGE_LABELS`, `EMPTY_FILTER`, `MAX_DISCOUNT_PCT` (50), `STALLED_AFTER_DAYS` (21), `AT_RISK_PROBABILITY` (25).
    - Predicates: `isClosedStage(stage)`, `isOpen(deal)`, `isStalled(deal)` (open and idle ≥ 21 days), `isAtRisk(deal)` (open and (stalled or probability < 25)).
  - `src/app/core/models/mutation-result.ts`: `Change<T> {id, before, after}`, `Skip {id, why}`, `MutationResult<T> {changed, skipped}`.
  - `src/app/core/data/seed-deals.ts`: `SEED_DEALS` (readonly, `D-1001…D-1024`) and `createSeedDeals()` (fresh mutable copies). Anchors:
    - Arcadia Bank is `D-1002`, NA, negotiation, $420k, 0 %.
    - Konkan Freight is `D-1001` and Monsoon Retail is `D-1003`, both closed-won with an active contract.
    - The EMEA negotiation deals are `D-1004` (82 %), `D-1005` (76 %), `D-1006` and `D-1007`. A 10 % discount on all four is about $140k, which is under the $250k approval threshold.
    - The stalled deals are `D-1018`, `D-1019`, `D-1020` and `D-1021`.
    - Konkan's contact is `procurement@konkan-freight.example`.
  - `src/app/core/util/money.ts`: `roundMoney` (to cents), `netValue({listValue, discountPct})`, `formatCompactCurrency` (`$420k`, `$1.4M`, `$2.5B`, negative-safe).
  - `src/app/core/util/clock.ts`: `CLOCK` (`InjectionToken<() => Date>`, root-provided, defaults to `new Date()`), `type Clock`. Override it in tests with `{ provide: CLOCK, useValue: () => new Date(...) }`.
  - `src/app/core/store-features/with-agent-history.ts`: `withAgentHistory({ capacity })`.
    - State: `history: HistoryEntry[]` (`{id, label, at, snapshot}`).
    - Computed: `canUndo`, `lastEntry` (`null` when empty).
    - Methods: `recordSnapshot(label): string` (returns the entry id), `undo(): HistoryEntry | null`, `undoTo(id): HistoryEntry | null`, `clearHistory()`.
    - Also exports `HistoryEntry`, `AgentHistoryState`, `AgentHistoryOptions`.
  - `src/app/features/dashboard/data/deal-analytics.ts`: pure functions.
    - `applyFilter`, `searchDeals`, `byStage`, `byRegion`, `computeKpis`, `matchesQuery`.
    - Types `Breakdown<K> {key, count, netValue, pct}` and `Kpis {openDeals, openValue, weightedForecast, wonValue, winRate, stalledCount}`.
    - Types `DealSearch` and `DealSearchResult {total, deals}`, plus `DEFAULT_SEARCH_LIMIT` (25).
  - `src/app/features/dashboard/data/with-deals.ts`: `withDeals()` and `clampDiscount`. Also exports `StageUpdate {dealId, stage}`.
    - Entities plus `filter` state.
    - Computed: `filteredDeals`, `pipelineByStage`, `byRegion`, `kpis`, `atRiskDeals`.
    - Methods:
      - `setFilter(partial)`: merges into the current filter.
      - `clearFilter()`.
      - `search(criteria)`: ignores the view filter. It sorts by net value descending and then id, and caps at `limit` (default 25).
      - `applyDiscount(ids, pct): MutationResult<number>`.
      - `moveStages(updates): MutationResult<DealStage>`.
      - `terminateContract(id): MutationResult<ContractStatus>`.
      - `reset()`.
  - `src/app/features/dashboard/data/deals-store.ts`: `DealsStore = signalStore(withDeals(), withAgentHistory({ capacity: 20 }), withHooks({ onInit: reset }))`. It is **not** `providedIn: 'root'`, so the dashboard route must list it in `providers` (D12). Session 5 adds `withFeature((store) => withWebMcpTools(() => dealMutationTools(store)))`.
  - `src/app/shared/pipes/compact-currency.ts`: `CompactCurrencyPipe` (`compactCurrency`). It returns `''` for null or undefined.
  - `src/app/shared/ui/stage-badge/stage-badge.ts`: `StageBadge` (`<app-stage-badge [stage]="…" />`). It has a required `stage` input and sets `data-stage` on the host.
  - `src/testing/deal-fixtures.ts`: `makeDeal(overrides)` builds a valid `Deal` with the id `D-2001`.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (138 tests; lines 100 %, branches 98 %, functions 100 %) and `npm run build` all pass. The `@ngrx/signals@22.0.1` pin is installed.
  - **A7 verified:** `inject()` works inside both `withHooks(() => …)` factories and `withFeature(() => …)` factories (spike tests in `deals-store.spec.ts`). The `withMethods` factory also runs in an injection context, and `withAgentHistory` uses `inject(CLOCK)` there. No `Injector`-through-`withProps` fallback is needed.
  - **Undo restores all state, not only the entities.** The snapshot is `structuredClone(getState(store))` without `history`, so it includes `filter`. Undoing after a filter change reverts the filter to its value at snapshot time. Session 6's undo UI should expect this.
  - **Mutation semantics:**
    - A no-op discount (same value) goes to `skipped` with `already at N%`. Only actual changes appear in `changed`, so `revenueImpact` can be computed from `changed` alone.
    - Closing a deal as `closed-won` sets `probability` to 100 and `contractStatus` to `'active'`. `closed-lost` sets `probability` to 0.
    - Discounts are allowed on closed deals. The blueprint didn't forbid it, and a guard could break Act 2 if the model orders its calls differently.
    - `terminateContract` doesn't record a timestamp. The tool should use `CLOCK` for `terminatedAt`.
    - `moveStages` keeps the `skipped.why` strings `unknown deal`, `closed deals cannot be reopened` and `already in <stage>`.
  - **`winRate` is a percentage** (60, not 0.6), rounded to one decimal. `pct` in breakdowns is the share of **net value** (not deal count), rounded to one decimal, so the bars react to discounts.
  - **Testing the store:**
    - Provide the store with `TestBed.configureTestingModule({ providers: [DealsStore] })` and call `TestBed.inject`.
    - To seed arbitrary data, use `patchState(unprotected(store), setAllEntities<Deal>([...]))` with `unprotected` from `@ngrx/signals/testing`. Pass the `<Deal>` generic, because `setAllEntities([])` otherwise infers `never`.
    - `updateEntity` also needs an explicit `<Deal>` generic inside `patchState`.
  - **Layering:** `shared` imports types and utilities from `core` (`stage-badge`, `compact-currency`). The lint rule only blocks `mcp` and `features`, and the badge needs `DealStage`.
  - **Typing:** `target` is ES2022, so `findLastIndex` and other ES2023 array methods aren't in the lib.
  - **a11y in specs:** axe's `region` rule fires on a bare element in `document.body`. Wrap the rendered component in a `<main>` (see `stage-badge.spec.ts`).
  - **Seed file formatting:** Prettier expands each seed tuple over several lines, so `seed-deals.ts` is long but is the formatter's output.
  - **Blueprint deviation (non-functional):** to keep commit 2.2 above the coverage gate, it shipped smoke specs (`with-deals.spec.ts`, `deals-store.spec.ts`). Commit 2.3 replaced them with the full scenarios and added `with-agent-history.spec.ts` against a minimal store. I also added `core/models/mutation-result.ts` and `features/dashboard/data/deal-analytics.ts` (pure helpers), which the blueprint doesn't list.
- **Ready for Session 3:**
  - **Dashboard Views.** It starts with 3.1: `feat(dashboard): add route shell, KPI strip and Material deals table with debounced search`. Fill `app.routes.ts` and provide `DealsStore` in the `/dashboard` route `providers`.

## Handoff Note: Session 3 Completed

- **Exported Symbols & Contracts:**
  - `src/app/app.routes.ts`: `routes`.
    - `''` redirects to `dashboard`. `**` redirects to `dashboard`.
    - `dashboard` has `providers: [DealsStore, DashboardUiStore]`, lazy `DashboardShell`, and children `''` (`DashboardPage`) and `lab` (`LabPage`).
    - `about` is lazy `AboutPage`, outside the dashboard injector (D12).
    - **`ProposalsStore` is not in the providers yet.** It doesn't exist until Session 7, so add it there. Session 4 adds `provideExperimentalWebMcpTools(...)` to the same `dashboard` `providers` array.
  - `src/app/app.ts` / `app.html`: the toolbar has a `<nav aria-label="Primary">` with Dashboard and About links. Active state comes from `isActive()` signals (`dashboardActive` with `subset`, `aboutActive` with `exact`) and sets `aria-current="page"`. Session 4's registry chip goes into this toolbar.
  - `src/app/features/layout/layout-store.ts`: `LayoutStore` (`providedIn: 'root'`) with `consoleOpen`, `inspectorOpen`, `toggleConsole()`, `toggleInspector()`. Nothing consumes it yet (Session 9 and 10).
  - `src/app/features/dashboard/data/dashboard-ui-store.ts`: `DashboardUiStore`. It is route-scoped and injects `DealsStore`.
    - State: `proposalOpen`.
    - Linked state: `selectedDealId: string | null`, a `linkedSignal` over `DealsStore.filteredDeals`. It resets to `null` when the selected deal leaves the filtered list and is kept otherwise.
    - Methods: `selectDeal(id | null)`, `openProposal()`, `closeProposal()`. Session 7's `openProposalDrawer` tool should call `openProposal()`.
  - `src/app/features/dashboard/dashboard-shell.ts`: `DashboardShell` has an Overview/Lab sub-nav (`isActive`, with `exact` for overview) and a `<router-outlet />`.
  - `src/app/features/dashboard/dashboard-page.ts`: `DashboardPage` stacks `<app-metrics-strip />`, `<app-pipeline-chart />` and `<app-deals-table />`. Session 7 will add the proposal drawer here, inside `@if (ui.proposalOpen())`.
  - `src/app/features/dashboard/metrics-strip/metrics-strip.ts`: `MetricsStrip`. Five `StatTile`s from `store.kpis()` in an `aria-live="polite"` section.
  - `src/app/features/dashboard/pipeline-chart/pipeline-chart.ts`: `PipelineChart` and `StageBar {key, label, fill, x, width, count, netValue, pct}`.
    - It draws one `<rect data-stage="…">` per stage, with `x` and `width` as SVG **attributes** in a `0 0 100 10` viewBox. Width equals the stage's `pct`.
    - It is `role="img"` with a computed `aria-label`, has a legend, a region mini-row (`ul[aria-label="Net value by region"]`), and an sr-only `table` that mirrors the bars.
    - It shows an empty state, with no svg, when every `netValue` is 0.
  - `src/app/features/dashboard/deals-table/deals-table.ts`: `DealsTable`, `FLASH_DURATION_MS` (2000), `SEARCH_DEBOUNCE_MS` (250).
    - It uses `MatTable`, `MatSort` and `[trackBy]` by deal id. Rows carry `data-deal-id`, `row-flash` (changed in the last 2 s), `row-selected` and `aria-current`. A row click or Enter calls `ui.selectDeal`.
    - The search box is a Signal Form: `form(linkedSignal(() => ({ query: store.filter().query })))` bound with `[formField]`. `debounced(…, 250)` feeds `store.setFilter({ query })` through an `effect`. A query set elsewhere (for example by the agent's `setDealFilter`) flows into the input through the `linkedSignal`.
    - The chips are removable and show only the active `stages`, `regions` and `minValue`. There is a "Clear filters" button.
  - `src/app/features/dashboard/deals-table/sort-deals.ts`: `sortDeals(deals, sort)`. It sorts by net value (not list value) and by stage order, breaks ties by id, and doesn't mutate its input.
  - `src/app/features/lab/lab-page.ts` is a placeholder. `src/app/features/about/about-page.ts` is final copy.
  - `src/app/shared/ui/stat-tile/stat-tile.ts`: `StatTile` (`<app-stat-tile label value hint accent />`) wraps `GlassCard`.
  - `src/tailwind.css` new utilities:
    - `row-flash` (2 s keyframes, with a static tint under `prefers-reduced-motion`)
    - `row-selected`
    - `chart-rect` (transitions `x` and `width`)
    - `chart-bar` (transitions `width`)
    - Both transitions are disabled under reduced motion.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (183 tests; statements 97.4 %, branches 99.1 %, functions 94.3 %, lines 97.0 %) and `npm run build` all pass on each of the 3 commits. The visual look (chart, flash, glass table) was **not checked in a real browser**, so run `npm start` when convenient. `main` is about 223 kB raw and the lazy `dashboard-page` chunk is about 245 kB (mostly Material table, sort, chips and form-field).
  - **No trailers**, as before. Verified with `git log -1 --format='%an <%ae>%n%(trailers)'`.
  - **Fake timers and `whenStable()`:** `debounced()` registers a pending task while its timer runs, so `fixture.whenStable()` never resolves under `vi.useFakeTimers()` until the timer is advanced. In `deals-table.spec.ts`, `setup(true)` calls `fixture.detectChanges()` and then `vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)` before `whenStable()`. After that, `fixture.detectChanges()` is enough inside fake-timer tests.
  - **Harnesses:** Material harnesses are at `@angular/material/{table,sort,chips}/testing` and `TestbedHarnessEnvironment` is at `@angular/cdk/testing/testbed`. Both work zoneless. Typing into the search box in tests means setting `input.value` and dispatching a plain `new Event('input')`.
  - **Route-scoped store tests:** `RouterTestingHarness` gives `harness.routeDebugElement.injector.get(DealsStore)`. To prove destruction, `dashboard-routes.spec.ts` copies `routes` and appends `provideEnvironmentInitializer(() => inject(DestroyRef).onDestroy(spy))` to the `dashboard` route's `providers`. This needs `withAutoCleanupInjectors()` in the test's `provideRouter`. The `/dashboard/lab` hop does not destroy the injector, but `/about` does.
  - **Tailwind class bindings:** `[class.bg-primary/10]` isn't a safe class-binding name, so use a named utility (`row-selected`). For active and idle link colors, bind both sides explicitly (`[class.text-primary]="x()"` and `[class.text-on-surface-variant]="!x()"`) instead of stacking two color utilities.
  - **SVG:** the bars use the `x` and `width` attributes plus a CSS `transition`, because jsdom's CSSStyleDeclaration ignores SVG geometry properties and tests need to read the values. Chrome transitions presentation-attribute changes.
  - **Row flash:** an `effect` diffs `store.entities()` field-by-field against the previous snapshot. So `undo()` (which `structuredClone`s every entity) and `reset()` don't flash all 24 rows, and only truly changed rows flash. The first run flashes nothing.
  - **Filter chips are removal-only.** A human can't add a stage or region filter from the UI yet. Filters come from the agent's `setDealFilter` (Session 5) and are removed here. Add toggle chips if a manual filter bar is wanted.
  - **`isActive()`** takes `(url, router, matchOptions)`. Its defaults are `paths: 'subset'` and `queryParams: 'subset'`, and I always pass `queryParams: 'ignored'`.
  - **`ProposalsStore`** from the blueprint's route providers is deferred to Session 7, where its file doesn't exist yet.
  - **Blueprint deviation (non-functional):** commits 3.1 and 3.2 each shipped working specs for the pieces they introduced, so they stay above the coverage gate. Commit 3.3 added the cross-cutting scenarios (chart proportions and reactivity, sr-only table sync, EMEA filter, route sharing and destruction, axe on the full app at `/dashboard`).
- **Ready for Session 4:**
  - **WebMCP Platform & Read Tools (Act 1).** It starts with 4.1: `feat(mcp): add registry bootstrap, polyfill fallback and JSON-schema argument validator`, which also needs `npm i -E @mcp-b/webmcp-polyfill@6.0.3`. Then 4.2 adds `defineTool` and the read tools to the `dashboard` route `providers`, and 4.3 tests them.

## Handoff Note: Session 4 Completed

- **Exported Symbols & Contracts:**
  - `src/app/mcp/registry/model-context.ts`:
    - Types: `RegistryKind` (`'native' | 'polyfill' | 'shim'`), `ModelContextRegistry` (`registerTool(tool, { signal })`, `getTools()`, `executeTool(name, args, { signal })`, plus `EventTarget` for `toolchange`), `RegistryTool`, `RegistryToolInfo`, `RegistryToolClient`.
    - `findModelContext(doc?)`: `document.modelContext ?? navigator.modelContext ?? null`. It swallows a throwing getter, which the polyfill can leave behind.
  - `src/app/mcp/registry/ensure-model-context.ts`: `ensureModelContext(doc?): Promise<RegistryKind>`. It tries native, then a dynamic `import('@mcp-b/webmcp-polyfill')` and `installWebMCP()`, then `RegistryShim`.
  - `src/app/mcp/registry/registry-shim.ts`: `RegistryShim` (an `EventTarget` registry). It sorts `getTools()`, throws `Tool already registered: <name>` on a duplicate, unregisters on abort and fires `toolchange` on every change. `tools` is `protected`.
  - `src/app/mcp/registry/registry-kind.ts`: `REGISTRY_KIND` (`InjectionToken<RegistryKind>`, default factory `'shim'`). `main.ts` provides the real value through `mergeApplicationConfig`. The toolbar chip in `app.html` shows it as `WebMCP: <kind>` (`data-testid="registry-chip"`, `data-kind`).
  - `src/app/mcp/schema/validate-args.ts`: `validateArgs(schema, value): ValidationIssue[]`, `formatIssues`, `JsonSchema`, `ValidationIssue {path, message}`. It supports type, required, `additionalProperties: false`, enum, minimum/maximum, minLength/maxLength, pattern, items, minItems/maxItems. Paths look like `updates[1].stage`, and a root-level issue has the path `''`.
  - `src/app/mcp/tooling/tool-errors.ts`: `ToolInputError(message, issues)` and `ToolInputError.fromIssues(toolName, issues)`. Its message is `Invalid input for <tool>: <path>: <msg>; …`.
  - `src/app/mcp/tooling/approval-gate.ts`: `HUMAN_APPROVAL_GATE` (an `InjectionToken` with **no default**), `HumanApprovalGate {pending, request(req, signal)}`, `ApprovalRequest {toolName, risk: 'high'|'critical', summary, reason?, details?}`, `ApprovalDecision {approved, note?}`, `ApprovalRisk`. Session 6 implements it in `ApprovalService` and may extend `ApprovalRequest`.
  - `src/app/mcp/tooling/with-telemetry.ts`: `TOOL_TELEMETRY` (`InjectionToken<ToolTelemetry>`, default is a no-op), `ToolTelemetry.begin(toolName, args): ToolSpan`, `ToolSpan.end(status: 'ok'|'error'|'rejected', { latencyMs, error? })`. **Session 5 should provide a real implementation backed by `WireTelemetryStore`** (for example `{ provide: TOOL_TELEMETRY, useExisting: … }`).
  - `src/app/mcp/tooling/with-validation.ts`: `validateToolArgs(toolName, schema, args)` throws `ToolInputError`. `undefined` or `null` args are validated as `{}`.
  - `src/app/mcp/tooling/define-tool.ts`: `defineTool<A, D>(def): WebMcpToolDescriptor`, `ToolDefinition`, `ToolContext {signal, now()}`, `ToolResult`, `toToolResult(value)`.
    - Fields: `name`, `title?`, `description`, `inputSchema`, `annotations?`, `deps?: () => D`, `risk?: (args) => ApprovalRequest | null`, `snapshot?: (args) => void`, `run(args, ctx, deps)`.
    - Order: telemetry span, validation, approval (if `risk` returns a request), snapshot, `run`.
    - Rejection, from the human or from a missing gate, returns `{ status: 'rejected_by_human', note? }` as a normal result and closes the span as `rejected`. Errors rethrow and close the span as `error`.
    - Latency is measured with `CLOCK`.
  - `src/app/features/dashboard/tools/deal-context-tools.ts`: `DEAL_CONTEXT_TOOLS` (`getPipelineSummary`, `searchDeals`, `getDealDetails`), `DealRow`, `toDealRow(deal)`. The tools are wired in `app.routes.ts` as `provideExperimentalWebMcpTools(DEAL_CONTEXT_TOOLS)` in the `dashboard` route `providers`.
  - `src/testing/fake-model-context.ts`: `FakeModelContext` (a `RegistryShim` plus `toolNames()` and `reset()`), `installFakeModelContext()`, `uninstallFakeModelContext()`.
  - `src/testing/test-providers.ts`: `useFakeModelContext()` registers `beforeEach` and `afterEach` hooks and returns `{ current }`. `provideRegistryKind(kind)` is a provider helper.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (263 tests; statements 98.2 %, branches 98.6 %, functions 95.6 %, lines 98.0 %) and `npm run build` all pass on each of the 3 commits. `main` is about 427 kB raw before compression.
  - **Not verified in a real browser:** the 4.2 acceptance ("Chrome Tool Inspector lists 3 tools, and they vanish on `/about`") was not run. The same behaviour is covered by `context-tools-registration.spec.ts` against the fake registry. Run `npm start` with `chrome://flags/#enable-webmcp-testing` when convenient.
  - **Install permission:** `npm i -E @mcp-b/webmcp-polyfill@6.0.3` was blocked twice by the auto-mode classifier, and the user ran it manually. Later sessions that need new packages (`@angular/aria`, `@google/genai`) may hit the same block.
  - **A6 verified:** the polyfill exposes `installWebMCP()`. It does **nothing outside a secure context** (`globalThis.isSecureContext`) and throws a `TypeError` if the realm is frozen. A venue served over plain `http://` on a non-localhost host therefore ends up on the `shim`, and the chip says so. The shim works for the in-app agent, but external agents such as the Chrome Tool Inspector won't see it.
  - **Types:** the polyfill's `webmcp-types` augments `Document.modelContext`, so casting a `Document` straight to a holder type fails with TS2352. Cast through `unknown`, as `findModelContext` does. `WebMcpToolDescriptor` (the `ToolDescriptor` alias) is exported from `@angular/core`, and `execute` there takes `(args, client)`.
  - **Mocking the polyfill in specs:** use `vi.hoisted` plus `vi.mock('@mcp-b/webmcp-polyfill', () => ({ installWebMCP }))` (see `ensure-model-context.spec.ts`). Clear `document.modelContext` with `delete` between tests.
  - **D5 in practice:** `execute` is an `async` arrow, so everything before its first `await` still runs in the injection context. `inject(TOOL_TELEMETRY)`, `inject(HUMAN_APPROVAL_GATE, { optional: true })`, `inject(CLOCK)` and `def.deps()` all run there. A tool body that needs the store declares `deps: () => inject(DealsStore)` and receives it as `run`'s third argument. **Never call `inject()` inside `run`**. The spec "fails with NG0203" proves this.
  - **Testing a tool through `defineTool`:** `runInInjectionContext(TestBed.inject(EnvironmentInjector), () => tool.execute(args, client))`. To test registration, use `provideExperimentalWebMcpTools(...)` in `TestBed` providers and call `registry.executeTool(name, args)` on the fake. A `TestBed` teardown destroys the injector, which aborts the registration signals.
  - **Route tests:** after navigating away from `/dashboard`, call `TestBed.tick()` before asserting that the tools are gone. `provideRouter(routes, withAutoCleanupInjectors())` is required.
  - **Tool output shapes:**
    - `getPipelineSummary.topDeals` holds the 5 largest **open** deals by net value, as `DealRow`s.
    - `searchDeals` calls `store.search`, which ignores the table filter. `total` is the full match count.
    - An unknown `getDealDetails` ID throws `ToolInputError` with the message `Unknown deal <id>. Use searchDeals to find valid deal IDs.`
  - **Annotations:** the three read tools set `readOnlyHint`, and `getDealDetails` also sets `untrustedContentHint`.
  - **Descriptions are first-draft** and will be tuned through the Lab (§5.2). `searchDeals` already points to `setDealFilter` for view changes, but that tool doesn't exist until Session 5.
  - **`ProposalsStore`** is still not in the `dashboard` providers (Session 7).
  - **Blueprint deviations (non-functional):**
    - `ApprovalRequest`, `HumanApprovalGate` and `HUMAN_APPROVAL_GATE` shipped in `approval-gate.ts` now (the blueprint calls it "the token"), because `defineTool` needs them.
    - `with-human-approval.ts` and `with-snapshot.ts` from the §2 tree are folded into `define-tool.ts`.
    - `registry-shim.ts`, `registry-kind.ts` and `tool-errors.spec.ts` are additions.
    - The registry chip and `app.spec.ts` chip test went into 4.1.
    - Commit 4.2 had no new specs of its own (the gate held at about 89 % coverage), and 4.3 added all of them.
- **Ready for Session 5:**
  - **Telemetry, `withWebMcpTools()` & Batch Tools (Act 2).** It starts with 5.1: `feat(telemetry): add wire telemetry store with JSON-RPC envelopes, stats and key redaction`. Wire `TOOL_TELEMETRY` to the new store there.

## Handoff Note: Session 5 Completed

- **Exported Symbols & Contracts:**
  - `src/app/mcp/telemetry/wire-packet.ts`:
    - Types: `WirePacket`, `WireChannel`, `WireMethod`, `WireStatus`, `TokenUsage`, `WireEnvelope {request, response?}`, `JsonRpcRequest`, `JsonRpcResponse`. `envelope` is typed as `WireEnvelope`, not `unknown`.
    - `redactSecrets(value, secrets?)`: a deep copy that masks the `x-goog-api-key` header (any casing), `key=<value>` anywhere in a string, and each raw secret of at least 8 characters.
    - Also exports `REDACTED` (`•••`), `MIN_SECRET_LENGTH` and `byteLength(value)` (UTF-8 bytes of the JSON).
  - `src/app/mcp/telemetry/wire-telemetry-store.ts`: `WireTelemetryStore` (`providedIn: 'root'`, `withEntities<WirePacket>`).
    - State: `paused`.
    - Computed:
      - `stats`: `{total, pending, calls, errors, rejected, errorRate, p50, p95, totalBytes}`. Latency and error rate cover only **settled `mcp` `tools/call`** packets, and `rejected` counts as settled but not as an error.
      - `byModel`: `ModelStats[]` (`{model, calls, tokens, costUsd, avgLatencyMs}`) for settled `llm` packets that have a model, sorted by model name.
    - Methods:
      - `begin(start: PacketStart): number` returns the packet id, or `0` when paused.
      - `end(id, outcome: PacketOutcome)` is a no-op for an unknown or already settled id. If `latencyMs` is omitted it is `clock() - at`.
      - `record(start, outcome): number`
      - `pause()`, `resume()`, `clear()` (ids keep increasing)
      - `exportJson()`
    - Also exports `WIRE_SECRETS`, `MAX_PACKETS` (500), `percentile` (nearest-rank), `INTERNAL_ERROR_CODE` (-32603), and the types `PacketStart`, `PacketOutcome`, `WireStats` and `ModelStats`.
    - The request carries `id` equal to the packet id, except `notifications/*`, which have none. An `error` outcome becomes a JSON-RPC `error` object, and any other outcome becomes `result` (null if absent).
  - `src/app/mcp/telemetry/wire-telemetry-store.ts` `WIRE_SECRETS`: `InjectionToken<() => readonly string[]>` with a default of `() => []`. **Session 8's `SettingsStore` should provide the live key here**, for example `{ provide: WIRE_SECRETS, useFactory: () => { const s = inject(SettingsStore); return () => [s.apiKey()]; } }`.
  - `src/app/mcp/tooling/with-telemetry.ts`:
    - `TOOL_TELEMETRY` is now `providedIn: 'root'` and its default factory is `createStoreTelemetry(inject(WireTelemetryStore))`, so **no extra provider is needed**.
    - `createStoreTelemetry(store)` opens a `mcp` `tools/call` packet with `params: {name, arguments}`.
    - `ToolSpanResult` gained `result?: unknown`.
  - `src/app/mcp/tooling/define-tool.ts`: it now passes `{result}` (the raw value, not the MCP wrapper) to `span.end` on ok and on rejection (`{status: 'rejected_by_human', note?}`), and `{error}` on failure.
  - `src/app/mcp/store-features/with-webmcp-tools.ts`: `withWebMcpTools(tools: () => readonly WebMcpToolDescriptor[])`.
    - It registers each tool in `onInit` through `declareExperimentalWebMcpTool(tool, inject(Injector))`.
    - The tools unregister when the store's injector is destroyed.
    - A rejected registration goes to `ErrorHandler.handleError`.
  - `src/app/features/dashboard/tools/risk-policy.ts`:
    - Constants: `DISCOUNT_APPROVAL_PCT` (15), `IMPACT_APPROVAL_USD` (250_000), `CLOSED_LOST_APPROVAL_USD` (100_000).
    - Functions: `discountImpact(listValue, before, after)`, `assessDiscount(deals, pct): {changes, revenueImpact, flags}` and `assessStageMoves(entityMap, moves): {flaggedDeals, flags}`.
    - Rules (all strict `>`):
      - the discount is above 15 %
      - the revenue **loss** is above $250k (a reduction in discount never counts)
      - an **open** deal with net value above $100k moves to closed-lost
  - `src/app/features/dashboard/tools/deal-mutation-tools.ts`: `dealMutationTools(store: DealMutationStore): WebMcpToolDescriptor[]` returns `setDealFilter`, `applyBatchDiscount` and `updateDealStages`.
    - `DealMutationStore` is a structural interface, which avoids an import cycle with `DealsStore`.
    - **Session 6 adds `terminateContract` here** and needs `terminateContract` on that interface.
    - Output shapes:
      - `setDealFilter` returns `{applied: DealFilter (the resulting filter), visibleCount}`.
      - `applyBatchDiscount` returns `{status, changed[{id,before,after}], skipped[{id,why}], revenueImpact}`. `revenueImpact` is negative for a loss.
      - `updateDealStages` returns `{status, moved[{id,before,after}], skipped[{id,why}]}`.
      - `status` is `applied` (nothing skipped), `partial`, or `no_change`.
  - `src/app/features/history/undo-notifier.ts`: `UndoNotifier` (`@Service()`) with `announce(message, onUndo?)` and `UNDO_NOTICE_MS` (8000).
    - It uses `MatSnackBar`, and the action is `Dismiss`, or `Undo` when `onUndo` is given.
    - **Session 6 should pass `() => store.undo()` from the tools**, and `run` already has the notifier as its `deps`.
  - `src/app/features/dashboard/data/deals-store.ts`: `DealsStore = signalStore(withDeals(), withAgentHistory({capacity: 20}), withHooks({onInit: reset}), withFeature((store) => withWebMcpTools(() => dealMutationTools(store))))`. The dashboard route now exposes **6 tools**: 3 read tools plus `setDealFilter`, `applyBatchDiscount` and `updateDealStages`.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (336 tests; statements 98.6 %, branches 98.2 %, functions 96.7 %, lines 98.5 %) and `npm run build` all pass on each of the 3 commits.
  - **Not verified in a real browser:** the 5.2 acceptance ("Chrome inspector lists 6 tools") was not run. The route spec `context-tools-registration.spec.ts` asserts the 6 names against the fake registry. Run `npm start` with `chrome://flags/#enable-webmcp-testing` when convenient.
  - **No trailers**, as before (the user's memory rule and §8.0 override the harness attribution reminder). Verified with `git log -1 --format='%an <%ae>%n%(trailers)'`.
  - **Duplicate registration does not throw.** `declareExperimentalWebMcpTool` is `async`, so a duplicate surfaces as a rejected promise. `withWebMcpTools` routes it to `ErrorHandler.handleError`, and the spec asserts that and that the first registration survives.
  - **Seed gotcha for tests and the demo script:** `D-1006` (Iberia Telecom) already has a 10 % discount. Setting 10 % on the four EMEA negotiation deals changes only `D-1004` (5→10), `D-1005` and `D-1007`; `D-1006` is skipped as `already at 10%`, and the status is `partial` with `revenueImpact` -$77k. Session 2's note says "about $140k" for a 10 % discount on all four. That is the list-value arithmetic and ignores the existing discounts. Act 2's expected output should account for this.
  - **A snapshot is recorded after approval and before `run`**, even if `run` then changes nothing (for example all deals already at that discount). The history can therefore contain a no-op entry, and a rejected call never records one. If this is annoying in Session 6's history panel, skip the snapshot when no deal would change.
  - **Testing tools:**
    - Provide `DealsStore` in `TestBed` with `useFakeModelContext()`, and call `registry.current.executeTool(name, args)`. The store registers its own tools on creation.
    - Provide `{ provide: MatSnackBar, useValue: { open } }` to assert the snackbar text.
    - For the gate, provide `{ provide: HUMAN_APPROVAL_GATE, useValue: { pending: signal(null), request } }`. With no provider, risky calls come back as `rejected_by_human`.
    - A store that is not `providedIn: 'root'` must be listed in `providers`, otherwise `TestBed.inject` throws NG0201.
    - To test destruction, use `createEnvironmentInjector([Store], TestBed.inject(EnvironmentInjector))` and call `.destroy()` on it.
  - **Existing specs changed:** `context-tools-registration.spec.ts` now expects 6 names and `NAMES.length` `toolchange` events per mount. `deal-context-tools.spec.ts` filters the registry down to the three read tools, because it now shares the registry with the store's mutation tools.
  - **Telemetry shape for the inspector (Session 10):** the response lives in `packet.envelope.response`. A tool packet has no model or tokens. `hitl/*` packets, when Session 6 records them, should use channel `hitl` so they stay out of `stats`.
  - **No double counting yet:** tool-side spans already record `tools/call` for every caller, including the in-app agent. In Session 8, `McpToolGateway` should record only `tools/list` and `notifications/tools/list_changed` itself, or correlate its own packet with the tool-side one, so that `stats.calls` isn't doubled.
  - **Blueprint deviations (non-functional):**
    - The "with-telemetry error path that rethrows" scenario is tested through `defineTool`, because the span logic stays inline in `define-tool.ts` and `with-telemetry.ts` holds the token and the store adapter.
    - Added `risk-policy.spec.ts`, `wire-packet.spec.ts` and `undo-notifier.spec.ts`.
    - Commits 5.1 and 5.2 each had a green gate. 5.2 added no specs of its own beyond updating the two registration specs, and 5.3 added all the new scenarios.
- **Ready for Session 6:**
  - **Human-in-the-Loop & Undo (Act 4).** It starts with 6.1 in the Session 6 block of this file. `HUMAN_APPROVAL_GATE` is still unprovided, so every risky call is rejected until `ApprovalService` is added and provided in the `dashboard` route.

## Handoff Note: Session 6 Completed

- **Exported Symbols & Contracts:**
  - `src/app/mcp/tooling/with-snapshot.ts`: `Snapshotter {recordSnapshot(label): string}`, `SnapshotPlan<A> {target, label}` and `takeSnapshot(plan, args): string`.
  - `src/app/mcp/tooling/define-tool.ts` (changed):
    - `snapshot?: Snapshotter` (pass the store) plus `snapshotLabel?: (args) => string`. The label falls back to `title`, then `name`.
    - `ToolContext` gained `snapshotId?: string`, set after approval and before `run`.
    - The approval step now calls `requireApproval`.
  - `src/app/mcp/tooling/with-human-approval.ts`: `requireApproval(gate | null, request, signal): Promise<Rejection | null>`, `Rejection`, `NO_GATE_NOTE`.
  - `src/app/mcp/tooling/approval-gate.ts` (extended): `ApprovalRequest` gained `policy?: string[]` and `diff?: ApprovalDiffRow[]`. `ApprovalDiffRow` is `{label, field, before, after, note?}` and the dialog renders it. `details` stays as raw data for the inspector.
  - `src/app/features/approvals/approval-service.ts`: `ApprovalService` (`@Service()`, root) implements `HumanApprovalGate`.
    - Signals: `pending` (the request whose dialog is open) and `queued` (the number waiting behind it).
    - `setAutoDecider(fn | null)`. `AutoDecider` takes a request and returns an `ApprovalDecision` or a promise of one. `ABORTED_NOTE` is `'aborted'`.
    - It records `hitl` channel packets: `hitl/requested` (status `ok`, with `result.position`) and `hitl/resolved` (status `ok` or `rejected`, `latencyMs` = wait time since the request was queued, `result {approved, waitMs, note?}`). The two share a `correlationId` of the form `hitl-<n>`.
  - `src/app/features/approvals/approval-dialog.ts` / `.html`: `ApprovalDialog`.
    - Data is an `ApprovalRequest` and it closes with an `ApprovalDecision`.
    - It has a risk badge, the summary, the agent's reason, the policy flags, a diff `<table>`, and a Signal Form note field.
    - `data-testid`: `approve`, `reject`, `summary`, `reason`, `policy`, `diff`, `diff-row`, `risk-badge`.
  - `src/app/app.routes.ts`: the `dashboard` route `providers` now include `{ provide: HUMAN_APPROVAL_GATE, useExisting: ApprovalService }`. `/about` has no gate.
  - `src/app/features/dashboard/tools/deal-mutation-tools.ts`:
    - `dealMutationTools` now returns 4 tools. The new one is `terminateContract` (`{dealId, reason}`), which is always `critical`.
    - `DealMutationStore` gained `terminateContract` and `undoTo`.
    - Output is `{status: 'applied'|'no_change', dealId, terminatedAt: ISO | null, skipped[]}`.
    - The dashboard route now exposes **7 tools**.
  - `src/app/features/history/undo-notifier.ts`:
    - `announce(message, onUndo?: () => HistoryEntry | null)` records a `human/undo` packet when Undo is pressed, and only if `onUndo` returned an entry.
    - New `recordUndo(entry | null, source: 'snackbar' | 'panel')`.
    - The packet is channel `human`, with params `{entryId, label, source}` and result `{restored: label}`.
  - `src/app/features/history/agent-history-panel.ts` / `.html`: `AgentHistoryPanel` (`<app-agent-history-panel />`).
    - It renders nothing while `history` is empty. Otherwise it shows a glass section with the entries newest first, and an "Undo to here" button per entry that calls `store.undoTo(id)` and then `recordUndo(…, 'panel')`.
    - It sits in `DashboardPage` between the chart and the table.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (394 tests; statements 98.67 %, branches 97.75 %, functions 97.03 %, lines 98.57 %) and `npm run build` pass on each of the 3 commits. The dialog, the panel and the real approve/reject flow were **not checked in a real browser**, only in jsdom.
  - **Bundle budget (warning only):** the initial total is 538.95 kB raw against the CLI-default warning budget of 500 kB (the error limit is 1 MB). It was already 501.76 kB at the end of 6.1. Making `ApprovalService` eager (it is referenced from `app.routes.ts`) pulled about 35 kB of CDK overlay and a11y code into the initial chunk. The dialog component and `MatDialog` are already loaded lazily with `import()` inside the service. Options if it matters: raise `maximumWarning`, or find what else is eager.
  - **Snackbar Undo uses `undoTo(snapshotId)`, not `undo()`.** This deviates from the blueprint wording and is safer: a stale snackbar can't revert a newer step, and a second press is a no-op. A no-op press records no packet.
  - **Undo restores all state**, as noted in Session 2, including `filter`.
  - **No-op snapshots:** a snapshot is still recorded for a call that then changes nothing (for example all deals already at that discount). The panel can therefore show an entry that restores identical state.
  - **`terminateContract` is gated for every known deal**, even one without an active contract. Gating a no-op was kept so "always gated" is simple to state. An unknown ID throws `ToolInputError` before the dialog opens.
  - **Dialog focus:**
    - Reject gets `cdkFocusInitial` only for critical requests. For high-impact ones the first tabbable (the note field) gets focus.
    - jsdom has no layout, so the CDK focus trap treats every element as invisible. `approval-dialog.spec.ts` stubs `Element.prototype.getClientRects` (`visibleToFocusTrap()`) to test focus.
    - `disableClose: true` blocks both Esc and the backdrop. The service opens it with `role: 'alertdialog'`.
  - **Testing the dialog flow without a harness:**
    - `ApprovalService` loads the dialog through `await import(...)`, so wait with `await vi.waitFor(() => { TestBed.inject(ApplicationRef).tick(); expect(document.querySelector('app-approval-dialog')).not.toBeNull(); })`.
    - `afterClosed` fires after the close animation, so also `waitFor` the dialog element to leave the document (see `press()` in `approval-service.spec.ts`).
    - When requests are queued, wait for the _specific_ closed element, not for "no dialog", because the next one opens immediately.
    - Type into the note with `textarea.value = …; dispatchEvent(new Event('input'))`.
  - **Auto-decider and abort:** an abort on the active request wins over a slow decider (the decider's later result is ignored). A decider that throws becomes a rejection whose note is the error message.
  - **Telemetry:**
    - `hitl/*` packets use the `hitl` channel, so they stay out of `stats.calls` and the latency percentiles. The tool's own `tools/call` packet still closes as `rejected` on a human rejection.
    - Session 8's `AgentSessionStore` can derive `awaiting-approval` from `ApprovalService.pending`, provided through `HUMAN_APPROVAL_GATE`.
  - **Specs changed:** `context-tools-registration.spec.ts` and `deal-mutation-tools.spec.ts` now expect the 7 and 4 tools respectively. The `deal-mutation-tools.spec.ts` snackbar mock `open` returns a `{ onAction }` ref (one `Subject` per call, in `actions[]`).
  - **Commit trailers:** none, as before. Verified with `git log -1 --format='%an <%ae>%n%(trailers)'`.
  - **Blueprint deviations (non-functional):**
    - `with-human-approval.ts` holds only the small `requireApproval` helper, and `defineTool` still owns the middleware order.
    - Commit 6.2 added no specs of its own beyond updating the two registration specs, and 6.3 added all the scenarios, plus `approval-flow.spec.ts` (the real service, dialog and tools together) and two route assertions in `dashboard-routes.spec.ts`.
- **Ready for Session 7:**
  - **Signal Form Tool (Act 3).** It starts with the first commit in the Session 7 block. `ProposalsStore` still needs adding to the `dashboard` route `providers`, and `openProposalDrawer` should call `DashboardUiStore.openProposal()`. The `submission.action` approval path for discounts over 15 % can reuse `HUMAN_APPROVAL_GATE` and `ApprovalRequest.diff`/`policy`.

## Handoff Note: Session 7 Completed

- **Exported Symbols & Contracts:**
  - `src/app/core/models/proposal.ts`:
    - `ProposalModel`, `ProposalKey`, `ProposalDraft` (`ProposalModel` + `id`, `savedAt`), `ProposalSeed`.
    - `PRODUCT_TIERS` / `ProductTier`, `PROPOSAL_KEYS`, and the limits `SEATS_MIN`/`SEATS_MAX` (1/5000), `TERM_MIN_MONTHS`/`TERM_MAX_MONTHS` (6/60), `PROPOSAL_DISCOUNT_MAX` (40), `STARTER_SEAT_LIMIT` (1000).
    - `createProposalModel(seed?)` (no nulls, non-empty `lineItems`), `isIsoDate`, `isBillingDate` (ISO date on the 1st).
  - `src/app/features/proposal/proposal-form.ts`: `PROPOSAL_TOOL_NAME` (`'draftDealProposal'`), `PROPOSAL_TOOL_DESCRIPTION` (lists tiers, ISO format, the 1st-of-month rule and the 15 % approval) and `proposalSchema(dealExists): SchemaFn<ProposalModel>`.
  - `src/app/features/proposal/proposals-store.ts`: `ProposalsStore` (`withEntities<ProposalDraft>`), computed `latest`, and `saveDraft(model): ProposalDraft` (ids `P-0001`…, `savedAt` from `CLOCK`). It is in the `dashboard` route `providers`.
  - `src/app/features/proposal/proposal-drawer.ts` / `.html`: `ProposalDrawer` (`<app-proposal-drawer />`) and `AGENT_GLOW_MS` (1200).
    - It is rendered by `DashboardShell` inside `@if (ui.proposalOpen())`.
    - `form(model, proposalSchema(...), { name: 'proposal', experimentalWebMcpTool: {name, description, annotations: {consequentialHint: true}}, submission })`.
    - `data-testid`: `banner`, `saved`, `problems`, `save`, `close`, `add-line-item`, `remove-line-item`. Inputs carry `data-field="<key>"`.
  - `src/app/features/proposal/field-errors.ts`: `FieldErrors` (`<app-field-errors [field]="form.x" />`), which shows a field's errors once it is touched.
  - `src/app/app.config.ts`: `provideExperimentalWebMcpForms()` is added to the app providers.
  - `src/app/features/dashboard/data/dashboard-ui-store.ts`:
    - New state `proposalDealId: string | null`.
    - `openProposal(dealId?)` (keeps the previous ID when none is given) and `closeProposal()` (clears the ID).
    - The store now has a private `_deals: DealsStore` prop and registers the UI tools through `withWebMcpTools`.
  - `src/app/features/dashboard/tools/ui-tools.ts`: `dashboardUiTools(ui, deals)` returns **`openProposalDrawer`** `{dealId}`.
    - Output is `{opened, alreadyOpen, dealId, account, nextTool: 'draftDealProposal'}`.
    - An unknown ID throws `ToolInputError`.
    - It is not `consequentialHint` (view only), has no `reason` and records no snapshot.
    - The dashboard route now exposes **8 tools** (the cold open's "8 tools"), plus `draftDealProposal` while the drawer is open.
  - `src/app/mcp/tooling/define-tool.ts`: new `isSelfInstrumented(toolName)`, which is true for any tool built by `defineTool` (it records its own `tools/call` span).
  - `src/app/mcp/agent/mcp-tool-gateway.ts`: `McpToolGateway` (`@Service()`, root).
    - `listTools(): readonly RegistryToolInfo[]` records a `tools/list` packet with the tool names as the result.
    - `callTool(name, args, signal?): Promise<ToolCallResult>` where `ToolCallResult = {name, ok, result, latencyMs}`. **It never throws.** `result` is the parsed JSON text (or the plain text), and a failure is `{error: message}`.
    - `ok` is false when the tool threw, when `isError` is set, or when the text starts with `FORM_FAILURE_PREFIX` (`'Form submission failed'`).
    - `waitForTool(name, timeoutMs, signal?): Promise<boolean>`.
    - Signals: `toolsVersion` (+1 for every non-empty diff), `tools` and `lastChange` (`{added, removed, version}` or `null`).
    - Also exports `diffTools(before, after)` and the types `ToolsDiff`, `ToolsChange`, `ToolCallResult`.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (483 tests; statements 98.84 %, branches 96.21 %, functions 97.45 %, lines 98.95 %) and `npm run build` pass on each of the 3 commits. Commit 7.1 had no new specs of its own (the existing 394 passed), and all the new specs are in 7.3.
  - **Not verified in a real browser:** the 7.1 acceptance ("the Chrome inspector shows `draftDealProposal` while the drawer is open") was only checked against the fake registry. Run `npm start` with `chrome://flags/#enable-webmcp-testing` when convenient. The drawer's layout, the glow animation and the native `<input type="date">` were not looked at.
  - **Bundle budget (warning only):** the initial total is now 622.86 kB against the 500 kB warning budget (was 538.95 kB). `provideExperimentalWebMcpForms()` in `app.config.ts` pulls `@angular/forms/signals` into the initial chunk. The error limit is 1 MB. Moving that provider into the `dashboard` route `providers` would not help, because `app.routes.ts` is eager too.
  - **No double counting, as promised in Session 5's note:** the gateway records `tools/call` only for tools that are **not** `defineTool` tools, which in practice means the Signal Form tool (nothing else records a span for it). Session 8's agent should call `gateway.callTool`, and `stats.calls` will then count each call once.
  - **The tool appears after the first change detection**, not when the drawer is created: Angular registers the form tool from an `effect()` and then awaits `declareExperimentalWebMcpTool`. In tests, `fixture.detectChanges()` then `await vi.waitFor(() => expect(registry.current.toolNames()).toContain('draftDealProposal'))`. For the agent, `openProposalDrawer` returns before the tool exists, so the loop must refresh tools (`toolsVersion`) or `waitForTool('draftDealProposal', …)` before the next step. Its description and `nextTool` already tell the model that.
  - **Gateway batching:** `toolchange` events are coalesced with `queueMicrotask`, so registering 7 tools gives one `list_changed` packet. In tests `await new Promise(r => queueMicrotask(r))` before reading `lastChange`. The gateway attaches to `document.modelContext` in its constructor (and re-attaches in `listTools`/`callTool` if the registry object changed), so install the registry before injecting it.
  - **Form tool results are plain text, not JSON.** `execute` returns `"Form submitted successfully."` or `"Form submission failed:\n<path>: <message>"`. The gateway's `result` is that string. Failures use the field path, for example `startDate: Start date must be the 1st of a month (billing cycle), for example 2027-01-01`.
  - **`value.set(args)` replaces the whole model**, so the drawer's `saved` and `attempted` are `linkedSignal`s on the model, which reset on any change. An explicit `set` after the model changed sticks (the action does this on success).
  - **Agent glow vs typing:** the drawer diffs the model in an `effect()` and skips any field a person just edited (host `(input)`/`(change)` listeners read `data-field`, and the add/remove line item buttons do the same). A reseed through `openProposal(otherDealId)` while the drawer is open also glows the prefilled fields.
  - **`submission.action` order:** the Starter seat limit is checked first (no dialog), then the gate for a discount above 15 % (`DISCOUNT_APPROVAL_PCT` from `risk-policy.ts`), then `saveDraft`. Both failures come back as errors on `seats` / `discountPct`, which is what the agent sees. A missing gate rejects (fail-safe, as in `defineTool`). The approval wait is aborted when the drawer is destroyed. The proposal approval uses `requireApproval` and the same `ApprovalRequest` shape, so the dialog shows a one-row diff (deal discount before/after).
  - **Form tool telemetry** is the gateway's packet only. A person clicking Save records no packet (correct, it is not a tool call), but the approval still records `hitl/*` packets through `ApprovalService`.
  - **Seed:** `Konkan Freight` is `D-1001` (closed-won, 5 % discount), which Act 3's prompt targets. Existing specs that count tools were updated: `context-tools-registration.spec.ts` now expects 8 names.
  - **Testing tips:**
    - Provide `provideExperimentalWebMcpForms()`, `DealsStore`, `DashboardUiStore` and `ProposalsStore` in `TestBed`, plus `{ provide: HUMAN_APPROVAL_GATE, useValue: { pending: signal(null), request } }`. Drive the tool with `registry.current.executeTool('draftDealProposal', args)`, then `fixture.detectChanges(); await fixture.whenStable()`.
    - Fake timers are only needed for the 1.2 s glow expiry. Install them after the tool has registered.
    - `form()` needs an injection context, so wrap it in `TestBed.runInInjectionContext` for pure schema specs (see `proposal-form.spec.ts`).
  - **Blueprint deviations (non-functional):**
    - `proposalDealId` and `openProposal(dealId?)` live in 7.1 (the drawer needs them), and the `openProposalDrawer` tool is in 7.2.
    - The shell holds the drawer (as in 7.1), not `dashboard-page` as Session 3's note suggested.
    - Added `field-errors`, `ui-tools.ts`, `core/models/proposal.ts` and `proposals-store.spec.ts`.
- **Ready for Session 8:**
  - **BYOK & Gemini Agent.** It starts with 8.1 in the Session 8 block of this file. `SettingsStore` should provide `WIRE_SECRETS` (Session 5's note), `AgentSessionStore` can derive `awaiting-approval` from `ApprovalService.pending` (Session 6's note) and should use `McpToolGateway` for every registry call (this note).

## Handoff Note: Session 8 Completed

- **Exported Symbols & Contracts:**
  - `src/app/mcp/agent/gemini/gemini-models.ts`:
    - Types `GeminiModelId` (`'gemini-3.5-flash-lite' | 'gemini-3.8-flash' | 'gemini-4-argon'`), `ThinkingLevelName`, `ModelPersona`, `PriceEntry {from, inputPerM, outputPerM}` and `GeminiModel {id, persona, emoji, thinkingLevel, freeTier, role, priceSchedule}`.
    - `GEMINI_MODELS` (catalog order: Sprinter, Operator, Strategist), `DEFAULT_MODEL_ID` (the Operator), `findModel(id)`, `priceAt(model, date)` (UTC day, last entry whose `from <= day`) and `estimateCostUsd(modelId, usage, at): number | undefined` (thinking is billed at the output rate; an unknown model gives `undefined`).
  - `src/app/mcp/agent/gemini/genai-client.ts`:
    - Own structural SDK types `GenAiClient`, `GenAiChat`, `GenAiConfig`, `GenAiPart`, `GenAiChunk`, `GenAiUsage`, `GenAiFunctionDeclaration`.
    - `GENAI_CLIENT_FACTORY: InjectionToken<(apiKey) => Promise<GenAiClient>>` (root). The default factory does `await import('@google/genai')` and casts the real `GoogleGenAI`. **Always override this token in specs.**
  - `src/app/mcp/agent/agent-config.ts`: `AgentConfig {apiKey: Signal<string>, model: Signal<string>}` and `AGENT_CONFIG` (no default). `app.config.ts` provides it as `useFactory: () => inject(SettingsStore)`.
  - `src/app/mcp/agent/agent-events.ts`: `AgentEvent` (§4.5), `AgentErrorKind` and `AgentEventType`.
  - `src/app/mcp/agent/system-prompt.ts`: `buildSystemPrompt(now: Date): string`.
  - `src/app/mcp/agent/gemini/tool-adapter.ts`: `toFunctionDeclarations(tools)` (passes `inputSchema` through as `parametersJsonSchema`, and an empty or missing schema gives `{type: 'object', properties: {}}`) and `toFunctionResponse(call, result)` (`response` is `{output}` when ok and `{error}` otherwise).
  - `src/app/mcp/agent/gemini/gemini-agent.ts`:
    - `GeminiAgent` (`@Service()`, root, a **separate lazy chunk**, 8.27 kB). `run(prompt, {signal, model?, maxSteps?, runId?}): AsyncGenerator<AgentEvent>`. Resolve it with `injectAsync(() => import('.../gemini-agent').then(m => m.GeminiAgent))`.
    - Also `MAX_AGENT_STEPS` (8), `NEXT_TOOL_WAIT_MS` (3000), `classifyError(error): {kind, message}`, `isAbort(error, signal)` and the type `AgentRunOptions`.
  - `src/app/mcp/agent/agent-session-store.ts`: `AgentSessionStore` (`providedIn: 'root'`).
    - State: `transcript: TranscriptEntry[]` (`{id, kind: 'user', text}` or `{id, kind: 'event', event}`), `phase`, `lastUsage`, `lastCostUsd` and `lastModel`.
    - Computed: `status` (`'idle' | 'running' | 'awaiting-approval' | 'error'`) and `running`.
    - Methods: `run(prompt, {model?, runId?}): Promise<void>` (ignored while running or when blank), `stop()` and `clear()` (aborts and resets).
    - Also exports the types `SessionStatus`, `SessionPhase`, `TranscriptEntry` and `RunRequest`.
  - `src/app/features/settings/settings-store.ts`: `SettingsStore` (root).
    - State: `apiKey`, `remember`, `model`.
    - Computed: `hasKey` and `keyStatus` (`'missing' | 'checking' | 'valid' | 'invalid' | 'unreachable'`).
    - Props: `keyCheck`, a `resource<KeyVerdict, string | undefined>` that calls `models.list({config: {pageSize: 1, abortSignal}})`.
    - Methods: `saveKey(key, remember)`, `setModel(id)` and `forgetKey()`.
    - Also `toVerdict(error)`, `API_KEY_STORAGE_KEY` (`'awm.apiKey'`) and `MODEL_STORAGE_KEY` (`'awm.model'`).
  - `src/app/features/settings/api-key-dialog-launcher.ts`: `ApiKeyDialogLauncher` (`@Service()`) with `open(): Promise<boolean>` (true when a key was saved). **Use this for Session 9's "open the dialog" error-card fix.**
  - `src/app/features/settings/api-key-dialog.ts` / `.html`: `ApiKeyDialog` (lazy, loaded by the launcher) and `API_KEY_URL`.
    - `data-testid`: `api-key`, `remember`, `key-status`, `forget`, `cancel`, `save`.
  - `src/app/features/settings/model-picker.ts` / `.html`: `ModelPicker` (`<app-model-picker [(value)]="id" />`). It is an Aria `ngListbox` with `selectionMode="follow"`.
    - `data-testid`: `model-<id>`, `free-badge`, `paid-badge`.
  - `src/app/features/settings/byok-banner.ts` / `.html`: `ByokBanner` (`<app-byok-banner />`). It is rendered at the top of `DashboardShell` while there is no key. `data-testid`: `byok-banner`, `add-key`.
  - `src/app/app.config.ts` now also provides:
    - `AGENT_CONFIG`
    - `WIRE_SECRETS` as `() => [settings.apiKey()]`
    - **`HUMAN_APPROVAL_GATE` at the root** (`useExisting: ApprovalService`), so the root `AgentSessionStore` can see `gate.pending`. The `dashboard` route still provides it too.
  - `src/app/app.html` / `app.ts`: a toolbar button `data-testid="open-key-dialog"` that opens the dialog (`key` or `key_off` icon).
  - `src/testing/fake-genai.ts`:
    - `FakeGenAI(script = [], apiKey?)` implements `GenAiClient`. Script entries are a `FakeTurn` or a function `(request) => FakeTurn`, and `push()` adds more.
    - A `FakeTurn` is `{thoughts?, text?: string | string[], functionCalls?: {name, args?, id?}[], usage?, error?, hold?: Promise<void>}`.
    - Inspect with `requests` (`{model, message, config, chat}`), `createdChats` (a `FakeChat` has `history`, `model`, `createConfig`), `listCalls`, `listError` and `listHold`.
    - Also `FakeApiError(status, message)`, `abortError()` and `fakeGenAiFactory(client)`.
- **Gotchas / Technical Notes:**
  - **Gate status:** `npm run lint`, `npm run test:coverage` (607 tests; statements 98.89 %, branches 96.16 %, functions 97.66 %, lines 98.95 %), `npm run build` and `prettier --check src` pass on each of the 3 commits. 8.2 had no specs of its own beyond one added to `app.config.spec.ts`, and 8.3 added all the agent and store scenarios (coverage was 86 % between the two commits).
  - **Not verified in a real browser or against the real Gemini API:** the key dialog, picker, banner, CSP and the agent against a live key were only exercised in jsdom with `FakeGenAI`. Running Chrome against a built `dist` was blocked in this session. Do this before the talk: `npm run build`, serve `dist/angular-web-mcp/browser`, check the console for CSP violations, then run a real prompt with an AI Studio key.
  - **A10 failed as written, so the CSP is split.** Two CSP `<meta>` tags are both enforced, so a `script-src 'self'` meta would block the hashed inline loader scripts that `autoCsp` injects. `angular.json` production has `security.autoCsp: true` (it owns the script policy). `src/index.html` carries a second meta **without `default-src` and `script-src`**: `style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://generativelanguage.googleapis.com; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'`. In `ng serve` only the hand-written meta applies. If `autoCsp` ever breaks the app, the fallback is `optimization.styles.inlineCritical: false` plus a `script-src 'self'` meta.
  - **A8 held in the types** (`@google/genai` 3.0.0): `thinkingConfig.{thinkingLevel, includeThoughts}`, `abortSignal` inside `GenerateContentConfig`, `parametersJsonSchema` and `thoughtsTokenCount` all exist. **The per-request `config` on `sendMessageStream` does not inherit the chat config**, so the agent repeats the whole config (system prompt, tools, thinking, `automaticFunctionCalling.disable`, `abortSignal`) on every request. The thinking level is sent as the enum string (`'LOW' | 'MEDIUM' | 'HIGH'`). It was not run against the live API, so confirm the model IDs and `thinkingLevel` are accepted.
  - **A9 held:** `ngListbox` single-select works through `value` as a one-item array (`[value]` plus `(valueChange)`). The harness import is `@angular/aria/listbox/testing`, with a slash. Keyboard selection is tested by dispatching `keydown` on the listbox element.
  - **Bundle:** the initial total is 636.34 kB (was 622.86 kB), still warning-only. `@google/genai` stays out of the initial chunk (a 410 kB lazy chunk). The build prints a warning that `p-retry` (a dependency of the SDK) is not ESM. It is harmless.
  - **The agent is tree-shaken until something references `AgentSessionStore`.** The lazy-chunk acceptance was checked by temporarily injecting the store in `App` (a `gemini-agent` chunk of 8.27 kB appeared), then reverting. Session 9's console will pull it in for real.
  - **`nextTool` handling:** when an OK tool result is an object with a string `nextTool`, the agent calls `gateway.waitForTool(nextTool, 3000, signal)` before the next request. `openProposalDrawer` already returns `nextTool: 'draftDealProposal'`, which fixes the timing caveat in Session 7's note. Otherwise the tool list is re-read at the top of each step whenever `gateway.toolsVersion()` changed, which emits a `tools-changed` event.
  - **Tool calls run sequentially in the model's order**, not in parallel, so approvals can't collide. Each is `tool-call` then `tool-result`. A function call without an ID gets `step-<n>-call-<i>`.
  - **`awaiting-approval` is emitted by the store, not the agent.** The store's effect appends an `awaiting-approval` entry when `gate.pending` becomes non-null during a run. The agent never yields that event.
  - **Abort:** a stop yields nothing further (no `error`, no `done`) and settles the open `generateContent` packet as an error with `'aborted'`. The signal reaches pending approvals through `gateway.callTool(name, args, signal)`. The store drops events that arrive after an abort and ignores a finished old run when a newer one has started.
  - **Telemetry:**
    - Each model request is one `llm` `generateContent` packet with `model`, `tokens`, `costUsd` and `runId`.
    - The request params carry the prompt or function responses, and **redaction runs on these through `WIRE_SECRETS`**. The error `message` in the event is redacted with the key too.
    - Tool calls are counted once (the gateway skips `defineTool` tools).
    - The agent calls `gateway.listTools()` once at the start (one `tools/list` packet) and again after each tool change.
  - **Error mapping (`classifyError`):**
    - 429 → `quota`
    - 404 → `model-access`
    - 401 → `auth`
    - 403 → `model-access` only when the message mentions the model and not the key, otherwise `auth`
    - 400 with "api key" → `auth`
    - no status and a `TypeError` or "failed to fetch" / "network" → `network`
    - anything else → `unknown`
    - A JSON body such as `{"error":{"message":…}}` is unwrapped to its message.
  - **`keyCheck`:** 400, 401 and 403 from `models.list` → `invalid`. 429 counts as a **valid** key (rate limited). Anything else → `unreachable`. The check runs on every key change, and the resource aborts the previous request.
  - **Storage:** the key goes to `sessionStorage` always and to `localStorage` only with "Remember". The model choice is stored in `localStorage`. Every access is wrapped in `guarded()`.
  - **Testing tips:**
    - Store specs with a resource: `await vi.waitFor(() => { TestBed.tick(); expect(store.keyStatus()).not.toBe('checking'); })`.
    - For `AgentSessionStore`, override `GeminiAgent` with `{provide: GeminiAgent, useFactory: () => fakeAgent}`. `injectAsync` resolves the class token through the injector, so the override works and a counter in the factory proves the lazy single load.
    - For `GeminiAgent`, provide `GENAI_CLIENT_FACTORY` (`fakeGenAiFactory(fake)`), `AGENT_CONFIG`, `WIRE_SECRETS` and a ticking `CLOCK`, and register tools through `useFakeModelContext()`.
    - An `untilAborted` fake generator must check `signal.aborted` before listening, because a stop can arrive before the generator starts.
  - **Blueprint deviations (non-functional):**
    - The settings store/dialog also got `ApiKeyDialogLauncher`, a toolbar button, `byok-banner.spec.ts`, `app.config.spec.ts`, `genai-client.spec.ts` and `system-prompt.spec.ts`.
    - `app.spec.ts` now selects the theme button by its aria-label, because the key button is first in the toolbar.
    - `AgentSessionStore` is root as in §3.5, so the gate had to move to the root (see above).
    - Run IDs: the agent only tags its own `llm` packets with `runId`. Session 9.2 must tag the others.
    - `src/testing/fake-genai.ts` was created in 8.1 (the blueprint lists it under 8.3) because the settings store specs needed `models.list`.
- **Ready for Session 9:**
  - **Agent Console & Lab.** It starts with 9.1 in the Session 9 block of this file. The console should read `AgentSessionStore` (`transcript`, `status`, `run`, `stop`, `lastUsage`, `lastCostUsd`), use `ApiKeyDialogLauncher.open()` for the `auth` error card, `SettingsStore.setModel` for the `model-access` fix, and `LayoutStore` for the hotkeys.
