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
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($rawPrice, ['multiply' => 10, 'decimalPlaces' => 8]),
            'volume_1d' => num($rawVolume, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => 0,
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
