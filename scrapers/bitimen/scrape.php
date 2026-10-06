<?php

/** @return list<array<string,mixed>> */
function parse_bitimen(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Bitimen: empty response');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data as $item) {
        if (!is_array($item)) {
            continue;
        }
        $symbol = strtoupper((string) ($item['base_asset_ticker'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $rawPrice = ($item['last_price'] ?? null) ?: ($item['best_bid_raw'] ?? 0);
        $rawVolume = str_replace(',', '', (string) ($item['volume'] ?? '0'));
        $price = num($rawPrice, ['multiply' => 10, 'decimalPlaces' => 8]);
        $volume_1d = num($rawVolume, ['multiply' => 10, 'roundUp' => true]);
        $coinVolume = $price > 0 ? num($volume_1d, ['divide' => $price, 'decimalPlaces' => 4]) : 0;
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => $volume_1d,
            'coin_volume_1d' => $coinVolume,
            'change_1d' => num(($item['change_display'] ?? null) ?: ($item['change'] ?? 0), ['decimalPlaces' => 2]),
            'source' => 'bitimen',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_bitimen(): array
{
    return [
        'url' => 'https://api2.bitimen.com/api/market/stats',
        'query' => ['quote_asset' => 'IRT'],
    ];
}

function register_bitimen(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_bitimen',
        'parse' => 'parse_bitimen',
    ];
}
