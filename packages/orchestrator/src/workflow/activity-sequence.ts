/** Progress activity identifiers for one runner: `activity-1` first. */
export class ActivitySequence {
  private count = 0;

  next(): string {
    return `activity-${++this.count}`;
  }
}
