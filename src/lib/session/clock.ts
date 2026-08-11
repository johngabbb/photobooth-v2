/**
 * Clock offset estimation between two devices.
 *
 * Two phones do not agree on the time. Their wall clocks can differ by seconds, and
 * the network delay between them is both unknown and variable. Broadcasting "shoot
 * now" therefore produces two captures separated by one network latency — visibly
 * different moments if either person is moving.
 *
 * The fix is the same idea NTP uses, minus the sophistication we do not need:
 *
 *   guest sends    t0 (guest clock)
 *   host replies   t1 (host clock)
 *   guest receives t3 (guest clock)
 *
 *   rtt    = t3 - t0
 *   offset = t1 - (t0 + rtt / 2)
 *
 * The estimate assumes the trip took equally long each way. That is false in
 * general, and the error is exactly the asymmetry — which is why we keep the sample
 * with the **lowest round-trip time** rather than averaging. A fast round trip had
 * little room to be lopsided; a slow one is mostly queueing, and averaging lets that
 * noise contaminate a good reading.
 *
 * Only the guest computes an offset. The host's clock is the reference by
 * definition, so its own offset is zero and it needs none of this.
 */

export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

export interface ClockSync {
  /** Add to a guest-local timestamp to get host time; subtract to go the other way. */
  offsetMs: number;
  /** Round-trip time of the sample the offset came from. */
  rttMs: number;
  samples: number;
  /** True once at least one sample has landed. */
  synced: boolean;
}

export const UNSYNCED: ClockSync = {
  offsetMs: 0,
  rttMs: 0,
  samples: 0,
  synced: false,
};

/** The host is its own reference: no correction, nothing to measure. */
export const HOST_CLOCK: ClockSync = {
  offsetMs: 0,
  rttMs: 0,
  samples: 1,
  synced: true,
};

export function sampleFrom(t0: number, t1: number, t3: number): ClockSample {
  const rttMs = t3 - t0;
  return { offsetMs: t1 - (t0 + rttMs / 2), rttMs };
}

/**
 * Fold a new sample into the running estimate, keeping the best one seen.
 *
 * "Best" is lowest RTT, for the reason above. The count still increments on every
 * sample so the UI can show that syncing is progressing even when the estimate is
 * not moving.
 */
export function refine(current: ClockSync, sample: ClockSample): ClockSync {
  const better = !current.synced || sample.rttMs < current.rttMs;

  return {
    offsetMs: better ? sample.offsetMs : current.offsetMs,
    rttMs: better ? sample.rttMs : current.rttMs,
    samples: current.samples + 1,
    synced: true,
  };
}

/** Convert a host-clock instant into this device's local clock. */
export function toLocalTime(hostTime: number, clock: ClockSync): number {
  return hostTime - clock.offsetMs;
}

/** Convert a local instant into host-clock terms. */
export function toHostTime(localTime: number, clock: ClockSync): number {
  return localTime + clock.offsetMs;
}

/** How many probes to send when establishing sync. */
export const PING_COUNT = 5;
export const PING_INTERVAL_MS = 220;
