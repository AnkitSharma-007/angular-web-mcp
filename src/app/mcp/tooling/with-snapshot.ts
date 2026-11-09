export interface Snapshotter {
  recordSnapshot(label: string): string;
}

export interface SnapshotPlan<A> {
  target: Snapshotter;
  label: (args: A) => string;
}

/** Records a restore point on the target store; returns the snapshot id. */
export function takeSnapshot<A>(plan: SnapshotPlan<A>, args: A): string {
  return plan.target.recordSnapshot(plan.label(args));
}
