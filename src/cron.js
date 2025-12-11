import cron from "node-cron";
import scraper from "./index.js";
import { logError, logInfo } from "./lib/logger.js";
import { initSentry } from "./lib/sentry.js";
import { connectToMongoDB, closeConnection } from "./lib/mongodb.js";

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
    if (process.env.RUN_ONCE === "true") {
      process.exit(1);
    }
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logInfo("SIGTERM received, shutting down...");
  await closeConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logInfo("SIGINT received, shutting down...");
  await closeConnection();
  process.exit(0);
});

// Start: connect to MongoDB first, then schedule cron
(async () => {
  try {
    await connectToMongoDB();
    logInfo("MongoDB connection established");

    logInfo(`Cron job scheduled with pattern: ${scheduleExpr}`);
    cron.schedule(scheduleExpr, () => runScraper());
  } catch (err) {
    logError(`Failed to start: ${err.message}`);
    process.exit(1);
  }
})();
