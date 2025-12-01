import cron from "node-cron";
import scraper from "./index.js";
import { logError } from "./lib/logger.js";
import { initSentry } from "./lib/sentry.js";

// Initialize Sentry if DSN is provided
initSentry();

// Cron job to run - default every hour
cron.schedule(process?.env?.CRONJOB_SCHEDULE || "1 * * * *", () => {
  console.log("Starting scheduled task at " + new Date());
  scraper()
    .then(() => console.log("Scheduled task completed"))
    .catch((err) => {
      logError(err);
    });
});
