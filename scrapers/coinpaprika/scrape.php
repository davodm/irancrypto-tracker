<?php

/**
 * Resolve ticker collisions. Several tokens share a ticker (USDT, TON, IOTA, …);
 * keep the canonical one per symbol: the exact CoinPaprika id where known, else the
 * highest-ranked entry.
 *
 * @param array $list
 * @return array<string,array<string,mixed>> symbol -> ticker
 */
function coinpaprika_pick_by_symbol(array $list): array
{
    // Symbols whose canonical token is NOT the top-ranked one sharing the ticker.
    $canonicalId = [
        'TON' => 'ton-tokamak-network',
        'IOTA' => 'miota-iota',
        'BTT' => 'bttc-bittorrent-chain',
    ];
    $best = [];
    foreach ($list as $t) {
        if (!is_array($t)) {
            continue;
        }
        $sym = strtoupper((string) ($t['symbol'] ?? ''));
        if ($sym === '') {
            continue;
        }
        $rank = is_numeric($t['rank'] ?? null) ? (int) $t['rank'] : PHP_INT_MAX;
        if (isset($canonicalId[$sym]) && ($t['id'] ?? null) === $canonicalId[$sym]) {
            $best[$sym] = $t;
            continue;
        }
        $cur = $best[$sym] ?? null;
        if ($cur === null || $rank < (is_numeric($cur['rank'] ?? null) ? (int) $cur['rank'] : PHP_INT_MAX)) {
            $best[$sym] = $t;
        }
    }
    return $best;
}

/** @return list<array<string,mixed>> */
function parse_coinpaprika(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('CoinPaprika: empty tickers');
    }
    $wanted = $coins === [] ? null : array_map(static fn($c) => strtoupper((string) $c), $coins);
    $out = [];
    foreach (coinpaprika_pick_by_symbol($data) as $sym => $t) {
        if ($wanted !== null && !in_array(strtoupper($sym), $wanted, true)) {
            continue;
        }
        $quote = $t['quotes']['USD'] ?? null;
        if (!is_array($quote)) {
            continue;
        }
        $price = num($quote['price'] ?? 0, ['decimalPlaces' => 8]);
        $ts = !empty($t['last_updated']) ? (int) (strtotime((string) $t['last_updated']) ?: time()) : time();
        $item = [
            'currency' => 'USD',
            'symbol' => $sym,
            'price' => $price,
            'volume_1d' => num($quote['volume_24h'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => $price > 0 ? num($quote['volume_24h'] ?? 0, ['divide' => $price, 'decimalPlaces' => 4]) : 0,
            'change_1d' => num($quote['percent_change_24h'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($quote['percent_change_7d'] ?? 0, ['decimalPlaces' => 2]),
            'cap' => num($quote['market_cap'] ?? 0, ['decimalPlaces' => 0, 'roundUp' => true]),
            'market_cap' => num($quote['market_cap'] ?? 0, ['decimalPlaces' => 0, 'roundUp' => true]),
            'supply' => num($t['circulating_supply'] ?? 0),
            'max_supply' => num($t['max_supply'] ?? 0),
            'source' => 'coinpaprika',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
        $out[] = $item;
    }
    return $out;
}

function job_coinpaprika(): array
{
    return [
        'url' => 'https://api.coinpaprika.com/v1/tickers',
    ];
}

function register_coinpaprika(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_coinpaprika',
        'parse' => 'parse_coinpaprika',
    ];
}
