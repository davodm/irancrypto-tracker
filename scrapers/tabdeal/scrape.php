<?php

/** @return list<array<string,mixed>> */
function parse_tabdeal(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Tabdeal: empty');
    }
    $usdt = 0.0;
    foreach ($data as $item) {
        if (!is_array($item) || ($item['symbol'] ?? '') !== 'USDT') {
            continue;
        }
        foreach ($item['markets'] ?? [] as $m) {
            if (($m['second_currency']['symbol'] ?? '') === 'IRT' && isset($m['price'])) {
                $usdt = num($m['price'], ['decimalPlaces' => 8, 'multiply' => 10]);
                break 2;
            }
        }
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data as $row) {
        if (!is_array($row) || empty($row['markets'])) {
            continue;
        }
        $irtMarket = null;
        foreach ($row['markets'] as $m) {
            if (($m['second_currency']['symbol'] ?? '') === 'IRT' && !empty($m['price'])) {
                $irtMarket = $m;
                break;
            }
        }
        if ($irtMarket === null) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($irtMarket['price'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['usdt_volume'] ?? 0, ['multiply' => $usdt, 'roundUp' => true]),
            'coin_volume_1d' => num($row['volume'] ?? 0),
            'change_1d' => num($row['change_percent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'tabdeal',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function skip_tabdeal(): ?string
{
    return (PROXY_URL === '' || PROXY_API_KEY === '')
        ? 'proxy not configured'
        : null;
}

function job_tabdeal(): array
{
    return [
        'url' => 'https://api-web.tabdeal.org/r/plots/currency_prices',
        'query' => ['limit' => 1000],
        'use_proxy' => true,
    ];
}

function register_tabdeal(): array
{
    return [
        'coin_use' => 'all',
        'skip' => 'skip_tabdeal',
        'job' => 'job_tabdeal',
        'parse' => 'parse_tabdeal',
    ];
}
