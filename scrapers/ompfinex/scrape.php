<?php

function getLatest_ompfinex($filterCoins = []) {
    $url = "https://api.ompfinex.com/v1/market";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    $response = curl_exec($ch);
    curl_close($ch);

    if (!$response) {
        throw new Exception("Response data is empty");
    }

    $decoded = json_decode($response, true);
    $list = is_array($decoded) && isset($decoded['data']) && is_array($decoded['data']) ? $decoded['data'] : (is_array($decoded) ? $decoded : []);

    if (empty($list)) {
        throw new Exception("Response data is empty");
    }

    return processList_ompfinex($list, $filterCoins);
}

function processList_ompfinex($list, $coinsFilter = []) {
    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($list as $item) {
        $quote = strtoupper($item['quote_currency']['id'] ?? '');
        if ($quote !== 'IRR' && $quote !== 'IRT') continue;
        if (!isset($item['last_price'])) continue;

        $symbol = strtoupper($item['base_currency']['id'] ?? '');
        if (!$symbol) continue;

        if (!empty($coinsFilter) && !in_array($symbol, $coinsFilter)) {
            continue;
        }

        $price = floatval($item['last_price']) * 10;
        $volume1d = floatval($item['last_volume'] ?? 0) * 10;
        $change1d = floatval($item['day_change_percent'] ?? 0);

        $result[] = [
            'source' => 'ompfinex',
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => round($volume1d),
            'coin_volume_1d' => 0,
            'change_1d' => round($change1d, 2),
            'last_update' => [
                'date' => $now,
                'timestamp' => $timestamp,
            ]
        ];
    }

    return $result;
}
