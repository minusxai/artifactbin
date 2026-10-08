/** Resolves after `ms` milliseconds: the one wait every gate script shares. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
