import cron from "node-cron";
import scraper from "./index.js";
import { logError, logInfo } from "./lib/logger.js";
import { initSentry } from "./lib/sentry.js";

// Initialize Sentry if DSN is provided
initSentry();

const scheduleExpr = process?.env?.CRONJOB_SCHEDULE || "1 * * * *";

async function runScraper() {
  const startTime = new Date();
  logInfo(`Starting scheduled task at ${startTime.toString()}`);
  try {
    await scraper();
    logInfo(`Scheduled task completed`);
  } catch (err) {
    logError(err);
    // If this process is expected to run once (common for host schedulers), exit with non-zero code
    if (process.env.RUN_ONCE === "true") {
      process.exit(1);
    }
  }
}

// Schedule regular runs (keeps process alive in long-running deployments)
cron.schedule(scheduleExpr, () => {
  runScraper();
});

// Also run immediately on startup so one-shot deployments (host scheduler that runs `npm start`) work
// For development/one-shot runs use `src/dev.js` which calls `main()` once and exits.
// The cron worker will only run scheduled jobs to avoid dual behaviors in deployment.
