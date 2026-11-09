# Stage run-sheet

The live demo for Google DevFest Mumbai. 12–15 minutes, all live, no recorded fallback.
The arc comes from [§5 of the blueprint](architecture-blueprint.md#5-live-demo-arc-1215-min-all-live).

## Controls on stage

| Key / control           | What it does                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `1` `2` `3` `4`         | Fill the matching act prompt into the console, open it and focus the composer. Press **Enter** to run it |
| Clicking a chip         | Runs that act's prompt at once, on the chip's model                                                      |
| `` ` ``                 | Open or close the wire inspector                                                                         |
| `Shift+R`               | Reset: the seed deals, empty history, empty packets, empty transcript, proposal drawer closed            |
| **Stop** in the console | Aborts the agent, any open approval (it counts as a rejection) and the request in flight                 |
| `Esc`                   | Closes the wire inspector or the proposal drawer, while focus is inside it                               |

Hotkeys are ignored while focus is in a text field. After typing in the console, click the page background (or press `Tab` away) before using `1`–`4`.

Models: **⚡ Sprinter** `gemini-3.5-flash-lite` for Act 1, **🛠️ Operator** `gemini-3.8-flash` for Acts 2–4. **🧠 Strategist** `gemini-4-argon` is paid-tier only and is not used on stage.

## The arc

| Time        | Beat                   | Do                                                             |
| ----------- | ---------------------- | -------------------------------------------------------------- |
| 0:00–1:30   | Cold open              | Inspector → Tools tab, then `/about` and back                  |
| 1:30–4:00   | Act 1 · Context ⚡     | `1`, Enter                                                     |
| 4:00–7:00   | Act 2 · Multi-step 🛠️  | `2`, Enter                                                     |
| 7:00–9:30   | Act 3 · Signal Form 🛠️ | `3`, Enter                                                     |
| 9:30–12:00  | Act 4 · Governance 🛠️  | `4`, Enter, approve, reject, undo                              |
| 12:00–14:00 | Act 5 · Wire + Race    | Lab → Model Race (⚡ vs 🛠️), then the inspector                |
| 14:00–15:00 | Close                  | Code: registration styles, `withWebMcpTools()`, change history |

### Cold open (0:00–1:30)

1. Dashboard is up, console closed. Point at the toolbar chip: **WebMCP: native**.
2. Press `` ` `` and open the **Tools** tab: **8 tools registered**. Three read tools, four mutation tools, one UI tool.
3. Click **About** in the top bar. The Tools tab drops to **0 tools registered**.
4. Click **Dashboard**. The 8 tools return, each with a **New** badge.

Say: the tools belong to the route. When Angular destroys the route injector, its `DestroyRef` aborts the registration signals and the browser fires `toolchange`.

### Act 1 · Context ⚡ (1:30–4:00)

- **Prompt:** "Give me a pipeline summary — where are we exposed this quarter?"
- **Tools:** `getPipelineSummary` → `searchDeals` (stalled deals).
- **Expect:**
  - The model badge reads **⚡ Sprinter**.
  - A collapsed **Thinking** block streams, then two tool-call / tool-result pairs.
  - The answer names the stalled accounts. Nothing on the dashboard changes.
- **Say:** the agent only sees what `document.modelContext` shows it, the same as Chrome's own agent. Every call is a packet in the inspector.
- **If it slips:** it answers from the summary alone. Fine; point at the packets and move on.

### Act 2 · Multi-step 🛠️ (4:00–7:00)

- **Prompt:** "Show EMEA deals in Negotiation, give them 10% off, and move anything above 70% probability to Closed Won."
- **Tools:** `setDealFilter` → `searchDeals` → `applyBatchDiscount` → `updateDealStages`.
- **Expect:**
  - The table filters to EMEA negotiations, the bars animate and the KPIs tick.
  - Four call / result pairs. **No approval dialog**: 10% is under the 15% threshold and the impact is under $250k.
  - An **Undo** snackbar and two entries in **Agent changes**.
- **Say:** the mutation tools carry `consequentialHint`, and `execute` receives an abort signal, so Stop cancels a call in flight.

### Act 3 · Signal Form 🛠️ (7:00–9:30)

- **Prompt:** "Draft a 24-month Enterprise renewal for Konkan Freight, 250 seats, starting mid-December."
- **Tools:** `openProposalDrawer` → _toolchange_ → `draftDealProposal` ✗ → ✓.
- **Expect:**
  - The proposal drawer slides in. In the inspector **Tools** tab, `draftDealProposal` appears with a **New** badge.
  - Fields glow as they fill.
  - The first submit fails: the start date must be the 1st of a month (billing cycle). The agent retries with a billing date and the drawer shows **Draft P-0001 saved for Konkan Freight**.
- **Say:** this tool was never written. Angular inferred it from a Signal Form. The schema carries types only, so the rules live in the tool description and in the validators.
- **If it slips:** the model picks the 1st straight away. Frame it as "when it slips, watch it fix itself", and say the Lab measures how often it self-corrects.
- Close the drawer with `Esc` before Act 4.

### Act 4 · Governance 🛠️ (9:30–12:00)

- **Prompt:** "End of quarter: give Arcadia Bank 25% off and terminate the Monsoon Retail contract."
- **Tools:** `applyBatchDiscount` ⏸ **Approve**, then `terminateContract` ⏸ **Reject**.
- **Expect:**
  - Dialog 1, **High-impact action**: a 25% discount with the policy flag and a before/after row. Press **Approve**.
  - Dialog 2, **Critical action**: terminate the Monsoon Retail contract. Type a short note and press **Reject**.
  - The agent says the termination was rejected and the contract stays active. Arcadia Bank shows 25%.
- **Undo:** click **Undo** in the snackbar (it stays for 8 seconds) or **Undo to here** in **Agent changes**. The chart rolls back.
- **Say:** the gate sits inside the tool, so it protects external agents too. A rejection is a result, not an error, so the model adapts. There is no undo tool: only the human can undo.

### Act 5 · Wire + Race (12:00–14:00)

1. Press `Shift+R`, then open **Lab** in the dashboard nav.
2. In **Model race**, leave ⚡ and 🛠️ ticked. Prompt: "Which three deals should I prioritise this week and why?" Press **Run race**.
3. The runs go one after the other so the latencies are comparable. Each card shows time, tool calls, thinking tokens and cost.
4. Press `` ` `` and show **Packets** (channel, latency, tokens, cost), then **Stats** (p50 / p95 and the per-model table).
5. Say that 🧠 is one tick away, with a "paid tier" badge.

JSON-RPC framing in the inspector is a display convention. WebMCP itself is an in-page API. Say so.

### Close (14:00–15:00)

Show the registration styles side by side: `provideExperimentalWebMcpTools` on a route, `withWebMcpTools()` on a store, and a Signal Form's `experimentalWebMcpTool`. Then the change history (a bounded undo stack, not a compliance log): **Agent changes** and the `human/undo` packet.

## Pre-flight

### Days before

- [ ] **Re-verify the experimental APIs** a week out: `@angular/*` 22.2.5, `@angular/forms/signals`, `@mcp-b/webmcp-polyfill`, Chrome 158. Pins are exact, so nothing moves unless you move it.
- [ ] **Freeze** prompts, tool descriptions, the system prompt and model IDs about 5 days before.
- [ ] **Sign-off:** Lab → **Evals**, 10 runs per act on ⚡ (Act 1) and 🛠️ (Acts 2–4). Each act needs **at least 9/10** and a p90 inside its time slot. Cost is under about $1 for the sweep.
- [ ] Copy the rows from **Build log rows** into [eval-log.md](eval-log.md).
- [ ] **Lighthouse** accessibility on both themes. The unit tests skip colour contrast, so this is where it gets checked.
- [ ] **Production build once:** `npm run build`, serve `dist/angular-web-mcp/browser` with a single-page-app fallback (for example `npx serve -s dist/angular-web-mcp/browser`) and check the console for CSP violations.
- [ ] **Live API once:** the unit tests use a fake Gemini. Run all four chips against a real key and confirm the model IDs and `thinkingLevel` are accepted.

### The day before and the morning of

- [ ] Re-run the sign-off sweep the day before, and again on the venue Wi-Fi in the morning.
- [ ] **Tethering** is ready as the network fallback.
- [ ] **Chrome 158.0.8127.18** with `chrome://flags/#enable-webmcp-testing` enabled and Chrome relaunched.
- [ ] The toolbar chip reads **WebMCP: native** (not `polyfill` or `shim`).
- [ ] **API key** entered before the talk, never on the projector. The key dialog shows **valid**, and the key is restricted ([README](../README.md#bring-your-own-key)).
- [ ] The key works for **⚡** and **🛠️**: run chips `1` and `2` once. Argon needs billing and isn't used on stage.
- [ ] Notifications off, other tabs closed, browser zoom set, theme chosen.

### Five minutes before

- [ ] `Shift+R` so the seed deals, history, packets and transcript are clean.
- [ ] Console closed, inspector closed, dashboard on **Overview**.
- [ ] Press `` ` `` once to confirm the inspector lists **8 tools**, then close it.

## If something goes wrong

There is no mock fallback by design. Stay in the story.

| Symptom                            | Do                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| The agent is going the wrong way   | **Stop**, `Shift+R`, run the chip again                                               |
| Act 3 self-corrects early or never | Keep going; the Lab measures the rate. Show the packets                               |
| Quota or rate-limit error card     | Wait a moment and re-run, or switch the model in the key dialog                       |
| `auth` error card                  | Press the card's button to reopen the key dialog and paste the key again              |
| `model-access` error card          | Press the card's button to go back to the default model                               |
| Slow network                       | Switch to tethering. Use ⚡ for latency-sensitive beats                               |
| The tools list is empty            | Check the chip. If it says `polyfill`, the flag is off; enable it and relaunch Chrome |
| A dialog is stuck                  | **Stop** counts as a rejection and closes it                                          |
