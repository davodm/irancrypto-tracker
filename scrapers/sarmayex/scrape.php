<?php

function getLatest_sarmayex($filterCoins = []) {
    $url = "https://sarmayex.com/crypto-price";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    $response = curl_exec($ch);
    curl_close($ch);

    if (!$response) {
        throw new Exception("Response data is empty");
    }

    return processHtml_sarmayex($response, $filterCoins);
}

function processHtml_sarmayex($html, $coinsFilter = []) {
    $result = [];
    $now = date('c');
    $timestamp = time();
    $seen = [];

    if (preg_match_all('/"([0-9]{6,14}\.[0-9]+)"(?:(?!"[0-9]{6,14}\.").)*?"([A-Z0-9]+)_IRT"/', $html, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $match) {
            $symbol = strtoupper($match[2]);
            if ($symbol === 'IRT' || $symbol === 'IRR') continue;
            if (isset($seen[$symbol])) continue;
            if (!empty($coinsFilter) && !in_array($symbol, $coinsFilter)) continue;

            $seen[$symbol] = true;
            $price = floatval($match[1]);

            $result[] = [
                'source' => 'sarmayex',
                'currency' => 'IRR',
                'symbol' => $symbol,
                'price' => $price,
                'volume_1d' => 0,
                'coin_volume_1d' => 0,
                'change_1d' => 0,
                'last_update' => [
                    'date' => $now,
                    'timestamp' => $timestamp,
                ]
            ];
        }
    }

    return $result;
}
