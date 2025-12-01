import cron from "node-cron";
import scraper from "./index.js";
import { logError, logInfo } from "./lib/logger.js";
import { initSentry } from "./lib/sentry.js";
import { connectToMongoDB, closeConnection } from "./lib/mongodb.js";

// Initialize Sentry if DSN is provided
initSentry();

// Connect to MongoDB on startup
connectToMongoDB()
  .then(() => {
    logInfo("MongoDB connection established");
  })
  .catch((err) => {
    logError(`Failed to connect to MongoDB: ${err.message}`);
    process.exit(1);
  });

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
logInfo(`Cron job scheduled with pattern: ${scheduleExpr}`);
cron.schedule(scheduleExpr, () => {
  runScraper();
});

// Keep the process alive and handle graceful shutdown
logInfo("Cron job scheduler started. Process will keep running...");

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logInfo("SIGTERM received, shutting down gracefully...");
  await closeConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logInfo("SIGINT received, shutting down gracefully...");
  await closeConnection();
  process.exit(0);
});

// Keep process alive
process.stdin.resume();
