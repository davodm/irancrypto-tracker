# IranCrypto.Market Tracker

A Node.js-based cryptocurrency data scraper for [IranCrypto.Market](https://irancrypto.market), designed to collect and aggregate cryptocurrency data from multiple exchanges. The project features a modular design, allowing for easy integration of new data sources through custom modules.

## Features

- **Modular Design**: Easily add new modules to scrape data from additional exchanges or data sources.
- **Scheduled Scraping**: Automatically runs every hour using `node-cron`.
- **Standardized Output**: Outputs data in a consistent JSON format for seamless integration.
- **Scalable**: Built to accommodate the growing number of cryptocurrency exchanges.


## Installation

### Prerequisites

- **Node.js** (v18 or later)
- **npm** (v7 or later)

### Steps

1. **Clone the Repository**

```bash
git clone https://github.com/davodm/irancrypto-market-tracker.git
cd irancrypto-market-tracker
```

2. **Install Dependencies**

```bash
npm install
```

3. **Configure Environment Variables**

On production you should export the environment variables like `.env.example` file.


But on development you can create a `.env` file in the root directory and add any necessary environment variables. Refer to `.env.example` for guidance.


## Usage

### Starting the Cron Job

The tracker uses `node-cron` to run every hour by default.

- **Production Mode**

```bash
npm start
```

- **Development Mode**

  For one time execution with env file loaded:

```bash
npm run dev
```

## Writing Modules

Contributions are welcome! You can write a module to scrape data from a new exchange or data source.

### Module Requirements

Each module should:

- Be placed in the `src/scrappers` directory.
- Export a `scrape` function.
- Define a `PLATFORM` constant.
- Export a `COIN_USE` constant.

### Sample Module

Below is a sample module demonstrating the required structure and best practices:

You can use `axiosRequest()` function to send requests to the API which automatically handles the response and throws errors if the response is invalid or convert it to JSON if it's not.

```javascript
import moment from "moment";
import { axiosRequest } from "../lib/request.js";
import num from "../lib/num.js";

const PLATFORM = "Plat Name"; // Should be the same as the filename without .js
const URL = "https://apiname.com/v1/";

// Define for automation which coins to use: 'own', 'all', or 'none'
export const COIN_USE = "all";

/**
 * Scrape function to be used in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  try {
    // Get the latest data
    const data = await getLatest($coins);

    // Add the source platform to each data entry
    data.forEach((d) => {
      d.source = PLATFORM.toLowerCase();
    });

    return data;
  } catch (error) {
    // Throw errors to be handled by the main script
    throw error;
  }
}

/**
 * Fetches the latest cryptocurrency data
 * @param {string[]} $filterCoins - List of coins to filter
 * @returns {Promise<object[]>} - Processed list of cryptocurrencies
 */
async function getLatest($filterCoins = []) {
  const data = await request("get_home_page_data", {});
  if (!data?.market_data?.irt || !data.market_data.irt.length) {
    throw new Error("Response data is empty");
  }
  return processList(data.market_data.irt, $filterCoins);
}

/**
 * Sends a request to the Exchange API
 * @param {string} $uri - Endpoint URI
 * @param {object} $params - Query parameters
 * @returns {Promise<object>} - API response data
 */
async function request($uri, $params = {}) {
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
  });

  if (!result?.status || result.status !== "true") {
    throw new Error(
      `Invalid response status (${result.status}): ${result.message}`
    );
  }

  if (!result?.message || !Object.keys(result.message).length) {
    throw new Error("Invalid response data");
  }

  return result.message;
}

/**
 * Processes the list of cryptocurrencies
 * @param {object[]} $list - List of cryptocurrencies
 * @param {string[]} $coinsFilter - List of coins to filter
 * @returns {object[]} - Processed list
 */
function processList($list, $coinsFilter = []) {
  return $list
    .filter((data) => {
      // Ensure the data has a valid price
      if (!data?.last_price) return false;

      // Filter based on the provided coin list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.coin.toUpperCase())
      );
    })
    .map((data) => {
      const date = moment();

      return {
        currency: "IRR",
        symbol: data.coin.toUpperCase(),
        price: num(data.last_price, { decimalPlaces: 8, multiply: 10 }) || 0,
        volume_1d:
          num(data["24h_volume_total"], { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: num(data["volume_24_hour"]) || 0,
        change_1d: num(data.change_24_hour, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
```

### Module Breakdown

- **PLATFORM**: A constant string matching the exchange name. It should be the same as the filename without the `.js` extension.
- **COIN_USE**: A constant defining which coins to scrape. Options are `own` to use supported coins in exchange data, `all` to filter out target coins, or `none`.
- **scrape Function**: The main function that will be called by the scheduler. It should return data in the standardized format.

### Sample JSON Output

Each module should output data in the standardized JSON format. Samples of JSON outputs for each module (exchange) are located in the `./samples` directory.

```json
[
  {
    "currency": "IRR",
    "symbol": "BTC",
    "price": 1234567890,
    "volume_1d": 9876543210,
    "coin_volume_1d": 12.3456,
    "change_1d": 1.23,
    "last_update": {
      "date": "2024-10-18T09:58:43.702Z",
      "timestamp": 1729245523,
      "moment": "Moment<2024-10-18T10:58:43+0100>"
    },
    "source": "ariomex"
  },
  {
    "currency": "IRR",
    "symbol": "ETH",
    "price": 1670250560,
    "volume_1d": 112238549428,
    "coin_volume_1d": 67.25402,
    "change_1d": -0.35,
    "last_update": {
      "date": "2024-10-18T09:58:43.702Z",
      "timestamp": 1729245523,
      "moment": "Moment<2024-10-18T10:58:43+0100>"
    },
    "source": "ariomex"
  }
]
```

### Adding Your Module

1. **Create Your Module**: Use the sample module as a template and place your file in the `src/modules` directory.
2. **Implement Required Elements**:
   - Define the `PLATFORM` constant.
   - Define the `COIN_USE` constant.
   - Implement the `scrape` function.
3. **Handle Data Processing**: Ensure your module processes and outputs data in the standardized format.
4. **Test Your Module**: Before integrating, test your module independently to ensure it works correctly.
5. **Integrate with Main Scraper**: Register your module which belongs to an exchange on MongoDB and it uses the slug name for module name.

## Contact Information

- **Website**: [irancrypto.market](https://irancrypto.market)
- **Email**: hi@irancrypto.market

If you have any questions or suggestions, feel free to reach out!

---

**Disclaimer:** This project is currently not open-source. The information provided is for internal use and collaboration purposes only.