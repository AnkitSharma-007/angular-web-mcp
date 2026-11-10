# Stage run-sheet

The live demo for Google DevFest Mumbai: 9 minutes inside a 30-minute session (15 minutes of slides before it, 5 minutes of Q&A after it). All live, no recorded fallback.
The slides carry the concepts. The demo only proves them, so nothing here is explained twice.

## Controls on stage

| Key / control           | What it does                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1` `2` `3`             | Fill the matching act prompt into the console, open it and focus the composer. Press **Enter** to run it                                                      |
| Clicking a chip         | Runs that act's prompt at once, on the chip's model                                                                                                           |
| `` ` ``                 | Open or close the wire inspector                                                                                                                              |
| `Shift+R`               | Reset: the seed deals, empty history, empty packets, empty transcript, proposal drawer closed                                                                 |
| **Stop** in the console | Aborts the agent, any open approval (it counts as a rejection) and the request in flight. The approval dialog covers it, so use **Reject** or `Shift+R` there |
| `Esc`                   | Closes the wire inspector or the proposal drawer, while focus is inside it                                                                                    |

Hotkeys are ignored while focus is in a text field. After typing in the console, click the page background (or press `Tab` away) before using `1`–`3`.

Models: **⚡ Sprinter** `gemini-3.5-flash-lite` for Act 1, **🛠️ Operator** `gemini-3.8-flash` for Acts 2 and 3.

## The arc

| Time      | Beat                   | Do                                                               |
| --------- | ---------------------- | ---------------------------------------------------------------- |
| 0:00–1:00 | Cold open              | Inspector → Tools tab, then `/about` and back                    |
| 1:00–2:30 | Act 1 · Context ⚡     | `1`, Enter                                                       |
| 2:30–5:30 | Act 2 · Signal Form 🛠️ | `2`, Enter                                                       |
| 5:30–8:30 | Act 3 · Governance 🛠️  | `3`, Enter, approve, reject, undo                                |
| 8:30–9:00 | Hand back              | Leave the inspector open on the packets and return to the slides |

Plan for 8 minutes of demo so the hand-over to Q&A has some slack. If you are running late, drop the undo at the end of Act 3, not the approvals.

### Cold open (0:00–1:00)

1. Dashboard is up, console closed. Point at the toolbar chip: **WebMCP: native**.
2. Press `` ` `` and open the **Tools** tab: **6 tools registered**. Three read tools, two mutation tools, one UI tool.
3. Click **About** in the top bar. The Tools tab drops to **0 tools registered**.
4. Click **Dashboard**. The 6 tools return, each with a **New** badge.

Say: the tools belong to the route. When Angular destroys the route injector, its `DestroyRef` aborts the registration signals and the browser fires `toolchange`.

### Act 1 · Context ⚡ (1:00–2:30)

- **Prompt:** "Give me a pipeline summary — where are we exposed this quarter?"
- **Tools:** `getPipelineSummary` → `searchDeals` (stalled deals).
- **Expect:**
  - The model badge reads **⚡ Sprinter**.
  - A collapsed **Thinking** block streams, then one or two tool-call / tool-result pairs. The run takes about 3 seconds.
  - The answer names the stalled accounts. Nothing on the dashboard changes.
- **Say:** the agent only sees what `document.modelContext` shows it, the same as Chrome's own agent. Every call is a packet in the inspector.
- **If it slips:** it answers from the summary alone. Fine; point at the packets and move on.

### Act 2 · Signal Form 🛠️ (2:30–5:30)

- **Prompt:** "Draft a 24-month Enterprise renewal for Konkan Freight, 250 seats, starting mid-December."
- **Tools:** `openProposalDrawer` → _toolchange_ → `draftDealProposal`, and sometimes ✗ → ✓.
- **Expect:**
  - The proposal drawer slides in. In the inspector **Tools** tab, `draftDealProposal` appears with a **New** badge (7 tools).
  - Fields glow as they fill, and the drawer shows **Draft P-0001 saved for Konkan Freight**.
  - The run takes about 25–35 seconds. Narrate the thinking and the tool list while you wait.
- **Say:** this tool was never written. Angular inferred it from a Signal Form. The schema carries types only, so the rules live in the tool description and in the validators.
- **Do not promise the failure.** The start date must be the 1st of a month (billing cycle), and mid-December breaks that rule. In the 2026-11-10 sweep the model fixed it on its own in 5 of 6 paraphrase runs but on none of the 4 stage-prompt runs. If it picks the 1st straight away, say so and move on. If it fails first, say "watch it fix itself".
- **If Gemini stalls** (no response for 45 s): the draft may already be saved. Show the drawer and the packets, then press `Shift+R` and go on to Act 3.
- Close the drawer with `Esc` before Act 3.

### Act 3 · Governance 🛠️ (5:30–8:30)

- **Prompt:** "End of quarter: give Arcadia Bank 25% off and terminate the Monsoon Retail contract."
- **Tools:** `applyBatchDiscount` ⏸ **Approve**, then `terminateContract` ⏸ **Reject**.
- **Expect:**
  - Dialog 1, **High-impact action**: a 25% discount with the policy flag and a before/after row. Press **Approve**.
  - Dialog 2, **Critical action**: terminate the Monsoon Retail contract. Type a short note and press **Reject**.
  - The agent says the termination was rejected and the contract stays active. Arcadia Bank shows 25%.
- **Undo:** click **Undo** in the snackbar (it stays for 8 seconds) or **Undo to here** in **Agent changes**. The chart rolls back.
- **Say:** the gate sits inside the tool, so it protects external agents too. A rejection is a result, not an error, so the model adapts. There is no undo tool: only the human can undo. A discount of 15% or less runs without a dialog; that is policy, and it lives on a slide.

### Hand back (8:30–9:00)

Leave the inspector open on **Packets** (channel, latency, tokens, cost). JSON-RPC framing there is a display convention; WebMCP itself is an in-page API, so say so. The registration styles (`provideExperimentalWebMcpTools` on a route, `withWebMcpTools()` on a store, a Signal Form's `experimentalWebMcpTool`) and the change history are on the slides, not in the demo.

## Pre-flight

### Days before

- [ ] **Re-verify the experimental APIs** a week out: `@angular/*` 22.2.5, `@angular/forms/signals`, `@mcp-b/webmcp-polyfill`, Chrome 158. Pins are exact, so nothing moves unless you move it.
- [ ] **Freeze** prompts, tool descriptions, the system prompt and model IDs about 5 days before.
- [ ] **Sign-off:** Lab → **Evals**, 10 runs per act on ⚡ (Act 1) and 🛠️ (Acts 2 and 3). Each act needs **at least 9/10** and a p90 inside its time slot (1:30, 3:00 and 3:00). Cost is under about $1 for the sweep.
- [ ] Copy the rows from **Build log rows** into [eval-log.md](eval-log.md).
- [ ] **Lighthouse** accessibility. The unit tests skip colour contrast, so this is where it gets checked.
- [ ] **Production build once:** `npm run build`, serve `dist/angular-web-mcp/browser` with a single-page-app fallback (for example `npx serve -s dist/angular-web-mcp/browser`) and check the console for CSP violations.
- [ ] **Live API once:** the unit tests use a fake Gemini. Run all three chips against a real key and confirm the model IDs and `thinkingLevel` are accepted.

### The day before and the morning of

- [ ] Re-run the sign-off sweep the day before, and again on the venue Wi-Fi in the morning.
- [ ] **Tethering** is ready as the network fallback.
- [ ] **Chrome 158.0.8127.18** with `chrome://flags/#enable-webmcp-testing` enabled and Chrome relaunched.
- [ ] The toolbar chip reads **WebMCP: native** (not `polyfill` or `shim`).
- [ ] **API key** entered before the talk, never on the projector. The key dialog shows **valid**, and the key is restricted ([README](../README.md#bring-your-own-key)).
- [ ] The key works for **⚡** and **🛠️**: run chips `1`, `2` and `3` once.
- [ ] Notifications off, other tabs closed, browser zoom set.

### Five minutes before

- [ ] `Shift+R` so the seed deals, history, packets and transcript are clean.
- [ ] Console closed, inspector closed, dashboard on **Overview**.
- [ ] Press `` ` `` once to confirm the inspector lists **6 tools**, then close it.

## If something goes wrong

There is no mock fallback by design. Stay in the story.

| Symptom                                  | Do                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent is going the wrong way         | **Stop**, `Shift+R`, run the chip again                                                                                                                                               |
| Act 2 self-corrects early or never       | Keep going; the Lab measures the rate. Show the packets                                                                                                                               |
| Gemini stalls (45 s, network error card) | Show what already happened (the drawer, the packets), press `Shift+R` and move to the next act. Do not re-run on stage                                                                |
| Quota or rate-limit error card           | Wait a moment and re-run, or switch the model in the key dialog                                                                                                                       |
| `auth` error card                        | Press the card's button to reopen the key dialog and paste the key again                                                                                                              |
| `model-access` error card                | Press the card's button to go back to the default model                                                                                                                               |
| Slow network                             | Switch to tethering. Use ⚡ for latency-sensitive beats                                                                                                                               |
| The tools list is empty                  | Check the chip. If it says `polyfill`, the flag is off; enable it and relaunch Chrome                                                                                                 |
| A dialog is stuck                        | Click **Reject** (the agent answers once and stops), or press `Shift+R` to abandon the run. Console **Stop** is behind the dialog. `Shift+R` types an R if focus is in the note field |
