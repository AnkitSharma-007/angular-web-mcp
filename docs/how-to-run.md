# How to run the demo

> Requires desktop **Chrome 158 or newer** with `chrome://flags/#enable-webmcp-testing` enabled, and **your own Gemini API key**. Other browsers and setups are not supported.

Open the live app: <https://angular-web-mcp.vercel.app/dashboard>

Written against Angular 22.2.5 and Chrome 158 (2026-11-10). WebMCP is experimental, so names and behaviour can change.

This is both the visitor guide and the stage run-sheet for the conference talk.

## WebMCP basics

**WebMCP** is a browser API that lets a web page publish **tools** for AI agents. A tool is a name, a description, an input schema and a function. An agent in the browser lists the tools on `document.modelContext`, picks one, and the page runs it.

- **No server in the middle.** The tool is your page's own code, running in the user's session. Nothing is deployed or proxied.
- **Tools follow the UI.** A tool exists while the code that registered it is alive. Leave the page, or close the form, and the tool disappears. The browser fires a `toolchange` event each time.
- **Agents only see what you publish.** The in-app agent here and Chrome's own agent see the same list.

This app, a small sales CRM with fictional data, registers tools in the three ways Angular offers:

| Style       | Angular API                                           | Where                                                                                                                                                  | Tools                                                           |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Route       | `provideExperimentalWebMcpTools`                      | [dashboard.routes.ts](../src/app/features/dashboard/dashboard.routes.ts)                                                                               | `getPipelineSummary`, `searchDeals`, `getDealDetails`           |
| Store       | `withWebMcpTools()` (this repo's SignalStore feature) | [deals-store.ts](../src/app/features/dashboard/data/deals-store.ts), [dashboard-ui-store.ts](../src/app/features/dashboard/data/dashboard-ui-store.ts) | `applyBatchDiscount`, `terminateContract`, `openProposalDrawer` |
| Signal Form | `experimentalWebMcpTool` on a form                    | [proposal-drawer.ts](../src/app/features/proposal/proposal-drawer.ts)                                                                                  | `draftDealProposal`, only while the drawer is open              |

Tools that change data go through `defineTool()`, which checks the arguments, can pause for a human **approval**, and takes an **undo** snapshot before running.

## Before you start

1. **Check the browser.** If the app shows **Your browser doesn't support WebMCP**, follow the three steps on that page (Chrome 158+, the flag, relaunch). Otherwise you're ready.
2. **Add your key.** Click the **key** icon in the toolbar, paste a Gemini API key from [AI Studio](https://aistudio.google.com/apikey), keep the default model, and press **Save**. The dialog shows **valid** when Google accepts the key. The key stays in your browser. Restrict it as described in the [README](../README.md#bring-your-own-key).
3. **Open the tools.** Click **Agent console** (top right of the dashboard) and press `` ` `` to open the **wire inspector**.

### Controls

| Key / control           | What it does                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1` `2` `3`             | Fill the matching act prompt into the console, open it and focus the composer. Press **Enter** to run it                                                      |
| Clicking a chip         | Runs that act's prompt at once, on the chip's model                                                                                                           |
| `` ` ``                 | Open or close the wire inspector                                                                                                                              |
| `Shift+R`               | Reset: the seed deals, empty history, empty packets, empty transcript, proposal drawer closed                                                                 |
| **Stop** in the console | Aborts the agent, any open approval (it counts as a rejection) and the request in flight. The approval dialog covers it, so use **Reject** or `Shift+R` there |
| `Esc`                   | Closes the wire inspector or the proposal drawer, while focus is inside it                                                                                    |

Keys are ignored while focus is in a text field. After typing in the console, click the page background (or press `Tab` away) before using `1`–`3`.

Models: **⚡ Sprinter** `gemini-3.5-flash-lite` for Act 1, **🛠️ Operator** `gemini-3.8-flash` for Acts 2 and 3.

## Order of the demo

| Beat                   | Do                                                               |
| ---------------------- | ---------------------------------------------------------------- |
| Cold open              | Inspector → Tools tab, then `/about` and back                    |
| Act 1 · Context ⚡     | `1`, Enter                                                       |
| Act 2 · Signal Form 🛠️ | `2`, Enter                                                       |
| Act 3 · Governance 🛠️  | `3`, Enter, approve, reject, undo                                |
| Hand back              | Leave the inspector open on the packets and return to the slides |

If you are short of time, drop the undo at the end of Act 3, not the approvals.

## 1. Cold open: tools belong to the route

| Do                                       | You should see                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| In the inspector, open the **Tools** tab | **6 tools registered**: the three read tools, `applyBatchDiscount`, `terminateContract` and `openProposalDrawer` |
| Click **About** in the top bar           | **0 tools registered**                                                                                           |
| Click **Dashboard**                      | The 6 tools are back, each with a **New** badge                                                                  |

**Say:** the tools belong to the route. When Angular destroys the route injector, its `DestroyRef` aborts the registration signals and the browser fires `toolchange`.

## 2. Act 1: Context, read tools

Press `1`, then **Enter**. The prompt is: _Give me a pipeline summary — where are we exposed this quarter?_

| You should see                                                                                                                      | Why it matters                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The badge **⚡ Sprinter**, a collapsed **Thinking** block, then one or two tool calls (`getPipelineSummary`, usually `searchDeals`) | The agent discovers and calls tools it was never hard-coded to know |
| An answer naming the stalled accounts. Nothing on the dashboard changes                                                             | Read tools are marked `readOnlyHint`                                |
| In the inspector **Packets** tab, a packet per call with latency, tokens and cost                                                   | Every call is observable                                            |

**Say:** the agent only sees what `document.modelContext` shows it, the same as Chrome's own agent. Every call is a packet in the inspector.

**If it slips:** the model answers from the summary alone. That's fine; point at the packets and move on.

## 3. Act 2: Signal Form, a tool that appears

Press `2`, then **Enter**. The prompt is: _Draft a 24-month Enterprise renewal for Konkan Freight, 250 seats, starting mid-December._ This is the slowest act, so narrate the thinking and the tool list while you wait.

| You should see                                                                   | Why it matters                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The proposal drawer slides open                                                  | `openProposalDrawer` changed the UI                               |
| In the **Tools** tab, `draftDealProposal` appears with a **New** badge (7 tools) | Nobody wrote this tool. Angular generated it from the Signal Form |
| The fields fill in, then **Draft P-0001 saved for Konkan Freight**               | The agent filled the same form a human would                      |

**Say:** the schema Angular generates carries types only, so the rules live in the tool description and in the validators.

The form requires the start date to be the **1st of a month** (billing cycle), and mid-December breaks that rule. **Do not promise the failure.** In the 2026-11-10 sweep the model fixed it on its own in 5 of 6 paraphrase runs but in none of the 4 runs of this exact prompt. If it picks the 1st straight away, say so and move on. If it fails first, say "watch it fix itself".

Press `Esc` to close the drawer; the tool disappears (back to 6).

## 4. Act 3: Governance, a human stays in charge

Press `3`, then **Enter**. The prompt is: _End of quarter: give Arcadia Bank 25% off and terminate the Monsoon Retail contract._

| Do                                                                                   | You should see                                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Wait for the first dialog                                                            | **High-impact action**: a 25% discount, the policy flag (over the 15% limit) and a before/after row |
| Press **Approve**                                                                    | The discount applies. Arcadia Bank shows 25% in the table                                           |
| Wait for the second dialog                                                           | **Critical action**: terminate the Monsoon Retail contract                                          |
| Type a short note and press **Reject**                                               | The agent reports that the termination was rejected. The Monsoon contract stays active              |
| Click **Undo** in the snackbar (8 seconds), or **Undo to here** in **Agent changes** | The discount reverts and the chart rolls back                                                       |

**Say:** the approval gate lives inside the tool, so it protects any agent, not only this one. A rejection comes back as a normal result, so the model adapts instead of failing. There is no "undo" tool: only a human can undo. A discount of 15% or less runs without a dialog; that is policy, and it lives on a slide.

## 5. Hand back

Leave the inspector open on **Packets** (channel, latency, tokens, cost). JSON-RPC framing there is a display convention; WebMCP itself is an in-page API, so say so. The registration styles and the change history are on the slides, not in the demo.

## Try your own prompts

The agent can use any registered tool. Some to try:

- _Which three deals should I prioritise this week?_
- _What is the contact email for Orion Pharma?_ (uses `getDealDetails`)
- _Give D-1002 a 10% discount._ (runs without a dialog: 15% or less and a small impact need no approval)

Press `Shift+R` to reset the data between tries. A typical Operator run costs about $0.01–0.03, and the console shows each run's tokens and cost.

## If something looks wrong

There is no mock fallback by design. On stage, stay in the story.

| Symptom                                               | Fix                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app shows **Your browser doesn't support WebMCP** | Use Chrome 158+, enable the flag and relaunch Chrome                                                                                                                      |
| The agent is going the wrong way                      | **Stop**, `Shift+R`, run the act again                                                                                                                                    |
| Act 2 self-corrects early or never                    | Keep going and show the packets                                                                                                                                           |
| No response for 45 seconds (network error card)       | Show what already happened (the drawer, the packets), press `Shift+R` and move to the next act. Don't re-run on stage                                                     |
| A quota or rate-limit card                            | Wait a moment and run again, or switch the model in the key dialog                                                                                                        |
| An **auth** error card                                | Press its button and paste the key again                                                                                                                                  |
| A `model-access` error card                           | Press its button to go back to the default model                                                                                                                          |
| Slow network                                          | Switch to tethering. Use ⚡ for latency-sensitive beats                                                                                                                   |
| A dialog is stuck open                                | Click **Reject** (the agent answers once and stops), or press `Shift+R` to abandon the run. Console **Stop** is behind the dialog. `Shift+R` types an R in the note field |

## Run it locally

```bash
npm ci
npm start   # http://localhost:4200, Node 24.18 or newer
```

Then follow the same steps. See the [README](../README.md) for the architecture and the reusable patterns.
