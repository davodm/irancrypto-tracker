#!/usr/bin/env php
<?php
/**
 * IranCrypto Tracker — single-file API-only collector (PHP).
 *
 * Deploy: copy this file + create logs/ (auto-created). No Mongo, no Composer.
 *
 *   export INGEST_SECRET=...
 *   php track.php --all --finalize
 *
 * INGEST_URL defaults to https://irancrypto.market/api/ingest (override via env).
 *
 * Requirements: PHP 8.0+ CLI, ext-curl, ext-json, OpenSSL
 */

declare(strict_types=1);

$SCRIPT_STARTED_AT = microtime(true);
$SCRIPT_DIR = __DIR__;

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run via CLI.\n");
    exit(1);
}

if (version_compare(PHP_VERSION, '8.0.0', '<')) {
    fwrite(STDERR, "PHP 8.0+ required. Current: " . PHP_VERSION . "\n");
    exit(1);
}

foreach (['curl', 'json'] as $ext) {
    if (!extension_loaded($ext)) {
        fwrite(STDERR, "Missing required PHP extension: {$ext}\n");
        exit(1);
    }
}

set_time_limit(0);
ignore_user_abort(true);
date_default_timezone_set('UTC');

function try_max_runtime(): void
{
    @ini_set('max_execution_time', '0');
    @set_time_limit(0);
    @ignore_user_abort(true);
}

try_max_runtime();

load_dotenv(dirname(__FILE__) . '/.env');
load_dotenv(getcwd() . '/.env');

const DEFAULT_INGEST_URL = 'https://irancrypto.market/api/ingest';

function resolve_ingest_url(string $raw = ''): string
{
    $base = trim($raw !== '' ? $raw : DEFAULT_INGEST_URL);
    $base = rtrim($base, '/');
    if (!preg_match('#/api/ingest(/|$)#', $base)) {
        $base = rtrim($base, '/') . '/api/ingest';
    }
    return rtrim($base, '/');
}

define('INGEST_URL', resolve_ingest_url(env('INGEST_URL', '')));
define('INGEST_SECRET', env('INGEST_SECRET', ''));
define('INGEST_NODE', env('INGEST_NODE', gethostname() ?: 'php'));
define('LOG_DIR', env('LOG_DIR', '') !== '' ? env('LOG_DIR') : (dirname(__FILE__) . '/logs'));
define('LOG_RETENTION_DAYS', max(1, (int) env('LOG_RETENTION_DAYS', '7')));
define('HTTP_TIMEOUT_SEC', max(1, (int) env('TIMEOUT', '10')));
define('SCRIPT_MAX_SEC', max(0, (int) env('SCRIPT_MAX_SEC', '0')));
define('REQUEST_RETRY_COUNT', max(0, (int) env('REQUEST_RETRY_COUNT', '0')));
define('REQUEST_RETRY_BASE_MS', max(50, (int) env('REQUEST_RETRY_BASE_MS', '300')));
define('IGNORE_EXCHANGES', env('IGNORE_EXCHANGES', ''));
define('EXCHANGES_ALLOW', env('EXCHANGES', ''));
define('FINALIZE_WAIT_SEC', max(0, (int) env('FINALIZE_WAIT_SEC', '300')));
define('FINALIZE_POLL_SEC', max(1, (int) env('FINALIZE_POLL_SEC', '15')));
define('USER_AGENT', env('USER_AGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'));
define('USER_AGENT_POSTMAN', 'PostmanRuntime/7.26.10');
define('PROXY_URL', env('PROXY_URL', ''));
define('PROXY_API_KEY', env('PROXY_API_KEY', ''));
define('COINMARKETCAP_API_KEY', env('COINMARKETCAP_API_KEY', ''));
define('COINAPI_KEY', env('COINAPI_KEY', ''));
// Exchange scrapes may hit broken certs; ingest calls always verify TLS.
define('SSL_VERIFY', filter_var(env('SSL_VERIFY_EXCHANGE', 'false'), FILTER_VALIDATE_BOOLEAN));
define('SSL_VERIFY_INGEST', filter_var(env('SSL_VERIFY_INGEST', 'true'), FILTER_VALIDATE_BOOLEAN));

$RUN_LOGGER = null;

// =============================================================================
// ENV / CLI / JSONL LOGS / INGEST CLIENT
// =============================================================================

function env(string $key, string $default = ''): string
{
    $v = getenv($key);
    if ($v === false || $v === '') {
        return $default;
    }
    return $v;
}

function load_dotenv(string $path): void
{
    if (!is_file($path) || !is_readable($path)) {
        return;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        return;
    }
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        if ($k === '') {
            continue;
        }
        if (
            (str_starts_with($v, '"') && str_ends_with($v, '"'))
            || (str_starts_with($v, "'") && str_ends_with($v, "'"))
        ) {
            $v = substr($v, 1, -1);
        }
        if (getenv($k) === false) {
            putenv("{$k}={$v}");
            $_ENV[$k] = $v;
        }
    }
}

/**
 * @return array{
 *   all:bool,exchange:?string,finalize:bool,finalize_only:bool,run_id:?string,
 *   dry_run:bool,from_json:?string,prune_logs:bool,help:bool
 * }
 */
function parse_cli(array $argv): array
{
    $out = [
        'all' => false,
        'exchange' => null,
        'finalize' => false,
        'finalize_only' => false,
        'run_id' => null,
        'dry_run' => false,
        'from_json' => null,
        'prune_logs' => false,
        'help' => false,
    ];
    foreach (array_slice($argv, 1) as $arg) {
        if ($arg === '--help' || $arg === '-h') {
            $out['help'] = true;
        } elseif ($arg === '--all') {
            $out['all'] = true;
        } elseif ($arg === '--finalize') {
            $out['finalize'] = true;
        } elseif ($arg === '--finalize-only') {
            $out['finalize_only'] = true;
        } elseif ($arg === '--dry-run') {
            $out['dry_run'] = true;
        } elseif ($arg === '--prune-logs') {
            $out['prune_logs'] = true;
        } elseif (str_starts_with($arg, '--exchange=')) {
            $out['exchange'] = strtolower(substr($arg, strlen('--exchange=')));
        } elseif (str_starts_with($arg, '--run-id=')) {
            $out['run_id'] = substr($arg, strlen('--run-id='));
        } elseif (str_starts_with($arg, '--from-json=')) {
            $out['from_json'] = substr($arg, strlen('--from-json='));
        } else {
            throw new InvalidArgumentException("Unknown argument: {$arg}");
        }
    }
    return $out;
}

function print_help(): void
{
    $msg = <<<TXT
IranCrypto tracker (PHP) — API-only single-file worker

Usage:
  php track.php --all [--finalize]
  php track.php --exchange=nobitex
  php track.php --finalize-only [--run-id=YYYY-MM-DDTHH]
  php track.php --from-json=rows.json --exchange=nobitex
  php track.php --prune-logs

Env:
  INGEST_SECRET (required) INGEST_URL INGEST_NODE LOG_DIR
  INGEST_URL defaults to https://irancrypto.market/api/ingest
  EXCHANGES IGNORE_EXCHANGES PROXY_* COINMARKETCAP_API_KEY COINAPI_KEY
  FINALIZE_WAIT_SEC FINALIZE_POLL_SEC
  Only one node should --finalize (Lambda). Others scrape without --finalize.

TXT;
    fwrite(STDOUT, $msg);
}

function default_run_id(?string $iso = null): string
{
    $ts = $iso ? strtotime($iso) : time();
    if ($ts === false) {
        $ts = time();
    }
    return gmdate('Y-m-d', $ts) . 'T' . gmdate('H', $ts);
}

final class RunLogger
{
    private string $path;

    public function __construct(string $logDir, string $node, string $runId)
    {
        if (!is_dir($logDir) && !mkdir($logDir, 0755, true) && !is_dir($logDir)) {
            throw new RuntimeException("Cannot create log dir: {$logDir}");
        }
        $day = substr($runId, 0, 10);
        $dayDir = $logDir . '/' . $day;
        if (!is_dir($dayDir) && !mkdir($dayDir, 0755, true) && !is_dir($dayDir)) {
            throw new RuntimeException("Cannot create log day dir: {$dayDir}");
        }
        $safeNode = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $node) ?: 'node';
        $safeRun = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $runId) ?: 'run';
        $this->path = $dayDir . '/' . $safeNode . '-' . $safeRun . '.jsonl';
    }

    /** @param array<string,mixed> $data */
    public function event(string $event, array $data = []): void
    {
        $row = array_merge([
            'ts' => gmdate('c'),
            'event' => $event,
        ], $data);
        file_put_contents($this->path, json_encode($row, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
    }

    public function path(): string
    {
        return $this->path;
    }
}

function prune_logs(string $logDir, int $days): int
{
    if (!is_dir($logDir)) {
        return 0;
    }
    $cutoff = time() - ($days * 86400);
    $removed = 0;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($logDir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $file) {
        /** @var SplFileInfo $file */
        $path = $file->getPathname();
        if ($file->isFile() && $file->getMTime() < $cutoff) {
            if (@unlink($path)) {
                $removed++;
            }
        } elseif ($file->isDir()) {
            @rmdir($path);
        }
    }
    return $removed;
}

/**
 * @param array<string,string> $headers
 * @return array{status:int,body:string,json:mixed}
 */
function ingest_request(string $method, string $path, ?array $body = null): array
{
    if (INGEST_SECRET === '') {
        throw new RuntimeException('INGEST_SECRET is required');
    }
    $url = $path === '' ? INGEST_URL : INGEST_URL . (str_starts_with($path, '/') ? $path : '/' . $path);
    $payload = $body !== null ? json_encode($body, JSON_THROW_ON_ERROR) : null;
    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . INGEST_SECRET,
        'User-Agent: irancrypto-tracker-php/1.0',
    ];
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
    }

    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException("curl_init failed for {$url}");
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => HTTP_TIMEOUT_SEC,
        CURLOPT_TIMEOUT => max(HTTP_TIMEOUT_SEC, 60),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_SSL_VERIFYPEER => SSL_VERIFY_INGEST,
        CURLOPT_SSL_VERIFYHOST => SSL_VERIFY_INGEST ? 2 : 0,
        CURLOPT_ENCODING => '',
    ]);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    }
    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($errno !== 0) {
        throw new RuntimeException("Ingest cURL error ({$errno}): {$err}");
    }
    $json = null;
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
    }
    if ($status < 200 || $status >= 300) {
        $msg = is_array($json) ? (string) ($json['error'] ?? $json['message'] ?? $raw) : (string) $raw;
        throw new RuntimeException("Ingest HTTP {$status}: {$msg}");
    }
    return ['status' => $status, 'body' => (string) $raw, 'json' => $json];
}

function ingest_config(): array
{
    $resp = ingest_request('GET', '/config');
    if (!is_array($resp['json'])) {
        throw new RuntimeException('Invalid config response');
    }
    return $resp['json'];
}

/** @param array<string,mixed> $payload */
function ingest_post(array $payload): array
{
    $resp = ingest_request('POST', '', $payload);
    return is_array($resp['json']) ? $resp['json'] : [];
}

/**
 * @return array<string,mixed>
 */
function wait_for_ingest_ready(string $runId): array
{
    global $RUN_LOGGER;
    $deadline = microtime(true) + FINALIZE_WAIT_SEC;
    while (true) {
        $resp = ingest_request('GET', '/status?run_id=' . rawurlencode($runId));
        $status = is_array($resp['json']) ? $resp['json'] : [];
        $missing = isset($status['missing']) && is_array($status['missing']) ? $status['missing'] : [];
        if ($missing === []) {
            log_info("Ingest ready for {$runId}");
            if ($RUN_LOGGER instanceof RunLogger) {
                $RUN_LOGGER->event('status_ready', ['run_id' => $runId]);
            }
            return $status;
        }
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            log_info(
                'Finalize wait deadline reached for ' . $runId . '; proceeding with available sources (missing: ' . implode(',', $missing) . ')'
            );
            if ($RUN_LOGGER instanceof RunLogger) {
                $RUN_LOGGER->event('status_timeout', [
                    'run_id' => $runId,
                    'missing' => $missing,
                    'waited_sec' => FINALIZE_WAIT_SEC,
                ]);
            }
            return $status;
        }
        $sleepSec = min(FINALIZE_POLL_SEC, (int) ceil($remaining));
        log_info('Waiting for sources (' . implode(',', $missing) . "); poll in {$sleepSec}s");
        if ($RUN_LOGGER instanceof RunLogger) {
            $RUN_LOGGER->event('status_wait', [
                'run_id' => $runId,
                'missing' => $missing,
                'sleep_ms' => $sleepSec * 1000,
            ]);
        }
        sleep(max(1, $sleepSec));
    }
}

/** @param array<string,mixed> $payload */
function ingest_finalize(array $payload): array
{
    $resp = ingest_request('POST', '/finalize', $payload);
    return is_array($resp['json']) ? $resp['json'] : [];
}

/** Wait until status.missing is empty, then finalize. */
function finalize_when_ready(string $runId): array
{
    global $RUN_LOGGER;
    $t0 = microtime(true);
    wait_for_ingest_ready($runId);
    $res = ingest_finalize(['run_id' => $runId, 'stage' => 'all']);
    if ($RUN_LOGGER instanceof RunLogger) {
        $RUN_LOGGER->event('finalize_ok', [
            'run_id' => $runId,
            'ms' => (int) round((microtime(true) - $t0) * 1000),
        ]);
    }
    log_info('Finalize complete');
    return $res;
}

/**
 * @param list<array<string,mixed>> $raw
 * @param list<string> $coins
 * @return list<array<string,mixed>>
 */
function filter_rows_for_ingest(array $raw, array $coins): array
{
    $coinSet = array_fill_keys(array_map('strtoupper', $coins), true);
    $out = [];
    foreach ($raw as $d) {
        if (!is_array($d) || !isset($d['price']) || !is_numeric($d['price']) || (float) $d['price'] <= 0) {
            continue;
        }
        $vol = isset($d['volume_1d']) && is_numeric($d['volume_1d']) ? (float) $d['volume_1d'] : 0.0;
        if ($vol < 0) {
            continue;
        }
        $src = strtolower(trim((string) ($d['source'] ?? '')));
        if ($src === '') {
            continue;
        }
        $sym = strtoupper(trim((string) ($d['symbol'] ?? '')));
        if ($sym === '' || !isset($coinSet[$sym])) {
            continue;
        }
        $row = [
            'symbol' => $sym,
            'currency' => strtoupper(trim((string) ($d['currency'] ?? 'IRR'))),
            'price' => (float) $d['price'],
            'volume_1d' => max(0.0, $vol),
            'source' => $src,
        ];
        foreach (['coin_volume_1d', 'change_1d', 'change_7d', 'cap', 'market_cap', 'supply', 'max_supply'] as $opt) {
            if (isset($d[$opt]) && is_numeric($d[$opt])) {
                $row[$opt] = (float) $d[$opt];
            }
        }
        if (!isset($row['cap']) && isset($row['market_cap'])) {
            $row['cap'] = $row['market_cap'];
        }
        $out[] = $row;
    }
    return $out;
}

/**
 * @param list<array{slug:string,support?:list<string>}> $exchanges
 * @return list<array{slug:string,support?:list<string>}>
 */
function select_exchanges(array $exchanges, array $cli): array
{
    $ignored = ignore_list();
    $allow = [];
    if (EXCHANGES_ALLOW !== '') {
        $allow = array_values(array_filter(array_map(
            static fn(string $s): string => strtolower(trim($s)),
            explode(',', EXCHANGES_ALLOW)
        )));
    }
    if (!empty($cli['exchange'])) {
        $allow = [$cli['exchange']];
    }
    $raw = $exchanges;
    $existingSlugs = [];
    foreach ($raw as $ex) {
        $s = strtolower((string) ($ex['slug'] ?? ''));
        if ($s !== '') {
            $existingSlugs[$s] = true;
        }
    }
    if (function_exists('scraper_registry')) {
        foreach (array_keys(scraper_registry()) as $slug) {
            $s = strtolower((string) $slug);
            if (!isset($existingSlugs[$s])) {
                $raw[] = ['slug' => $s];
            }
        }
    }
    $out = [];
    foreach ($raw as $ex) {
        $slug = strtolower((string) ($ex['slug'] ?? ''));
        if ($slug === '') {
            continue;
        }
        if (in_array($slug, $ignored, true)) {
            continue;
        }
        if ($allow !== [] && !in_array($slug, $allow, true)) {
            continue;
        }
        $out[] = $ex;
    }
    return $out;
}


// ===== helpers =====

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




// ===== scrapers =====


// --- ariomex ---

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


// --- arzpaya ---

function getLatest_arzpaya($filterCoins = []) {
    $popularCoins = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"];
    $targetCoins = !empty($filterCoins) ? $filterCoins : $popularCoins;

    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($targetCoins as $coin) {
        if (strtoupper($coin) === 'IRT' || strtoupper($coin) === 'IRR') continue;
        $url = "https://na1.arzpaya.com/orderbook/buy/irt/" . strtolower($coin);
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!$response) continue;

        $data = json_decode($response, true);
        if (isset($data['Data']) && is_array($data['Data']) && count($data['Data']) > 0) {
            $topBid = $data['Data'][0];
            $price = floatval($topBid['p']) * 10;

            $result[] = [
                'source' => 'arzpaya',
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


// --- bidarz ---

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


// --- bitimen ---

function getLatest_bitimen($filterCoins = []) {
    $url = "https://api2.bitimen.com/api/market/stats?quote_asset=IRT";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    $response = curl_exec($ch);
    curl_close($ch);

    if (!$response) {
        throw new Exception("Response data is empty");
    }

    $data = json_decode($response, true);
    if (!is_array($data) || empty($data)) {
        throw new Exception("Response data is empty");
    }

    return processList_bitimen($data, $filterCoins);
}

function processList_bitimen($list, $coinsFilter = []) {
    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($list as $key => $item) {
        $symbol = strtoupper($item['base_asset_ticker'] ?? '');
        if (!$symbol) continue;

        if (!empty($coinsFilter) && !in_array($symbol, $coinsFilter)) {
            continue;
        }

        $rawPrice = $item['last_price'] ?? $item['best_bid_raw'] ?? 0;
        $price = floatval($rawPrice) * 10;
        $rawVol = str_replace(',', '', $item['volume'] ?? '0');
        $volume1d = floatval($rawVol) * 10;
        $change1d = floatval($item['change_display'] ?? $item['change'] ?? 0);

        $result[] = [
            'source' => 'bitimen',
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


// --- bitmax ---

/** @return list<array<string,mixed>> */
function parse_bitmax(mixed $data, array $coins): array
{
    $msg = is_array($data) && isset($data['message']) ? $data['message'] : $data;
    if (!is_array($msg) || $msg === [] || !empty($data['error'])) {
        throw new RuntimeException('BitMax: empty/error');
    }
    $usdt = 0.0;
    if (isset($msg['USDT']['price_in_irt'])) {
        $usdt = num($msg['USDT']['price_in_irt'], ['decimalPlaces' => 8, 'multiply' => 10]);
    }
    $out = [];
    $lu = last_update_now();
    foreach ($msg as $symbolKey => $row) {
        if (!is_array($row) || empty($row['price_in_irt'])) {
            continue;
        }
        $symbol = strtoupper((string) $symbolKey);
        if (!coin_allowed($coins, $symbol)) {
            continue;
        }
        $priceUsd = (float) ($row['price_in_usd'] ?? 0);
        $item = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['price_in_irt'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['volume_24h'] ?? 0, ['multiply' => $usdt, 'roundUp' => true]),
            'coin_volume_1d' => $priceUsd > 0 ? num($row['volume_24h'] ?? 0, ['divide' => $priceUsd]) : 0.0,
            'change_1d' => num($row['change'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($row['change_7d'] ?? 0, ['decimalPlaces' => 2]),
            'market_cap' => num($row['market_cap'] ?? 0, ['multiply' => $usdt, 'roundUp' => true]),
            'source' => 'bitmax',
            'last_update' => $lu,
        ];
        $out[] = $item;
    }
    return $out;
}

function job_bitmax(): array
{
    return [
        'url' => 'https://api.bitmax.ir/watcher/price/alternative',
    ];
}

function register_bitmax(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_bitmax',
        'parse' => 'parse_bitmax',
    ];
}


// --- bitpin ---

/** @return list<array<string,mixed>> */
function parse_bitpin_list(array $list, array $coins): array
{
    $out = [];
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (($row['currency2']['code'] ?? '') !== 'IRT') {
            continue;
        }
        if (!empty($row['currency1']['forTest']) || empty($row['order_book_info']['price'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['currency1']['code'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $created = $row['internal_price_info']['created_at'] ?? null;
        $ts = $created ? (int) num($created, ['roundUp' => true]) : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['order_book_info']['price'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['order_book_info']['value'] ?? 0, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => num($row['order_book_info']['amount'] ?? 0),
            'change_1d' => num($row['order_book_info']['change'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'bitpin',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

/** Follow Django-style `next` pagination (and page=N fallback). @return list<array<string,mixed>> */
function scrape_bitpin(array $coins): array
{
    $all = [];
    $nextUrl = null;
    $page = 1;
    $maxPages = 50;

    for ($i = 0; $i < $maxPages; $i++) {
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 5)) {
            break;
        }
        if ($nextUrl !== null) {
            $result = http_get_json($nextUrl);
        } else {
            $query = $page > 1 ? ['page' => $page] : [];
            $result = http_get_json('https://api.bitpin.ir/v1/mkt/markets/', $query);
        }
        if (!is_array($result) || empty($result['results']) || !is_array($result['results'])) {
            throw new RuntimeException('Bitpin: invalid response');
        }
        foreach ($result['results'] as $row) {
            $all[] = $row;
        }
        if (!empty($result['next']) && is_string($result['next'])) {
            $nextUrl = $result['next'];
            continue;
        }
        $count = (int) ($result['count'] ?? 0);
        if ($count > 0 && count($all) < $count && count($result['results']) > 0) {
            $nextUrl = null;
            $page++;
            continue;
        }
        break;
    }

    if ($all === []) {
        throw new RuntimeException('Bitpin: empty');
    }
    return parse_bitpin_list($all, $coins);
}

function register_bitpin(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_bitpin',
    ];
}


// --- coinapi ---

/** @return list<array<string,mixed>> */
function parse_coinapi(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('CoinAPI: empty');
    }
    $out = [];
    foreach ($data as $item) {
        if (!is_array($item)) {
            continue;
        }
        if (!isset($item['type_is_crypto']) || (int) $item['type_is_crypto'] !== 1) {
            continue;
        }
        $symbol = strtoupper((string) ($item['asset_id'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $iso = $item['data_quote_end'] ?? $item['data_end'] ?? null;
        $ts = $iso ? (int) (strtotime((string) $iso) ?: time()) : time();
        $out[] = [
            'currency' => 'USD',
            'symbol' => $symbol,
            'price' => num($item['price_usd'] ?? 0, ['decimalPlaces' => 8]),
            'volume_1d' => num($item['volume_1day_usd'] ?? 0, ['roundUp' => true]),
            'source' => 'coinapi',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

function skip_coinapi(): ?string
{
    return COINAPI_KEY === '' ? 'COINAPI_KEY empty' : null;
}

function job_coinapi(): array
{
    return [
        'url' => 'https://rest.coinapi.io/v1/assets',
        'headers' => ['X-CoinAPI-Key' => COINAPI_KEY],
    ];
}

function register_coinapi(): array
{
    return [
        'coin_use' => 'all',
        'skip' => 'skip_coinapi',
        'job' => 'job_coinapi',
        'parse' => 'parse_coinapi',
    ];
}


// --- coinmarketcap ---

/** @return list<array<string,mixed>> */
function parse_coinmarketcap(mixed $data, array $coins): array
{
    $list = $data['data'] ?? $data;
    if (!is_array($data) || (isset($data['status']['error_code']) && (int) $data['status']['error_code'] !== 0)) {
        $msg = $data['status']['error_message'] ?? 'invalid';
        throw new RuntimeException('CMC: ' . $msg);
    }
    if (!is_array($list) || $list === []) {
        throw new RuntimeException('CMC: empty');
    }
    // If wrapped, use data key
    if (isset($data['data']) && is_array($data['data'])) {
        $list = $data['data'];
    }
    $out = [];
    foreach ($list as $row) {
        if (!is_array($row) || empty($row['quote']['USD'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $q = $row['quote']['USD'];
        $price = num($q['price'] ?? 0, ['decimalPlaces' => 8]);
        $ts = !empty($row['last_updated']) ? (int) (strtotime((string) $row['last_updated']) ?: time()) : time();
        $item = [
            'currency' => 'USD',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => num($q['volume_24h'] ?? 0, ['roundUp' => true]),
            'change_1d' => num($q['percent_change_24h'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($q['percent_change_7d'] ?? 0, ['decimalPlaces' => 2]),
            'cap' => num($q['market_cap'] ?? 0, ['roundUp' => true]),
            'market_cap' => num($q['market_cap'] ?? 0, ['roundUp' => true]),
            'supply' => num($row['circulating_supply'] ?? 0),
            'max_supply' => num($row['max_supply'] ?? 0),
            'source' => 'coinmarketcap',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
        if (isset($row['quote'][$symbol]['volume_24h'])) {
            $item['coin_volume_1d'] = num($row['quote'][$symbol]['volume_24h']);
        } elseif ($price > 0) {
            $item['coin_volume_1d'] = num($q['volume_24h'] ?? 0, ['divide' => $price]);
        }
        $out[] = $item;
    }
    return $out;
}

function skip_coinmarketcap(): ?string
{
    return cmc_keys() === [] ? 'COINMARKETCAP_API_KEY empty' : null;
}

function job_coinmarketcap(): array
{
    $keys = cmc_keys();
    $key = $keys[array_rand($keys)];
    return [
        'url' => 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest',
        'query' => [
            'start' => 1,
            'limit' => 200,
            'aux' => 'max_supply,circulating_supply,total_supply,market_cap_by_total_supply,volume_24h_reported,volume_7d,volume_7d_reported,volume_30d,volume_30d_reported,is_market_cap_included_in_calc',
        ],
        'headers' => ['X-CMC_PRO_API_KEY' => $key],
    ];
}

function register_coinmarketcap(): array
{
    return [
        'coin_use' => 'all',
        'skip' => 'skip_coinmarketcap',
        'job' => 'job_coinmarketcap',
        'parse' => 'parse_coinmarketcap',
    ];
}


// --- exir ---

/** @return list<array<string,mixed>> */
function parse_exir(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Exir: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data as $key => $row) {
        if (!is_array($row)) {
            continue;
        }
        $split = explode('-', strtoupper((string) $key));
        $symbol = $split[0] ?? '';
        $currency = $split[1] ?? '';
        if ($currency !== 'IRT' || empty($row['last'])) {
            continue;
        }
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $price = num($row['last'] ?? $row['close'] ?? 0, ['multiply' => 10, 'decimalPlaces' => 8]);
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => num($row['volume'] ?? 0, ['multiply' => $price, 'roundUp' => true]),
            'coin_volume_1d' => num($row['volume'] ?? 0),
            'source' => 'exir',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_exir(): array
{
    return [
        'url' => 'https://api.exir.io/v2/ticker/all',
    ];
}

function register_exir(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_exir',
        'parse' => 'parse_exir',
    ];
}


// --- hitobit ---

/** @return list<array<string,mixed>> */
function parse_hitobit(mixed $data, array $coins): array
{
    if (!is_array($data) || $data === []) {
        throw new RuntimeException('Hitobit: empty');
    }
    $out = [];
    foreach ($data as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (($row['quoteCurrencySymbol'] ?? '') !== 'IRT' || empty($row['lastPrice'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['baseCurrencySymbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $ts = isset($row['lastMarketInfoChangeDate'])
            ? (int) (strtotime((string) $row['lastMarketInfoChangeDate']) ?: time())
            : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['lastPrice'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['quoteVolume'] ?? 0, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => num($row['baseVolume'] ?? 0),
            'change_1d' => num($row['priceChangePercent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'hitobit',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

function job_hitobit(): array
{
    return [
        'url' => 'https://hitobit.com/hapi/exchange/v1/public/alltickers/24hr',
    ];
}

function register_hitobit(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_hitobit',
        'parse' => 'parse_hitobit',
    ];
}


// --- huluex ---

/** @return list<array<string,mixed>> */
function parse_huluex(mixed $data, array $coins): array
{
    $list = is_array($data) && isset($data['data']) ? $data['data'] : $data;
    if (!is_array($list) || $list === []) {
        throw new RuntimeException('Huluex: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (!isset($row['sellPrice']) && !isset($row['buyPrice'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $price = num($row['sellPrice'] ?? $row['buyPrice'] ?? 0, ['decimalPlaces' => 8, 'multiply' => 10]);
        $volRaw = $row['valume'] ?? $row['volume'] ?? 0;
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => $price,
            'volume_1d' => num($volRaw, ['multiply' => 10, 'roundUp' => true]),
            'coin_volume_1d' => $price > 0 ? num($volRaw, ['divide' => $price]) : 0.0,
            'change_1d' => num($row['changePrice'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'huluex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_huluex(): array
{
    return [
        'url' => 'https://api.huluex.com/api/market/getCoinsPriceV3',
        'query' => ['withGate' => 'true', 'version' => 4],
    ];
}

function register_huluex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_huluex',
        'parse' => 'parse_huluex',
    ];
}


// --- kifpool ---

/** @return list<array<string,mixed>> */
function parse_kifpool_list(array $list, array $coins): array
{
    $out = [];
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (!isset($row['priceSellIRT']) && !isset($row['priceBuyIRT'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['symbol'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $priceIRT = (float) ($row['priceSellIRT'] ?? $row['priceBuyIRT'] ?? 0);
        $ts = !empty($row['updatedAt']) ? (int) (strtotime((string) $row['updatedAt']) ?: time()) : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($priceIRT, ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($row['volume'] ?? 0, ['roundUp' => true, 'multiply' => 10]),
            'coin_volume_1d' => $priceIRT > 0 ? num($row['volume'] ?? 0, ['divide' => $priceIRT]) : 0.0,
            'change_1d' => num($row['priceChangePercent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'kifpool',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

/** @return list<array<string,mixed>> */
function scrape_kifpool(array $coins): array
{
    $offset = 0;
    $limit = 200;
    $all = [];
    while (true) {
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 5)) {
            break;
        }
        $response = http_get_json('https://api.kifpool.app/api/spot/price/paginated', [
            'offset' => $offset,
            'limit' => $limit,
        ]);
        if (!is_array($response) || empty($response['data']) || !is_array($response['data'])) {
            break;
        }
        foreach ($response['data'] as $row) {
            $all[] = $row;
        }
        $total = (int) ($response['meta']['total'] ?? 0);
        $offset += $limit;
        if (count($response['data']) < $limit || ($total > 0 && $offset >= $total)) {
            break;
        }
    }
    if ($all === []) {
        throw new RuntimeException('KifPool: empty');
    }
    return parse_kifpool_list($all, $coins);
}

function register_kifpool(): array
{
    return [
        'coin_use' => 'all',
        'scrape' => 'scrape_kifpool',
    ];
}


// --- nobitex ---

function parse_nobitex(mixed $data, array $coins): array
{
    if (!is_array($data) || empty($data['stats']) || !is_array($data['stats'])) {
        throw new RuntimeException('Nobitex: empty stats');
    }
    if (isset($data['status']) && $data['status'] !== 'ok') {
        throw new RuntimeException('Nobitex: invalid status');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($data['stats'] as $key => $row) {
        if (!is_array($row) || !empty($row['isClosed'])) {
            continue;
        }
        $split = explode('-', strtoupper((string) $key));
        $symbol = $split[0] ?? '';
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['latest'] ?? 0, ['decimalPlaces' => 8]),
            'volume_1d' => num($row['volumeDst'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => num($row['volumeSrc'] ?? 0),
            'change_1d' => num($row['dayChange'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'nobitex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_nobitex(): array
{
    return [
        'url' => 'https://apiv2.nobitex.ir/market/stats',
        'query' => ['dstCurrency' => 'rls'],
        'headers' => [
            'Origin' => 'https://nobitex.ir',
            'Referer' => 'https://nobitex.ir/',
        ],
    ];
}

function register_nobitex(): array
{
    return [
        'coin_use' => 'own',
        'job' => 'job_nobitex',
        'parse' => 'parse_nobitex',
    ];
}


// --- ompfinex ---

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


// --- ramzinex ---

/** @return list<array<string,mixed>> */
function parse_ramzinex(mixed $data, array $coins): array
{
    $list = is_array($data) && isset($data['data']) ? $data['data'] : $data;
    if (!is_array($list) || $list === []) {
        throw new RuntimeException('Ramzinex: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        $quote = strtoupper((string) ($row['quote_currency_symbol']['en'] ?? ''));
        if ($quote !== 'IRR' || !isset($row['sell'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['base_currency_symbol']['en'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $fin = $row['financial']['last24h'] ?? [];
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($row['sell'], ['decimalPlaces' => 8]),
            'volume_1d' => num($fin['quote_volume'] ?? 0, ['roundUp' => true]),
            'coin_volume_1d' => num($fin['base_volume'] ?? 0),
            'change_1d' => num($fin['change_percent'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'ramzinex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_ramzinex(): array
{
    return [
        'url' => 'https://publicapi.ramzinex.com/exchange/api/v1.0/exchange/pairs',
    ];
}

function register_ramzinex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_ramzinex',
        'parse' => 'parse_ramzinex',
    ];
}


// --- saraf ---

/** @return list<array<string,mixed>> */
function parse_saraf(mixed $data, array $coins): array
{
    $items = $data['price']['Items'] ?? null;
    if (!is_array($items)) {
        throw new RuntimeException('Saraf: empty');
    }
    $list = array_values($items);
    $out = [];
    foreach ($list as $item) {
        if (!is_array($item)) {
            continue;
        }
        if (strtoupper((string) ($item['assetType'] ?? '')) !== 'CRYPTO' || empty($item['p'])) {
            continue;
        }
        $symbol = strtoupper((string) ($item['s'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $priceIRT = num($item['p']);
        $ts = !empty($item['ut']) ? (int) round(((float) $item['ut']) / 1000) : time();
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($item['p'], ['decimalPlaces' => 8, 'multiply' => 10]),
            'volume_1d' => num($item['mc'] ?? 0, ['roundUp' => true, 'multiply' => 10]),
            'coin_volume_1d' => $priceIRT > 0 ? num($item['mc'] ?? 0, ['divide' => $priceIRT]) : 0.0,
            'change_1d' => num($item['c'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'saraf',
            'last_update' => ['date' => gmdate('c', $ts), 'timestamp' => $ts],
        ];
    }
    return $out;
}

function job_saraf(): array
{
    return [
        'url' => 'https://api.saraf.app/v3/prices/crypto',
    ];
}

function register_saraf(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_saraf',
        'parse' => 'parse_saraf',
    ];
}


// --- sarmayex ---

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


// --- tabdeal ---

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
    return null;
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


// --- tetherland ---

function getLatest_tetherland($filterCoins = []) {
    $url = "https://api.tetherland.com/currencies";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    $response = curl_exec($ch);
    curl_close($ch);

    if (!$response) {
        throw new Exception("Response data is empty");
    }

    $data = json_decode($response, true);
    if (!isset($data['data']['currencies']) || empty($data['data']['currencies'])) {
        throw new Exception("Response data is empty");
    }

    return processList_tetherland($data['data']['currencies'], $filterCoins);
}

function processList_tetherland($list, $coinsFilter = []) {
    $result = [];
    $now = date('c');
    $timestamp = time();

    foreach ($list as $symbol => $item) {
        $upperSymbol = strtoupper($symbol);
        if (!empty($coinsFilter) && !in_array($upperSymbol, $coinsFilter)) {
            continue;
        }

        $rawPrice = $item['price'] ?? $item['buy_price'] ?? 0;
        $price = floatval($rawPrice) * 10;
        $change1d = floatval($item['diff24d'] ?? 0);

        $result[] = [
            'source' => 'tetherland',
            'currency' => 'IRR',
            'symbol' => $upperSymbol,
            'price' => $price,
            'volume_1d' => 0,
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


// --- wallex ---

/** @return list<array<string,mixed>> */
function parse_wallex(mixed $data, array $coins): array
{
    if (!is_array($data)) {
        throw new RuntimeException('Wallex: invalid');
    }
    $symbols = $data['result']['symbols'] ?? $data['symbols'] ?? null;
    if (!is_array($symbols) || $symbols === []) {
        throw new RuntimeException('Wallex: empty');
    }
    $out = [];
    $lu = last_update_now();
    foreach ($symbols as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (strtoupper((string) ($row['quoteAsset'] ?? '')) !== 'TMN') {
            continue;
        }
        if (empty($row['stats']['lastPrice'])) {
            continue;
        }
        $symbol = strtoupper((string) ($row['baseAsset'] ?? ''));
        if ($symbol === '' || !coin_allowed($coins, $symbol)) {
            continue;
        }
        $stats = $row['stats'];
        $out[] = [
            'currency' => 'IRR',
            'symbol' => $symbol,
            'price' => num($stats['lastPrice'], ['multiply' => 10, 'decimalPlaces' => 8]),
            'volume_1d' => num($stats['24h_quoteVolume'] ?? 0, ['roundUp' => true, 'multiply' => 10]),
            'coin_volume_1d' => num($stats['24h_volume'] ?? 0),
            'change_1d' => num($stats['24h_ch'] ?? 0, ['decimalPlaces' => 2]),
            'change_7d' => num($stats['7d_ch'] ?? 0, ['decimalPlaces' => 2]),
            'source' => 'wallex',
            'last_update' => $lu,
        ];
    }
    return $out;
}

function job_wallex(): array
{
    return [
        'url' => 'https://api.wallex.ir/v1/markets',
    ];
}

function register_wallex(): array
{
    return [
        'coin_use' => 'all',
        'job' => 'job_wallex',
        'parse' => 'parse_wallex',
    ];
}



// ===== registry =====

/** AUTO-GENERATED by scripts/generate-registry.mjs — do not edit */

function scraper_registry(): array
{
    return [
    'ariomex' => register_ariomex(),
    'arzpaya' => register_arzpaya(),
    'bidarz' => register_bidarz(),
    'bitimen' => register_bitimen(),
    'bitmax' => register_bitmax(),
    'bitpin' => register_bitpin(),
    'coinapi' => register_coinapi(),
    'coinmarketcap' => register_coinmarketcap(),
    'exir' => register_exir(),
    'hitobit' => register_hitobit(),
    'huluex' => register_huluex(),
    'kifpool' => register_kifpool(),
    'nobitex' => register_nobitex(),
    'ompfinex' => register_ompfinex(),
    'ramzinex' => register_ramzinex(),
    'saraf' => register_saraf(),
    'sarmayex' => register_sarmayex(),
    'tabdeal' => register_tabdeal(),
    'tetherland' => register_tetherland(),
    'wallex' => register_wallex(),
    ];
}



// ===== orchestrator =====

/**
 * Scrape orchestration: job-mode scrapers run via parallel http_multi_get;
 * custom scrape_* handlers (pagination) run sequentially afterward.
 */

/**
 * Resolve registry callables that may be string function names or Closures.
 * @param mixed $fn
 * @param mixed ...$args
 * @return mixed
 */
function registry_call(mixed $fn, mixed ...$args): mixed
{
    if (is_string($fn)) {
        if (!function_exists($fn)) {
            throw new RuntimeException("Unknown registry function: {$fn}");
        }
        return $fn(...$args);
    }
    if (is_callable($fn)) {
        return $fn(...$args);
    }
    throw new RuntimeException('Invalid registry callable');
}

/**
 * @param list<array{slug:string,support?:list<string>}> $exchanges
 * @param list<string> $coins
 * @return list<array<string,mixed>>
 */
function scrape_exchanges(array $exchanges, array $coins): array
{
    $registry = scraper_registry();
    $ignored = ignore_list();
    $jobs = [];
    $meta = [];
    $collected = [];

    foreach ($exchanges as $ex) {
        $slug = strtolower($ex['slug']);
        if (in_array($slug, $ignored, true)) {
            log_info("Ignoring exchange: {$slug}");
            continue;
        }
        if (!isset($registry[$slug])) {
            log_info("No PHP scraper for: {$slug}");
            continue;
        }
        $cfg = $registry[$slug];
        if (isset($cfg['skip'])) {
            $reason = registry_call($cfg['skip']);
            if ($reason !== null) {
                log_info("Skipping {$slug}: {$reason}");
                continue;
            }
        }

        $filter = ($cfg['coin_use'] === 'own')
            ? array_values(array_map(static fn($c) => strtoupper((string) $c), $ex['support'] ?? []))
            : $coins;

        if (isset($cfg['scrape'])) {
            $meta[$slug] = ['mode' => 'custom', 'filter' => $filter, 'fn' => $cfg['scrape']];
            continue;
        }

        $job = registry_call($cfg['job']);
        $jobs[$slug] = $job;
        $meta[$slug] = ['mode' => 'job', 'filter' => $filter, 'parse' => $cfg['parse']];
    }

    log_info('Fetching ' . count($jobs) . ' exchange endpoint(s) in parallel…');
    $t0 = microtime(true);
    $responses = http_multi_get($jobs);
    log_info(sprintf('Parallel fetch done in %.1fs', microtime(true) - $t0));

    foreach ($meta as $slug => $m) {
        if ($m['mode'] !== 'job') {
            continue;
        }
        $resp = $responses[$slug] ?? ['ok' => false, 'error' => 'missing response'];
        if (empty($resp['ok'])) {
            log_error("{$slug}: " . ($resp['error'] ?? 'failed'));
            continue;
        }
        try {
            $rows = registry_call($m['parse'], $resp['json'], $m['filter']);
            $collected = array_merge($collected, $rows);
            log_info("{$slug}: " . count($rows) . ' rows');
        } catch (Throwable $e) {
            log_error("{$slug} parse: " . $e->getMessage());
        }
    }

    foreach ($meta as $slug => $m) {
        if ($m['mode'] !== 'custom') {
            continue;
        }
        if (!assert_time_budget(HTTP_TIMEOUT_SEC + 10)) {
            log_error("Skipping {$slug}: time budget");
            continue;
        }
        try {
            $t1 = microtime(true);
            $rows = registry_call($m['fn'], $m['filter']);
            $collected = array_merge($collected, $rows);
            log_info(sprintf('%s: %d rows in %.1fs', $slug, count($rows), microtime(true) - $t1));
        } catch (Throwable $e) {
            log_error("{$slug}: " . $e->getMessage());
        }
    }

    return $collected;
}



// ===== main =====

// =============================================================================
// MAIN
// =============================================================================

/**
 * @param array{
 *   all:bool,exchange:?string,finalize:bool,finalize_only:bool,run_id:?string,
 *   dry_run:bool,from_json:?string,prune_logs:bool,help:bool
 * } $cli
 */
function main(array $cli): int
{
    global $RUN_LOGGER;

    if ($cli['help']) {
        print_help();
        return 0;
    }

    if ($cli['prune_logs'] && !$cli['all'] && $cli['exchange'] === null && !$cli['finalize_only'] && $cli['from_json'] === null) {
        $n = prune_logs(LOG_DIR, LOG_RETENTION_DAYS);
        log_info("Pruned {$n} log file(s) older than " . LOG_RETENTION_DAYS . " days");
        return 0;
    }

    $runId = $cli['run_id'] ?: default_run_id();
    $RUN_LOGGER = new RunLogger(LOG_DIR, INGEST_NODE, $runId);
    log_info('IranCrypto track.php starting (PHP ' . PHP_VERSION . ') run_id=' . $runId);
    log_info('Logs: ' . $RUN_LOGGER->path());
    $RUN_LOGGER->event('run_start', [
        'run_id' => $runId,
        'node' => INGEST_NODE,
        'dry_run' => $cli['dry_run'],
        'finalize' => $cli['finalize'] || $cli['finalize_only'],
    ]);

    if ($cli['finalize_only']) {
        if ($cli['dry_run']) {
            log_info('Dry-run: would finalize ' . $runId);
            $RUN_LOGGER->event('run_end', ['ok' => true, 'dry_run' => true]);
            return 0;
        }
        try {
            finalize_when_ready($runId);
            prune_logs(LOG_DIR, LOG_RETENTION_DAYS);
            $RUN_LOGGER->event('run_end', ['ok' => true]);
            log_info(sprintf('Finalize done in %.1fs', elapsed_sec()));
            return 0;
        } catch (Throwable $e) {
            $RUN_LOGGER->event('finalize_err', ['message' => $e->getMessage()]);
            log_error('Finalize: ' . $e->getMessage());
            $RUN_LOGGER->event('run_end', ['ok' => false]);
            return 1;
        }
    }

    if (!$cli['all'] && $cli['exchange'] === null && $cli['from_json'] === null) {
        log_error('Specify --all, --exchange=SLUG, --from-json=, or --finalize-only');
        print_help();
        return 1;
    }

    if (!assert_time_budget(30)) {
        return 1;
    }

    if ($cli['dry_run'] && INGEST_SECRET === '') {
        log_info('Dry-run without INGEST_SECRET: using empty config (scrapes still need exchange list)');
    }

    $config = [];
    if (!$cli['dry_run'] || INGEST_SECRET !== '') {
        $config = ingest_config();
        $RUN_LOGGER->event('config_ok', [
            'exchanges' => count($config['exchanges'] ?? []),
            'coins' => count($config['coins'] ?? []),
        ]);
    }

    if ($cli['run_id'] === null && !empty($config['run_id_default'])) {
        $runId = (string) $config['run_id_default'];
    }

    $exchanges = [];
    foreach ($config['exchanges'] ?? [] as $ex) {
        if (!is_array($ex) || empty($ex['slug'])) {
            continue;
        }
        $item = ['slug' => (string) $ex['slug']];
        if (!empty($ex['support']) && is_array($ex['support'])) {
            $item['support'] = array_values(array_map('strval', $ex['support']));
        }
        $exchanges[] = $item;
    }
    $coins = array_values(array_map('strtoupper', array_map('strval', $config['coins'] ?? [])));

    $exchanges = select_exchanges($exchanges, $cli);
    $RUN_LOGGER->event('run_start', [
        'run_id' => $runId,
        'node' => INGEST_NODE,
        'exchanges' => array_map(static fn($e) => $e['slug'], $exchanges),
    ]);

    $bySource = [];

    if ($cli['from_json'] !== null) {
        $rawJson = file_get_contents($cli['from_json']);
        if ($rawJson === false) {
            throw new RuntimeException('Cannot read --from-json file');
        }
        $decoded = json_decode($rawJson, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Invalid JSON in --from-json');
        }
        $rows = isset($decoded['rows']) && is_array($decoded['rows']) ? $decoded['rows'] : $decoded;
        foreach ($rows as $row) {
            if (!is_array($row) || empty($row['source'])) {
                continue;
            }
            $src = strtolower((string) $row['source']);
            $bySource[$src][] = $row;
        }
    } else {
        if ($exchanges === [] || $coins === []) {
            log_error('No exchanges or coins from config (check API / filters)');
            return 1;
        }
        $raw = scrape_exchanges($exchanges, $coins);
        $filtered = filter_rows_for_ingest($raw, $coins);
        foreach ($filtered as $row) {
            $bySource[$row['source']][] = $row;
        }
        log_info(sprintf('Discovered %d filtered rows from %d sources', count($filtered), count($bySource)));
    }

    $collectedAt = gmdate('c');
    $ok = true;
    foreach ($bySource as $source => $rows) {
        $RUN_LOGGER->event('scrape_ok', [
            'source' => $source,
            'rows' => count($rows),
        ]);
        $payload = [
            'run_id' => $runId,
            'mode' => 'partial',
            'source' => $source,
            'collected_at' => $collectedAt,
            'node' => INGEST_NODE,
            'rows' => $rows,
            'finalize' => false,
        ];
        if ($cli['dry_run']) {
            log_info("Dry-run: would ingest {$source} rows=" . count($rows));
            $RUN_LOGGER->event('ingest_skip', ['source' => $source, 'reason' => 'dry_run', 'rows' => count($rows)]);
            continue;
        }
        try {
            $t1 = microtime(true);
            $res = ingest_post($payload);
            $RUN_LOGGER->event('ingest_ok', [
                'source' => $source,
                'rows' => count($rows),
                'upserted' => $res['upserted'] ?? null,
                'skipped' => $res['skipped'] ?? null,
                'http' => 200,
                'ms' => (int) round((microtime(true) - $t1) * 1000),
            ]);
            log_info("Ingested {$source}: rows=" . count($rows));
        } catch (Throwable $e) {
            $ok = false;
            $RUN_LOGGER->event('ingest_err', [
                'source' => $source,
                'message' => $e->getMessage(),
            ]);
            log_error("Ingest {$source}: " . $e->getMessage());
        }
    }

    if ($cli['finalize'] && !$cli['dry_run']) {
        try {
            finalize_when_ready($runId);
        } catch (Throwable $e) {
            $ok = false;
            $RUN_LOGGER->event('finalize_err', ['message' => $e->getMessage()]);
            log_error('Finalize: ' . $e->getMessage());
        }
    }

    $pruned = prune_logs(LOG_DIR, LOG_RETENTION_DAYS);
    if ($pruned > 0) {
        log_info("Pruned {$pruned} old log file(s)");
    }
    $RUN_LOGGER->event('run_end', ['ok' => $ok]);
    log_info(sprintf('Done in %.1fs ok=%s', elapsed_sec(), $ok ? 'true' : 'false'));
    return $ok ? 0 : 1;
}

// =============================================================================
// BOOT
// =============================================================================

try {
    $CLI = parse_cli($argv ?? []);
    exit(main($CLI));
} catch (Throwable $e) {
    log_error($e->getMessage());
    if ($RUN_LOGGER instanceof RunLogger) {
        $RUN_LOGGER->event('run_end', ['ok' => false, 'error' => $e->getMessage()]);
    }
    exit(1);
}

