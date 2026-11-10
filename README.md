# Angular Web MCP

[![CI](https://github.com/AnkitSharma-007/angular-web-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AnkitSharma-007/angular-web-mcp/actions/workflows/ci.yml)

A Sales & Deals CRM whose Signal state and Signal Forms are exposed to AI agents through Angular's native **WebMCP** APIs. It is a reference app for building "agent-ready" Angular apps, and the live demo for Google DevFest Mumbai.

- **Agents see what the app chooses to show them.** Tools are registered on `document.modelContext`, scoped to routes, stores and forms, so they appear and disappear with the UI that owns them.
- **Humans stay in charge.** Risky tools pause on an approval dialog with a before/after diff. A rejection is a result the model adapts to. Undo is human-only.
- **Bring your own key.** An in-app Gemini agent drives the same tools an external agent would. Your key stays in your browser. There is no backend.
- **Everything is observable.** A wire inspector shows every packet, tool schema, latency, token count and cost.

Built with Angular 22 (zoneless), Angular Material 3, Tailwind CSS, NgRx SignalStore and Google Gemini.

> WebMCP is experimental. The Angular APIs are `declareExperimentalWebMcpTool`, `provideExperimentalWebMcpTools` and `provideExperimentalWebMcpForms`, and they may change in a 22.x patch. Versions are pinned exactly for that reason.

## Quick start

You need Node 24.18 or newer.

```bash
npm ci
npm start
```

Open <http://localhost:4200>, then:

1. Click the **key** icon in the toolbar, paste a Gemini API key from [AI Studio](https://aistudio.google.com/apikey) and pick a model.
2. Open **Agent console** on the dashboard.
3. Click a demo chip (**Context**, **Multi-step**, **Signal Form**, **Governance**), or ask your own question.
4. Press `` ` `` to open the wire inspector and watch the traffic.

Presenter keys: `1`–`4` fill a demo prompt, `` ` `` toggles the inspector, `Shift+R` resets the demo. See the [stage run-sheet](docs/demo-script.md).

You can use the tools without a key. Any WebMCP client in your browser (Chrome's agent, a tool-inspector extension) sees the same tools. Only the in-app console needs a key.

## Bring your own key

The app has no server. The in-app agent calls the Gemini API straight from your browser with a key you provide.

- **Storage:** the key lives in memory and `sessionStorage`. **Remember on this device** adds `localStorage`. **Forget key** clears both.
- **Never leaked by the app:** the key is not in source, environment files, the build, URLs or logs. Wire telemetry redacts it (`x-goog-api-key`, `key=` values and the raw key).
- **Content Security Policy:** production builds restrict `connect-src` to `self` and `https://generativelanguage.googleapis.com`. Model output is rendered as text, never as HTML.
- **Restrict your key.** Anything in a browser can be read by whoever uses that browser, so make the key cheap to lose. In Google AI Studio / Cloud Console:
  - restrict it to the **Generative Language API** only
  - restrict it by **HTTP referrer** to the origins you run the app from, for example `http://localhost:4200/*`
  - use a separate key for this app, and set a quota or budget alert
- **Data:** free-tier requests may be used by Google to improve its products. That is fine here because the CRM data is fictional. Do not point this app at real customer data on a free-tier key.
- **Billing:** a Gemini app subscription does not pay for API calls. You need an AI Studio key.

## Choosing a model

| Persona               | Model ID                | Thinking | $ per 1M tokens (in / out)                | Use it for                   |
| --------------------- | ----------------------- | -------- | ----------------------------------------- | ---------------------------- |
| ⚡ Sprinter           | `gemini-3.5-flash-lite` | low      | 0.30 / 2.50                               | Fast reads and quick answers |
| 🛠️ Operator (default) | `gemini-3.8-flash`      | medium   | 0.75 / 3.75 (1.50 / 7.50 from 2027-01-01) | Multi-step tool work         |

Prices verified 2026-11-09 against the [model list](https://aistudio.google.com/docs/models) and [pricing](https://aistudio.google.com/docs/pricing). The catalog keeps dated price schedules, so the picker always shows the price in force today. Every run shows its token usage and cost; thinking tokens are billed at the output rate.

A typical Operator run costs about $0.01–0.03.

## Browser support

| Browser                  | Registry                                                                                                                                | What works                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Chrome 158+ with flag    | Native `document.modelContext`                                                                                                          | Everything, including Chrome's own agent and extensions                             |
| Any other modern browser | [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill), or a small in-page shim if the polyfill can't install | The in-app agent and every tool. External agents generally need the native registry |

Enable WebMCP in Chrome at `chrome://flags/#enable-webmcp-testing` and relaunch. The toolbar chip shows which registry is active: `native`, `polyfill` or `shim`. WebMCP in Chrome is an origin trial / flag with no ship date yet ([details](https://developer.chrome.com/docs/ai/webmcp/secure-tools)).

## What's inside

```
core/      domain types, seed data, store features        (leaf)
mcp/       reusable WebMCP platform: registry, tooling, telemetry, agent
features/  dashboard, proposal form, approvals, console, inspector, lab, settings
shared/    UI building blocks                             (leaf)
```

Layering is `core ◄ mcp ◄ features ► shared`, enforced by ESLint. `mcp/` has no Material and no feature imports, so you can lift it into another app.

| Piece                            | What it does                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `provideExperimentalWebMcpTools` | Route-scoped read tools. Leaving the route unregisters them                                                    |
| `withWebMcpTools()`              | A SignalStore feature that registers tools for as long as the store lives                                      |
| Signal Form tool                 | `form(model, schema, { experimentalWebMcpTool })` turns the proposal form into a tool while the drawer is open |
| `defineTool()`                   | Telemetry → validation → human approval → snapshot → run, in one wrapper                                       |
| `McpToolGateway`                 | The only registry client inside the app. Lists, calls and watches tools, and traces every call                 |
| `GeminiAgent`                    | Streaming agent loop with thoughts, tool calls and cost. Loaded lazily with `injectAsync`                      |
| `HUMAN_APPROVAL_GATE`            | A token owned by `mcp/`, implemented by a Material dialog in `features/`                                       |
| Wire inspector                   | Packets, registered tools and tool-call stats, with JSON-RPC framing as a display convention                   |
| Lab (`/dashboard/lab`)           | Scored act evals, to tune the text the model reads                                                             |

The demo has four acts: **Context** (read tools), **Multi-step** (filter, discount, close), **Signal Form** (a tool that appears when a drawer opens, and an agent that fixes its own mistake) and **Governance** (approve one change, reject another, undo).

Read the [architecture blueprint](docs/architecture-blueprint.md) for the decisions and the session-by-session build log.

## Patterns you can reuse

### `withWebMcpTools`: agent-ready stores

Tools close over the typed store, so there is no `inject()` inside `execute`, and they live exactly as long as the store.

```ts
export const DealsStore = signalStore(
  withDeals(),
  withAgentHistory({ capacity: 20 }),
  withFeature((store) => withWebMcpTools(() => dealMutationTools(store))),
);
```

### `withAgentHistory`: bounded snapshots and human-only undo

```ts
const id = store.recordSnapshot('10% discount on 3 deals'); // before the change
store.undoTo(id); // restores the state from before that change
```

It adds `history`, `canUndo`, `lastEntry`, `recordSnapshot()`, `undo()`, `undoTo()` and `clearHistory()` to any SignalStore. Nothing exposes undo as a tool, so an agent can't roll back or hide its own changes. The history is an in-memory stack of 20 entries for people to undo with, not an immutable audit log: the reason an agent gave lives in the wire log, which is bounded and clearable.

### `defineTool`: one wrapper for the cross-cutting parts

```ts
const terminateContract = defineTool<{ dealId: string; reason: string }, UndoNotifier>({
  name: 'terminateContract',
  description: 'Use only when the user explicitly asks to end a customer contract. …',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['dealId', 'reason'],
    properties: { dealId: { type: 'string', pattern: '^D-\\d{4}$' }, reason: { type: 'string' } },
  },
  annotations: { consequentialHint: true },
  risk: ({ dealId, reason }) => ({
    toolName: 'terminateContract',
    risk: 'critical',
    summary: `Terminate the contract on ${dealId}`,
    reason,
  }),
  snapshot: store,
  snapshotLabel: ({ dealId }) => `Terminate contract ${dealId}`,
  run: ({ dealId }) => store.terminateContract(dealId),
});
```

- Arguments are validated against `inputSchema` before anything runs.
- A `risk` result pauses the call on the approval gate. With no gate provided, the call is rejected.
- The snapshot is taken after approval and before `run`.
- A human rejection returns `{ status: 'rejected_by_human', note }`, so the model adapts instead of failing.
- Dependencies are resolved synchronously at the start of `execute`, because the injection context ends at the first `await`.

## Testing

```bash
npm run lint
npm test                # Vitest in jsdom
npm run test:coverage   # fails below 60% on lines, functions, branches and statements
npm run build
```

- No test touches the network: `fetch` throws, and the Gemini client is always replaced by a fake that streams scripted turns.
- The act acceptance suite (`src/app/demo-acts.spec.ts`) plays all four acts on one app through the real console, tools, forms and approval dialog.
- Interactive components are checked with axe. jsdom skips colour contrast, so run Lighthouse before a talk.

CI runs the tests on every push to `main`.

## Contributing

Issues and pull requests are welcome.

1. Fork, branch, and keep each change small.
2. Run `npm run lint && npm run test:coverage && npm run build` before you push.
3. Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(inspector): …` or `fix(console): …`.
4. Follow the house rules: every component is a `.ts` file plus a sibling `.html` (`templateUrl` only), signal inputs and outputs, `inject()` only, Signal Forms only, and no `any`.
5. If a change touches a WebMCP surface, update the notes in the [blueprint](docs/architecture-blueprint.md#51-webmcp-feature-notes-per-act).

## License

[MIT](LICENSE)
