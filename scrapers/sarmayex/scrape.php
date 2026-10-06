<?php

/**
 * Parse currencies from the Sarmayex v2 JSON API. `sell.marketPrice` is the Toman
 * mid-market rate (`sell.price` is Sarmayex's own marked-up quote). Only coins with
 * a live `<symbol>_IRT` market are quoted in IRT.
 *
 * @param mixed $data
 * @param array $coins
 * @return list<array<string,mixed>>
 */
function parse_sarmayex(mixed $data, array $coins): array
{
    $currencies = $data['data']['currencies'] ?? null;
    if (!is_array($currencies) || $currencies === []) {
        throw new RuntimeException('Sarmayex: empty currencies');
    }
    $wanted = $coins === [] ? null : array_map(static fn($c) => strtoupper((string) $c), $coins);
    $lastUpdate = is_numeric($data['data']['setting']['lastUpdate'] ?? null)
        ? (int) $data['data']['setting']['lastUpdate']
        : 0;
    $lu = $lastUpdate > 0 ? ['date' => gmdate('c', $lastUpdate), 'timestamp' => $lastUpdate] : last_update_now();

    $out = [];
    foreach ($currencies as $c) {
        if (!is_array($c)) {
            continue;
        }
        $symbol = strtoupper((string) ($c['symbol'] ?? ''));
        if ($symbol === '' || ($wanted !== null && !in_array($symbol, $wanted, true))) {
            continue;
        }
        $markets = is_array($c['markets'] ?? null) ? $c['markets'] : [];
        if (!in_array("{$symbol}_IRT", $markets, true)) {
            continue;
        }
        $sell = is_array($c['sell'] ?? null) ? $c['sell'] : null;
        $priceToman = is_array($sell) ? num($sell['marketPrice'] ?? 0) : 0.0;
        if ($priceToman <= 0) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($priceToman, ['multiply' => 10, 'decimalPlaces' => 8]),
            'volume_1d' => 0,
            'coin_volume_1d' => 0,
            'change_1d' => num($c['percentChange_24h'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($c['percentChange_7d'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'sarmayex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_sarmayex(): array
{
    return [
        'url' => 'https://api.sarmayex.com/api/v2/currencies',
    ];
}

function register_sarmayex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_sarmayex',
        'parse' => 'parse_sarmayex',
    ];
}
