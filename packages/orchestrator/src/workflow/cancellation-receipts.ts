import type {
  CancellationObservation,
  CancellationReceipt
} from "../cancellation.js";

/**
 * The first-response observation behind each cancellation receipt this
 * runner issued. Weakly held, so an abandoned receipt releases it.
 */
export class CancellationReceipts {
  private readonly observations = new WeakMap<
    CancellationReceipt,
    CancellationObservation
  >();

  record(
    receipt: CancellationReceipt,
    observation: CancellationObservation
  ): void {
    this.observations.set(receipt, observation);
  }

  observation(
    receipt: CancellationReceipt
  ): CancellationObservation | undefined {
    return this.observations.get(receipt);
  }
}
