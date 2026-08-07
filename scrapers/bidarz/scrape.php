<?php

function getLatest_bidarz($filterCoins = []) {
    $popularCoins = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"];
    $targetCoins = !empty($filterCoins) ? $filterCoins : $popularCoins;

    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($targetCoins as $coin) {
        if (strtoupper($coin) === 'IRT' || strtoupper($coin) === 'IRR') continue;
        $url = "https://bidarz.ir/price/" . strtolower($coin);
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!$response) continue;

        if (preg_match('/quoteId:"IRR"[^}]*?last:"([0-9.]+)"/', $response, $match)) {
            $price = floatval($match[1]);
            $result[] = [
                'source' => 'bidarz',
                'currency' => 'IRR',
                'symbol' => strtoupper($coin),
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
