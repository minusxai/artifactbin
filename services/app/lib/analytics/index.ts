/** The analytics module's interface: usage telemetry (counter rows and log sentences) and the all-time view totals read from it. */
export { flushViews, recordView, trackEvent } from './events';
export { viewTotalsFor } from './view-totals';
