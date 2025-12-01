import main from "./index.js";
import { initSentry } from "./lib/sentry.js";

// Initialize Sentry if DSN is provided
initSentry();

main()
  .then(() => {
    console.log("-Dev Run Completed-");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Dev run failed:", error);
    process.exit(1);
  });