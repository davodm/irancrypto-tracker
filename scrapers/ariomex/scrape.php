<?php

/** @return list<array<string,mixed>> */
function parse_ariomex_list(array $list, array $coins): array
{
    $out = [];
    $lu = last_update_now();
    foreach ($list as $row) {
        if (!is_array($row) || empty($row['last_price'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['base'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $coinVolume = num($row['volume'] ?? 0);
        $priceIRT = num($row['last_price']);
        $volumeIRT = $coinVolume * $priceIRT;
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['last_price'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($volumeIRT, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => $coinVolume,
            'change_1d' => num($row['change_percentage'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'ariomex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

/** @return list<array<string,mixed>> */
function scrape_ariomex(array $coins): array
{
    $all = [];
    $maxRows = 200;
    $maxPages = 20;
    for ($page = 1; $page <= $maxPages; $page++) {
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 5)) {
            break;
        }
        $response = http_get_json('https://data.ariomex.ir/exchange_data/markets_details', [
            'maxRowsPerPage' => $maxRows,
            'page' => $page,
            'resolution' => '1d',
            'quote' => 'irt',
        ]);
        if (!is_array($response) || ($response['status'] ?? null) !== 'true') {
            throw new RuntimeException('Ariomex: invalid status');
        }
        $list = $response['result'] ?? null;
        if (!is_array($list) || $list === []) {
            break;
        }
        foreach ($list as $row) {
            $all[] = $row;
        }
        if (count($list) < $maxRows) {
            break;
        }
    }
    if ($all === []) {
        throw new RuntimeException('Ariomex: empty');
    }
    return parse_ariomex_list($all, $coins);
}

function register_ariomex(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_ariomex',
    ];
}
