# 🤝 Contribution Guidelines

We welcome contributions to the IranCrypto.Market Tracker\! Whether you are fixing a bug, improving documentation, or adding a new exchange module, please follow these guidelines.

## 🐛 Reporting Bugs

If you find a bug, please open a new issue on GitHub. Include:

1.  A clear and descriptive title.
2.  The steps to reproduce the behavior.
3.  The expected behavior.
4.  The actual behavior.
5.  Your environment details (Node.js version, OS).

## 🚀 Suggesting Enhancements

For new features or enhancements (like support for a new database or integration), please open an issue to discuss the proposal before starting work.

## 🧩 Adding a New Exchange Module (Scraper)

The core of this project is its modular scraping architecture. To add a new exchange, you need to create a new module in the `src/scrappers` directory.

### Module Requirements

Each module must adhere to the following structure and requirements:

1.  **Location:** Place the file in `src/scrappers/<exchange_slug>.js`.
2.  **Naming:** The module's primary export constant, `PLATFORM`, should match the filename (without the `.js` extension).
3.  **Exports:**
      * `PLATFORM`: A string constant representing the exchange name (e.g., `"Plat Name"`).
      * `COIN_USE`: A constant defining which coins the scraper handles:
          * `'all'`: The scraper returns data for all available coins.
          * `'own'`: The scraper only returns data for coins it is explicitly configured to track internally.
          * `'none'`: The scraper is disabled.
      * `scrape`: An asynchronous function that executes the main scraping logic.

### `scrape` Function Signature

```javascript
/**
 * Scrape function to be used in automation
 * @param {string[]} $coins - List of coins to filter (only relevant if COIN_USE is 'all')
 * @returns {Promise<object[]>} - Array of standardized cryptocurrency data records.
 */
export async function scrape($coins = []) {
    // ... implementation ...
}
```

### Standardized Data Format

The `scrape` function *must* return an array of objects, where each object represents a market pair and includes the following minimum fields:

| Field | Type | Description |
| :--- | :--- | :--- |
| `symbol` | `string` | The cryptocurrency symbol (e.g., `"BTC"`). |
| `currency` | `string` | The base currency (e.g., `"IRT"`, `"USDT"`). |
| `price` | `number` | Latest price of the asset. |
| `volume_1d` | `number` | 24-hour volume in the base currency (e.g., IRT). |
| `coin_volume_1d` | `number` | 24-hour volume in the asset coin (e.g., BTC). |
| `change_1d` | `number` | 24-hour price change percentage. |
| `last_update` | `string` | ISO 8601 timestamp of the data point. |
| `source` | `string` | Automatically added from `PLATFORM.toLowerCase()`. |

### Helper Functions

You are strongly encouraged to use the provided internal helpers for consistency and resilience:

| Helper | Usage | Description |
| :--- | :--- | :--- |
| `axiosRequest(config)` | `import { axiosRequest } from "../lib/request.js";` | Wrapper around `axios` that handles retries (via `REQUEST_RETRY_COUNT`), logging, and error throwing for invalid HTTP responses. |
| `num(value)` | `import num from "../lib/num.js";` | Utility for reliable numeric parsing and handling. |
| `dayjs()` | `import dayjs from "dayjs";` | Used for handling and formatting timestamps. |

### Example Scraper Structure

```javascript
import dayjs from "dayjs";
import { axiosRequest } from "../lib/request.js";
import num from "../lib/num.js";

const PLATFORM = "ExampleExchange";
const API_URL = "https://api.example.com/v1/";

// Define for automation which coins to use
export const COIN_USE = "all";

/**
 * Scrape function to be used in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  try {
    const rawData = await fetchLatestData();
    const processedData = processList(rawData, $coins);

    // IMPORTANT: Add the source platform
    processedData.forEach((d) => {
      d.source = PLATFORM.toLowerCase();
    });

    return processedData;
  } catch (error) {
    // Throw errors to be handled by the main script
    throw error;
  }
}

async function fetchLatestData() {
    // Use the resilient axiosRequest helper
    const response = await axiosRequest({
        method: "get",
        url: API_URL + "marketdata"
    });

    if (!response || !response.success) {
        throw new Error("Invalid or empty API response.");
    }
    return response.data;
}

function processList(rawData, $filterCoins) {
    // Your transformation logic here to match the standardized format
    return rawData
        .filter(item => $filterCoins.includes(item.symbol)) // Example filtering
        .map(item => ({
            symbol: item.symbol,
            currency: item.currency,
            price: num(item.last_price).get(), // Using the num helper
            volume_1d: num(item.volume_base).get(),
            coin_volume_1d: num(item.volume_coin).get(),
            change_1d: num(item.change_percent).get(),
            last_update: dayjs().toISOString(),
        }));
}
```