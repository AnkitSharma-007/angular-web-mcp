import { TestBed } from '@angular/core/testing';
import { provideExperimentalWebMcpForms } from '@angular/forms/signals';
import { provideRouter } from '@angular/router';
import { useFakeModelContext } from '../../../testing/test-providers';
import { AgentSessionStore } from '../../mcp/agent/agent-session-store';
import { GeminiAgent, type AgentRunOptions } from '../../mcp/agent/gemini/gemini-agent';
import { DashboardShell } from './dashboard-shell';
import { DashboardUiStore } from './data/dashboard-ui-store';
import { DealsStore } from './data/deals-store';
import { ProposalsStore } from '../proposal/proposals-store';

describe('DashboardShell lifecycle', () => {
  useFakeModelContext();

  beforeAll(() => import('../../mcp/agent/gemini/gemini-agent'));

  it('stops a running agent session when the dashboard is left', async () => {
    let signal: AbortSignal | undefined;
    TestBed.configureTestingModule({
      providers: [
        DealsStore,
        DashboardUiStore,
        ProposalsStore,
        provideExperimentalWebMcpForms(),
        provideRouter([]),
        {
          provide: GeminiAgent,
          useValue: {
            run: (_prompt: string, options: AgentRunOptions) => {
              signal = options.signal;
              return (async function* () {
                await new Promise<void>((resolve) =>
                  options.signal.addEventListener('abort', () => resolve(), { once: true }),
                );
              })();
            },
          },
        },
      ],
    });
    const shell = TestBed.createComponent(DashboardShell);
    shell.detectChanges();
    const session = TestBed.inject(AgentSessionStore);

    void session.run('hello');
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    shell.destroy();
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(session.running()).toBe(false));
  });
});
