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
            throw new RuntimeException(
                'Finalize wait timed out for ' . $runId . '; missing: ' . implode(',', $missing)
            );
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
        if (empty($d['price']) || (float) $d['price'] <= 0) {
            continue;
        }
        if (empty($d['volume_1d']) || (float) $d['volume_1d'] <= 0) {
            continue;
        }
        if (empty($d['source'])) {
            continue;
        }
        $sym = strtoupper((string) ($d['symbol'] ?? ''));
        if ($sym === '' || !isset($coinSet[$sym])) {
            continue;
        }
        $row = [
            'symbol' => $sym,
            'currency' => strtoupper((string) ($d['currency'] ?? 'IRR')),
            'price' => (float) $d['price'],
            'volume_1d' => (float) $d['volume_1d'],
            'source' => strtolower((string) $d['source']),
        ];
        if (isset($d['coin_volume_1d'])) {
            $row['coin_volume_1d'] = (float) $d['coin_volume_1d'];
        }
        if (isset($d['change_1d'])) {
            $row['change_1d'] = (float) $d['change_1d'];
        }
        if (isset($d['change_7d'])) {
            $row['change_7d'] = (float) $d['change_7d'];
        }
        if (isset($d['market_cap'])) {
            $row['market_cap'] = (float) $d['market_cap'];
        }
        if (isset($d['supply'])) {
            $row['supply'] = (float) $d['supply'];
        }
        if (isset($d['max_supply'])) {
            $row['max_supply'] = (float) $d['max_supply'];
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
    $out = [];
    foreach ($exchanges as $ex) {
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

