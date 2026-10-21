import { appendFileSync } from "node:fs";
import { workflowTiming } from "./timing.js";
const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GH_TOKEN, GITHUB_STEP_SUMMARY } = process.env;
const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" } });
if (!response.ok) throw Error(`Cannot read attempt timing: HTTP ${response.status}`);
const attempt = await response.json();
const observedAt = new Date().toISOString();
const execution = workflowTiming(attempt.run_started_at, observedAt);
const submission = workflowTiming(attempt.created_at, observedAt);
const beforeStart = workflowTiming(attempt.created_at, attempt.run_started_at).elapsedSeconds;
const initialAttempt = Number(GITHUB_RUN_ATTEMPT) === 1;
// Observation only: the merge target requires actual completion times of both fast checks.
const elapsed = (timing) => `${timing.elapsedSeconds.toFixed(1)}s`;
const message = `Submission through check rollup report: ${elapsed(submission)}. Elapsed observation, not completion of both fast merge checks; later work is excluded.\nCurrent attempt execution through report: ${elapsed(execution)}. ${initialAttempt ? "Initial queue" : "Previous attempts and waiting before this attempt"}: ${beforeStart.toFixed(1)}s.\n`;
console.log(message);
if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, message);
