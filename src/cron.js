import cron from "node-cron";
import process from "./index.js";
import { logError } from "./lib/logger.js";

// Cron job to run every an hour
cron.schedule("0 * * * *", () => {
  logInfo("Starting scheduled task at " + new Date());
  process()
    .then(() => logInfo("Scheduled task completed"))
    .catch((err) => {
      logError(err);
    });
});
