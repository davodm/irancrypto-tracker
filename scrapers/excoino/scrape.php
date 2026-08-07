<?php

/** @return list<array<string,mixed>> */
function parse_excoino(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Excoino: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data as $row) {
        if (!is_array($row)) {
            continue;
        }
        $split = explode('/', strtoupper((string) ($row['symbol'] ?? '')));
        if (count($split) === 2 && $split[1] !== 'IRR') {
            continue;
        }
        if (empty($row['trend']) || !is_array($row['trend'])) {
            continue;
        }
        $symbol = $split[0] ?? '';
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        // Parity: Node keeps raw split case from data.symbol
        $rawSymbol = explode('/', (string) $row['symbol'])[0];
        $out[] = [
            'currency' => 'IRR',
            'symbol' => strtoupper($rawSymbol),
            'price' => num($row['trend'][0] ?? 0, ['decimalPlaces' => 8]),
            'volume_1d' => num($row['twentyFourHourTurnover'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => num($row['twentyFourHourVolume'] ?? 0),
            'change_1d' => num($row['chg'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'excoino',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_excoino(): array
{
    return [
        'url' => 'https://market-api.excoino.com/market/symbol-thumb-trend',
    ];
}

function register_excoino(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_excoino',
        'parse' => 'parse_excoino',
    ];
}
