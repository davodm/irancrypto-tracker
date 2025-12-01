## 🚀 IranCrypto.Market Tracker

Lightweight **Node.js scraper** that collects cryptocurrency prices and volumes from multiple Iranian exchanges and stores standardized records in **MongoDB**.

### ✨ Key Features

  * **Modular Architecture**: Each exchange is handled by an isolated module in `src/scrappers`, simplifying maintenance and the addition of new sources.
  * **Dual Run Modes**: Supports a single-run mode for development (`npm run dev`) and a long-running **cron worker** for production (`npm start`).
  * **Resilient Networking**: Configurable HTTP request retries with **exponential backoff** for handling transient failures.
  * **Standardized Output**: All collected data is normalized into a consistent JSON format before storage.
  * **Error Tracking**: Optional integration with Sentry for error monitoring and reporting.

-----

## 🛠️ Setup

### Prerequisites

  * **Node.js** (v18 or later)
  * **npm** (v9 or later)
  * **MongoDB** database (local or remote)

### Installation

1.  **Clone the Repository**

    ```bash
    git clone https://github.com/davodm/irancrypto-tracker.git
    cd irancrypto-tracker
    ```

2.  **Install Dependencies**

    ```bash
    npm install
    ```

3.  **Configuration**

    For **local development**, create a `.env` file in the project root with your environment variables. The `npm run dev` command automatically loads variables from `.env` using `dotenv`.

    For **production**, export the required environment variables directly or use your deployment platform's environment variable configuration.

    > **Note**: See the [Configuration Variables](#-configuration-variables) section below for all available options. A `.env.example` file may be available in the repository as a template.

-----

## 🏃 Usage

The project offers two primary modes of operation, managed via `npm` scripts.

### Production (Long-Running Cron Worker)

Starts the long-running worker (`src/cron.js`) that executes scheduled jobs according to the `CRONJOB_SCHEDULE` environment variable. The process stays alive and runs jobs on schedule.

```bash
npm start
```

### Development / One-Shot Execution

Runs the main scraper once (`src/dev.js`) and exits. This mode is ideal for local testing and debugging. Automatically loads environment variables from `.env` file.

```bash
npm run dev
```

-----

## ⚙️ Configuration Variables

The tracker's behavior is entirely controlled via environment variables.

| Variable | Required | Description | Default | Notes |
| :--- | :---: | :--- | :--- | :--- |
| `MONGO_URI` | ✅ | MongoDB connection string. | N/A | Example: `mongodb://localhost:27017` or `mongodb+srv://user:pass@cluster.mongodb.net` |
| `MONGO_DBNAME` | ✅ | Name of the MongoDB database to use. | N/A | Example: `irancrypto` |
| `CRONJOB_SCHEDULE` | ❌ | Cron expression for the worker schedule. | `1 * * * *` (Hourly at minute 1) | Used by `npm start` worker. See [cron expression format](https://crontab.guru/). |
| `NODE_ENV` | ❌ | Node.js environment. | `development` | Used by Sentry and logging. Common values: `development`, `production`. |
| `REQUEST_RETRY_COUNT` | ❌ | Number of retries on failed HTTP requests. | `0` (No retries) | Does not include the initial attempt. |
| `REQUEST_RETRY_BASE_MS` | ❌ | Base delay (in ms) for exponential backoff. | `300` | Delay doubles with each retry attempt. |
| `TIMEOUT` | ❌ | HTTP request timeout in seconds. | `10` | Maximum time to wait for a response. |
| `IGNORE_EXCHANGES` | ❌ | Comma-separated list of exchange slugs to skip. | N/A | Example: `nobitex,bitmax`. Case-insensitive. |
| `RUN_ONCE` | ❌ | If set to `true`, the cron worker exits on error. | `false` | Useful for host schedulers that require process exit on failure. |
| `SENTRY_DSN` | ❌ | Optional DSN for Sentry error reporting. | N/A | If not provided, Sentry is disabled. |
| `PROXY_URL` | ❌ | Proxy server URL for HTTP requests. | N/A | Required if `useProxy=true` is used in requests. |
| `PROXY_API_KEY` | ❌ | API key for proxy authentication. | N/A | Required when `PROXY_URL` is set. |
| `COINMARKETCAP_API_KEY` | ❌ | API key(s) for CoinMarketCap scraper. | N/A | Can be comma-separated for multiple keys (rotation). |
| `COINAPI_KEY` | ❌ | API key for CoinAPI scraper. | N/A | Required for CoinAPI integration. |
| `USER_AGENT` | ❌ | Custom User-Agent string for HTTP requests. | Default browser UA | Override the default User-Agent if needed. |

-----

## 🤝 Contribution

Contributions are welcome! Please refer to the **[CONTRIBUTING.md](CONTRIBUTING.md)** file for detailed guidelines on setting up your environment, code style, and submitting pull requests.

### 🧩 Writing Scrapers

To integrate a new exchange, add a new JavaScript module to the **`src/scrappers`** directory.

Each module must:

1.  Export an `async function scrape($coins)` that returns an array of standardized data records.
2.  Export a `PLATFORM` constant (matching the file slug).
3.  Export a `COIN_USE` constant (`'own'`, `'all'`, or `'none'`).

Use the internal helper functions:

  * `axiosRequest()` (from `src/lib/request.js`) for resilient HTTP calls with built-in retries.
  * `num()` (from `src/lib/num.js`) for reliable numeric parsing.
