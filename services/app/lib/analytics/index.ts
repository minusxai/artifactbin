/** The analytics module's interface: canonical usage telemetry and retained-log view counts. */
export { flushViews, recordView, trackEvent } from './events';
export { eventsTablePresent, forgetEventsTable } from './log';
export { viewSeriesFor, viewTotalsFor } from './view-totals';
