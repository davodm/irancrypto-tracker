<?php

/**
 * Parse the IRT ticker embedded in a Bidarz price page (`quoteId:"IRR"` is labelled Toman,
 * and its prices and volume are in Toman).
 * Returns null when the market is missing, idle for 24h, or too imprecise.
 *
 * @return array<string,mixed>|null
 */
function parse_bidarz_page(string $html, string $coin): ?array
{
    // Bidarz rounds Toman prices to whole units; below this the rounding error exceeds 1%.
    $minPriceToman = 100;

    if (!preg_match('/\{[^{}]*quoteId:"IRR"[^{}]*\}/', $html, $tickerMatch)) {
        return null;
    }
    $ticker = $tickerMatch[0];
    $field = static function (string $key) use ($ticker): float {
        return preg_match('/[{,]' . $key . ':"?(-?[0-9]*\.?[0-9]+)/', $ticker, $m) ? (float) $m[1] : 0.0;
    };

    $priceToman = $field('last');
    // A zero 24h high means no trades, so `last` is stale.
    if ($priceToman < $minPriceToman || $field('max24h') <= 0) {
        return null;
    }

    $volumeToman = $field('volume24h');
    return [
        'currency' => 'IRR',
        'symbol' => strtoupper($coin),
        'price' => num($priceToman, ['multiply' => 10, 'decimalPlaces' => 8]),
        'volume_1d' => num($volumeToman, ['multiply' => 10, 'roundUp' => true]),
        'coin_volume_1d' => num($volumeToman, ['divide' => $priceToman]),
        'change_1d' => num($field('changePercent24h'), ['decimalPlaces' => 2]),
        'change_7d' => num($field('changePercent7d'), ['decimalPlaces' => 2]),
        'source' => 'bidarz',
        'last_update' => last_update_now(),
    ];
}

/** @return list<array<string,mixed>> */
function scrape_bidarz(array $coins): array
{
    $popularCoins = ['BTC', 'ETH', 'USDT', 'LTC', 'BCH', 'TRX', 'DOGE', 'LINK', 'XRP', 'SOL', 'ADA'];
    $out = [];
    foreach ($coins !== [] ? $coins : $popularCoins as $coin) {
        $coin = strtoupper((string) $coin);
        if ($coin === 'IRT' || $coin === 'IRR') {
            continue;
        }
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 5)) {
            break;
        }
        try {
            $row = parse_bidarz_page(http_get_text('https://bidarz.ir/price/' . strtolower($coin)), $coin);
        } catch (Throwable $e) {
            continue;
        }
        if ($row !== null) {
            $out[] = $row;
        }
    }
    return $out;
}

function register_bidarz(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_bidarz',
    ];
}
