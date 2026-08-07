# Contribution guidelines

## Platform exchange status

Only add scrapers for exchanges that are **active** (`status: 1`) in the platform `exchanges` collection. Ingest config already omits non-active sources.

Removed from this repo (do not re-add without reactivating in the platform):

| Slug | Reason | Approx. platform date |
|------|--------|------------------------|
| `okex` | closed (`status: -1`) | 2024-02-17 |
| `rabincash` | limited (`status: 0`); volume API gone | 2024-02-17 |
| `phinix` | closed (`status: -1`) | 2024-05-08 |
| `citex`, `coinnik`, `exbito` | closed earlier; never restored here | 2024 |

## Adding an exchange

Create a directory with **all three** language scrapers (CI enforces parity):

```text
scrapers/<slug>/
  scrape.js
  scrape.php
  scrape.py
  sample.json   # raw API response dump (recommended)
```

Save a real response body from the exchange URL as `sample.json` so parsers can be debugged without hitting the live API. Prefer the current endpoint shape (if you previously had `*v2` dumps, use that).

Then run `npm run build` and commit `scrapers/`, `generated/`, and `dist/`.

### JavaScript (`scrape.js`)

```js
export const PLATFORM = "Example";
export const COIN_USE = "all"; // or "own"

export async function scrape(coins = []) {
  // return [{ symbol, currency, price, volume_1d, source, ... }]
}
```

Import helpers from `../../runtime/js/` (`num.js`, `request.js`, `logger.js`).

### PHP (`scrape.php`)

Provide `parse_<slug>`, `job_<slug>` (or `scrape_<slug>` for custom pagination), optional `skip_<slug>`, and:

```php
function register_<slug>(): array {
  return [
    'coin_use' => 'all',
    'job' => 'job_<slug>',      // string function name
    'parse' => 'parse_<slug>',
    // 'skip' => 'skip_<slug>',
    // 'scrape' => 'scrape_<slug>',
  ];
}
```

Shared HTTP helpers live in `runtime/php/helpers.php` (concatenated at build time).

### Python (`scrape.py`)

```python
def parse_<slug>(data, coins): ...
def job_<slug>(): ...
def register_<slug>():
    return {
        "coin_use": "all",
        "job": job_<slug>,
        "parse": parse_<slug>,
    }
```

Helpers (`num`, `http_request`, …) come from `runtime/python/helpers.py` when assembled.

## Standardized row fields

| Field | Required | Notes |
|-------|----------|--------|
| symbol | yes | e.g. `BTC` |
| currency | yes | e.g. `IRR` / `USD` |
| price | yes | &gt; 0 |
| volume_1d | yes | &gt; 0 |
| source | yes | exchange slug lowercase |
| coin_volume_1d, change_1d, change_7d, market_cap, supply, max_supply | no | |

Workers POST these to the Next.js ingest API (`INGEST_URL`, default `https://irancrypto.market/api/ingest`).

## Reporting bugs

Include OS, runtime (node/php/python version), command line, and relevant JSONL log lines (no secrets).

## Releases

Maintainers cut releases with semver tags aligned to `package.json`:

```bash
npm version patch   # 0.2.0 → 0.2.1
git push origin main --follow-tags
```

GitHub Actions builds `dist/` and publishes a release with changelog (commits since the previous tag) and the three worker files as download assets. Tags must be pushed from **main** only.
