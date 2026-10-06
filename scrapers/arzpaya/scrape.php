<?php

/** @return list<array<string,mixed>> */
function scrape_arzpaya(array $coins): array
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
            $response = http_get_json('https://na1.arzpaya.com/orderbook/buy/irt/' . strtolower($coin));
        } catch (Throwable $e) {
            continue;
        }
        $topBid = is_array($response) && !empty($response['Data']) && is_array($response['Data'])
            ? $response['Data'][0]
            : null;
        $price = is_array($topBid) ? num($topBid['p'] ?? $topBid['P'] ?? 0, ['multiply' => 10, 'decimalPlaces' => 8]) : 0.0;
        if ($price <= 0) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $coin,
            'price' => $price,
            'volume_1d' => 0,
            'coin_volume_1d' => 0,
            'change_1d' => 0,
            'source' => 'arzpaya',
            'last_update' => last_update_now(),
        ];
    }
    return $out;
}

function register_arzpaya(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_arzpaya',
    ];
}
