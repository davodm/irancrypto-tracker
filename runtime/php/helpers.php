<?php
// =============================================================================
// LOGGING / TIME
// =============================================================================

function log_info(string $msg): void
{
    fwrite(STDOUT, '[' . date('Y-m-d H:i:s') . '] ' . $msg . "\n");
}

function log_error(string $msg): void
{
    fwrite(STDERR, '[' . date('Y-m-d H:i:s') . '] ERROR: ' . $msg . "\n");
}

function elapsed_sec(): float
{
    global $SCRIPT_STARTED_AT;
    return microtime(true) - $SCRIPT_STARTED_AT;
}

function time_left_sec(): float
{
    if (SCRIPT_MAX_SEC <= 0) {
        return INF;
    }
    return SCRIPT_MAX_SEC - elapsed_sec();
}

function assert_time_budget(float $needSec = 15.0): bool
{
    if (time_left_sec() < $needSec) {
        log_error(sprintf(
            'Aborting: only %.1fs left of SCRIPT_MAX_SEC=%d (elapsed %.1fs)',
            time_left_sec(),
            SCRIPT_MAX_SEC,
            elapsed_sec()
        ));
        return false;
    }
    return true;
}

/**
 * Seconds available for waiting on a dead source, never exceeding the host limit.
 */
function finalize_budget_sec(): int
{
    $left = time_left_sec();
    if ($left === INF) {
        return FINALIZE_WAIT_SEC;
    }
    return max(0, (int) floor($left - FINALIZE_SAFETY_SEC));
}

function ignore_list(): array
{
    if (IGNORE_EXCHANGES === '') {
        return [];
    }
    return array_values(array_filter(array_map(
        static fn(string $s): string => strtolower(trim($s)),
        explode(',', IGNORE_EXCHANGES)
    )));
}

function cmc_keys(): array
{
    $raw = env('COINMARKETCAP_API_KEY', defined('COINMARKETCAP_API_KEY') ? COINMARKETCAP_API_KEY : '');
    if ($raw === '') {
        return [];
    }
    return array_values(array_filter(array_map('trim', explode(',', $raw))));
}

// =============================================================================
// NUMBER HELPERS
// =============================================================================

/**
 * Port of runtime/js/num.js — returns float.
 *
 * @param mixed $input
 * @param array{add?:float,subtract?:float,multiply?:float,divide?:float,roundUp?:bool,decimalPlaces?:int,defaultValue?:float} $options
 */
function num($input, array $options = []): float
{
    $add = $options['add'] ?? null;
    $subtract = $options['subtract'] ?? null;
    $multiply = $options['multiply'] ?? null;
    $divide = $options['divide'] ?? null;
    $roundUp = $options['roundUp'] ?? false;
    $decimalPlaces = $options['decimalPlaces'] ?? 14;
    $defaultValue = (float) ($options['defaultValue'] ?? 0);

    if ($input === null || $input === '' || (is_string($input) && trim($input) === '')) {
        return $defaultValue;
    }

    if (is_string($input)) {
        $trimmed = trim($input);
        $isNegParens = (bool) preg_match('/^\(.+\)$/', $trimmed);
        if ($isNegParens) {
            $trimmed = '-' . preg_replace('/^\(|\)$/', '', $trimmed);
        }
        $trimmed = str_replace([',', '%'], '', $trimmed);
        if (!preg_match('/^[-+]?\d+(\.\d+)?$/', $trimmed)) {
            return $defaultValue;
        }
        $value = (float) $trimmed;
    } elseif (is_int($input) || is_float($input)) {
        if (!is_finite((float) $input)) {
            return $defaultValue;
        }
        $value = (float) $input;
    } else {
        return $defaultValue;
    }

    if ($add !== null) {
        $value += (float) $add;
    }
    if ($subtract !== null) {
        $value -= (float) $subtract;
    }
    if ($multiply !== null) {
        $value *= (float) $multiply;
    }
    if ($divide !== null) {
        $d = (float) $divide;
        if ($d == 0.0) {
            return $defaultValue;
        }
        $value /= $d;
    }

    if ($roundUp) {
        $value = ceil($value);
    }

    return (float) round($value, $decimalPlaces, PHP_ROUND_HALF_UP);
}

function last_update_now(): array
{
    $ts = time();
    return [
        'date' => gmdate('c', $ts),
        'timestamp' => $ts,
    ];
}

function coin_allowed(array $filter, string $symbol): bool
{
    if ($filter === []) {
        return true;
    }
    $upper = array_map(static fn($c) => strtoupper((string) $c), $filter);
    return in_array(strtoupper($symbol), $upper, true);
}

// =============================================================================
// HTTP
// =============================================================================

/**
 * @param array<string,string> $headers
 * @return array{status:int,body:string,json:mixed}
 */
function http_request(
    string $method,
    string $url,
    array $query = [],
    array $headers = [],
    ?string $body = null,
    bool $useProxy = false,
    ?string $userAgent = null,
    bool $retry403 = true
): array {
    if ($useProxy && PROXY_URL !== '' && PROXY_API_KEY !== '') {
        return http_via_proxy($method, $url, $query, $headers, $body);
    }

    if ($query !== []) {
        $sep = str_contains($url, '?') ? '&' : '?';
        $url .= $sep . http_build_query($query);
    }

    $ua = $userAgent ?? USER_AGENT;
    $attempt = 0;
    $maxAttempts = 1 + max(0, REQUEST_RETRY_COUNT);
    $lastError = null;

    while ($attempt < $maxAttempts) {
        $attempt++;
        try {
            $result = curl_once($method, $url, $headers, $body, $ua);

            if ($retry403 && $result['status'] === 403) {
                log_info("HTTP 403 for {$url} — retry with Postman UA");
                return http_request($method, $url, [], $headers, $body, false, USER_AGENT_POSTMAN, false);
            }

            if ($result['status'] < 200 || $result['status'] >= 300) {
                throw new RuntimeException("HTTP {$result['status']} for {$url}");
            }

            $json = json_decode($result['body'], true);
            if ($result['body'] !== '' && $json === null && json_last_error() !== JSON_ERROR_NONE) {
                throw new RuntimeException("Response is not JSON for {$url}");
            }
            if ($result['body'] === '' || $json === null) {
                throw new RuntimeException("Response is empty for {$url}");
            }

            return [
                'status' => $result['status'],
                'body' => $result['body'],
                'json' => $json,
            ];
        } catch (Throwable $e) {
            $lastError = $e;
            $isNetwork = (bool) preg_match('/timed out|timeout|Failed to connect|Could not resolve|Connection reset/i', $e->getMessage());
            if ($isNetwork && $attempt < $maxAttempts) {
                usleep((int) (REQUEST_RETRY_BASE_MS * (2 ** ($attempt - 1)) * 1000));
                continue;
            }
            throw $e;
        }
    }

    throw $lastError ?? new RuntimeException("Request failed for {$url}");
}

/**
 * @param array<string,string> $headers
 * @return array{status:int,body:string}
 */
function curl_once(string $method, string $url, array $headers, ?string $body, string $userAgent): array
{
    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException("curl_init failed for {$url}");
    }

    $hdrs = ['Accept: application/json', 'User-Agent: ' . $userAgent];
    foreach ($headers as $k => $v) {
        $hdrs[] = is_int($k) ? $v : "{$k}: {$v}";
    }

    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => HTTP_TIMEOUT_SEC,
        CURLOPT_TIMEOUT => HTTP_TIMEOUT_SEC,
        CURLOPT_HTTPHEADER => $hdrs,
        CURLOPT_SSL_VERIFYPEER => SSL_VERIFY,
        CURLOPT_SSL_VERIFYHOST => SSL_VERIFY ? 2 : 0,
        CURLOPT_ENCODING => '',
    ]);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno !== 0) {
        throw new RuntimeException("cURL error ({$errno}): {$err} for {$url}");
    }
    if ($raw === false) {
        throw new RuntimeException("Empty cURL response for {$url}");
    }

    return ['status' => $status, 'body' => (string) $raw];
}

/**
 * @param array<string,string> $headers
 * @return array{status:int,body:string,json:mixed}
 */
function http_via_proxy(string $method, string $url, array $query, array $headers, ?string $body): array
{
    if (PROXY_URL === '' || PROXY_API_KEY === '') {
        throw new RuntimeException('PROXY_URL / PROXY_API_KEY required for proxy request');
    }

    $payload = json_encode([
        'url' => $url,
        'method' => strtoupper($method),
        'params' => $query,
        'body' => $body !== null ? json_decode($body, true) : new stdClass(),
        'headers' => array_merge(['Accept' => 'application/json', 'User-Agent' => USER_AGENT], $headers),
        'timeout' => HTTP_TIMEOUT_SEC * 1000,
    ], JSON_THROW_ON_ERROR);

    $result = curl_once('POST', PROXY_URL, [
        'Content-Type' => 'application/json',
        'Accept' => 'application/json',
        'x-api-key' => PROXY_API_KEY,
    ], $payload, USER_AGENT);

    if ($result['status'] < 200 || $result['status'] >= 300) {
        throw new RuntimeException("Proxy HTTP {$result['status']} for {$url}");
    }

    $json = json_decode($result['body'], true);
    if ($json === null && json_last_error() !== JSON_ERROR_NONE) {
        throw new RuntimeException("Proxy response not JSON for {$url}");
    }

    // Proxy may wrap target body or return it directly
    $data = $json['data'] ?? $json['body'] ?? $json;
    if (is_string($data)) {
        $decoded = json_decode($data, true);
        $data = $decoded ?? $data;
    }

    return [
        'status' => $result['status'],
        'body' => is_string($data) ? $data : json_encode($data),
        'json' => $data,
    ];
}

/**
 * Parallel GET wave.
 *
 * @param array<string,array{url:string,query?:array,headers?:array<string,string>,use_proxy?:bool}> $jobs
 * @return array<string,array{ok:bool,json?:mixed,error?:string}>
 */
function http_multi_get(array $jobs): array
{
    if ($jobs === []) {
        return [];
    }

    $mh = curl_multi_init();
    $map = [];
    $results = [];

    foreach ($jobs as $key => $job) {
        $url = $job['url'];
        $query = $job['query'] ?? [];
        if ($query !== []) {
            $sep = str_contains($url, '?') ? '&' : '?';
            $url .= $sep . http_build_query($query);
        }

        if (!empty($job['use_proxy'])) {
            // Proxy jobs run sequentially after multi wave
            $results[$key] = ['ok' => false, 'error' => '__proxy__'];
            continue;
        }

        $ch = curl_init($url);
        if ($ch === false) {
            $results[$key] = ['ok' => false, 'error' => 'curl_init failed'];
            continue;
        }

        $hdrs = ['Accept: application/json', 'User-Agent: ' . USER_AGENT];
        foreach ($job['headers'] ?? [] as $hk => $hv) {
            $hdrs[] = is_int($hk) ? $hv : "{$hk}: {$hv}";
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => HTTP_TIMEOUT_SEC,
            CURLOPT_TIMEOUT => HTTP_TIMEOUT_SEC,
            CURLOPT_HTTPHEADER => $hdrs,
            CURLOPT_SSL_VERIFYPEER => SSL_VERIFY,
            CURLOPT_SSL_VERIFYHOST => SSL_VERIFY ? 2 : 0,
            CURLOPT_ENCODING => '',
        ]);

        curl_multi_add_handle($mh, $ch);
        $map[(int) $ch] = ['key' => $key, 'ch' => $ch, 'url' => $url];
    }

    if ($map !== []) {
        $running = null;
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $status === CURLM_OK);

        foreach ($map as $item) {
            $ch = $item['ch'];
            $key = $item['key'];
            $url = $item['url'];
            $raw = curl_multi_getcontent($ch);
            $errno = curl_errno($ch);
            $err = curl_error($ch);
            $httpStatus = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);

            if ($errno !== 0) {
                $results[$key] = ['ok' => false, 'error' => "cURL ({$errno}): {$err}"];
                continue;
            }

            if ($httpStatus === 403) {
                try {
                    $retry = http_request(
                        'GET',
                        $url,
                        [],
                        $jobs[$key]['headers'] ?? [],
                        null,
                        false,
                        USER_AGENT_POSTMAN,
                        false
                    );
                    $results[$key] = ['ok' => true, 'json' => $retry['json']];
                } catch (Throwable $e) {
                    $results[$key] = ['ok' => false, 'error' => $e->getMessage()];
                }
                continue;
            }

            if ($httpStatus < 200 || $httpStatus >= 300) {
                $results[$key] = ['ok' => false, 'error' => "HTTP {$httpStatus}"];
                continue;
            }

            $json = json_decode((string) $raw, true);
            if ($raw === '' || $raw === false || ($json === null && json_last_error() !== JSON_ERROR_NONE)) {
                $results[$key] = ['ok' => false, 'error' => 'Invalid/empty JSON'];
                continue;
            }

            $results[$key] = ['ok' => true, 'json' => $json];
        }
    }

    curl_multi_close($mh);

    // Resolve proxy-deferred jobs synchronously
    foreach ($jobs as $key => $job) {
        if (empty($job['use_proxy'])) {
            continue;
        }
        try {
            $resp = http_request('GET', $job['url'], $job['query'] ?? [], $job['headers'] ?? [], null, true);
            $results[$key] = ['ok' => true, 'json' => $resp['json']];
        } catch (Throwable $e) {
            $results[$key] = ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    return $results;
}

function http_get_json(string $url, array $query = [], array $headers = [], bool $useProxy = false): mixed
{
    return http_request('GET', $url, $query, $headers, null, $useProxy)['json'];
}

/** Fetch a non-JSON body (HTML pages). */
function http_get_text(string $url, array $headers = []): string
{
    $result = curl_once('GET', $url, $headers, null, USER_AGENT);
    if ($result['status'] < 200 || $result['status'] >= 300 || $result['body'] === '') {
        throw new RuntimeException("HTTP {$result['status']} for {$url}");
    }
    return $result['body'];
}

