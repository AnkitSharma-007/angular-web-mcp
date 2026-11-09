export interface Change<T> {
  id: string;
  before: T;
  after: T;
}

export interface Skip {
  id: string;
  why: string;
}

export interface MutationResult<T> {
  changed: Change<T>[];
  skipped: Skip[];
}
