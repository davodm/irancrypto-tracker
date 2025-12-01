## 🚀 IranCrypto.Market Tracker

Lightweight **Node.js scraper** that collects cryptocurrency prices and volumes from multiple Iranian exchanges and stores standardized records in **MongoDB**.

### ✨ Key Features

  * **Modular Architecture**: Each exchange is handled by an isolated module in `src/scrappers`, simplifying maintenance and the addition of new sources.
  * **Dual Run Modes**: Supports a single-run mode for development (`npm run dev`) and a long-running **cron worker** for production (`npm start`).
  * **Resilient Networking**: Configurable HTTP request retries with **exponential backoff** for handling transient failures.
  * **Standardized Output**: All collected data is normalized into a consistent JSON format before storage.

-----

## 🛠️ Setup

### Prerequisites

  * **Node.js** (v18 or later)
  * **npm** (v7 or later)

### Installation

1.  **Clone the Repository**

    ```bash
    git clone https://github.com/davodm/irancrypto-market-tracker.git
    cd irancrypto-market-tracker
    ```

2.  **Install Dependencies**

    ```bash
    npm install
    ```

3.  **Configuration**

    Export the required **environment variables** (e.g., `MONGO_URI`, `CRONJOB_SCHEDULE`) for production, or create a local `.env` file for development. Refer to the **`.env.example`** file for all required settings.

-----

## 🏃 Usage

The project offers two primary modes of operation, managed via `npm` scripts.

### Production (Long-Running Cron Worker)

Starts the long-running worker (`src/cron.js`) that executes scheduled jobs according to the `CRONJOB_SCHEDULE` environment variable (default: hourly).

```bash
npm start
```

### Development / One-Shot Execution

Runs the main scraper once (`src/dev.js`) and exits. This mode is ideal for local testing and debugging.

```bash
npm run dev
```

-----

## ⚙️ Configuration Variables

The tracker's behavior is entirely controlled via environment variables.

| Variable | Description | Default | Notes |
| :--- | :--- | :--- | :--- |
| `MONGO_URI` | **Required.** MongoDB connection string. | N/A | |
| `CRONJOB_SCHEDULE` | Cron expression for the worker schedule. | `0 * * * *` (Hourly) | Used by `npm start` worker. |
| `REQUEST_RETRY_COUNT` | Number of retries on failed HTTP requests. | `0` (No retries) | Does not include the initial attempt. |
| `REQUEST_RETRY_BASE_MS` | Base delay (in ms) for exponential backoff. | `300` | |
| `IGNORE_EXCHANGES` | Comma-separated list of exchange slugs to skip. | N/A | Example: `nobitex,bitmax`. |
| `RUN_ONCE` | If set to `true`, the cron worker exits on error. | `false` | Useful for host schedulers that require process exit on failure. |
| `SENTRY_DSN` | Optional DSN for Sentry error reporting. | N/A | |

-----

## 🧩 Writing Scrapers

To integrate a new exchange, add a new JavaScript module to the **`src/scrappers`** directory.

Each module must:

1.  Export an `async function scrape($coins)` that returns an array of standardized data records.
2.  Export a `PLATFORM` constant (matching the file slug).
3.  Export a `COIN_USE` constant (`'own'`, `'all'`, or `'none'`).

Use the internal helper functions:

  * `axiosRequest()` (from `src/lib/request.js`) for resilient HTTP calls with built-in retries.
  * `num()` (from `src/lib/num.js`) for reliable numeric parsing.

-----

## 🤝 Contribution

Contributions are welcome\! Please refer to the **`CONTRIBUTING.md`** file for detailed guidelines on setting up your environment, code style, and submitting pull requests.
