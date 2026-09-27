<?php

/** @return list<array<string,mixed>> */
function parse_bitmax(mixed $data, array $coins): array
{
    $msg = is_array($data) && isset($data['message']) ? $data['message'] : $data;
    if (!is_array($msg) || $msg === [] || !empty($data['error'])) {
        throw new RuntimeException('BitMax: empty/error');
    }
    $usdt = 0.0;
    if (isset($msg['USDT']['price_in_irt'])) {
        $usdt = num($msg['USDT']['price_in_irt'], ['decimalPlaces' => 8, 'multiply' => 10]);
    }
    $out = [];
    $lu = last_update_now();
    foreach ($msg as $symbolKey => $row) {
        if (!is_array($row) || empty($row['price_in_irt'])) {
            continue;
        }
        $symbol = strtoupper((string) $symbolKey);
        if (!coin_allowed($coins, $symbol)) {
            continue;
        }
        $item = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['price_in_irt'], ['decimalPlaces' => 8, 'multiply' => 10]),
            // volume_24h is the global market volume (CoinMarketCap mirror), not BitMax's own trading
            'volume_1d' => 0,
            'coin_volume_1d' => 0,
            'change_1d' => num($row['change'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($row['change_7d'] ?? 0, ['decimalPlaces' => 2]),
            'market_cap' => num($row['market_cap'] ?? 0, ['multiply' => $usdt, 'roundUp' => true]),
            'source' => 'bitmax',
            'last_update' => $lu,
        ];
        $out[] = $item;
    }
    return $out;
}

function job_bitmax(): array
{
    return [
        'url' => 'https://api.bitmax.ir/watcher/price/alternative',
    ];
}

function register_bitmax(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_bitmax',
        'parse' => 'parse_bitmax',
    ];
}
