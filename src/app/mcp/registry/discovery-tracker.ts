import { Service } from '@angular/core';

/** Lets code outside the gateway wait until every started tool-discovery read has been applied. */
@Service()
export class DiscoveryTracker {
  private readonly inflight = new Set<Promise<unknown>>();

  track(work: Promise<unknown>): void {
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
  }

  async idle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }
}
