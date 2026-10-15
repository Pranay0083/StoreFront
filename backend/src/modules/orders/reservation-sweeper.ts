/** Releases stock held by unpaid orders once their payment window passes. */
export interface ReservationExpiryScheduler {
  start(): void;
  stop(): Promise<void>;
  sweep(now?: Date): Promise<number>;
}
