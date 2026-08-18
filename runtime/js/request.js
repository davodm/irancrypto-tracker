/**
 * Exchange HTTP helpers.
 * TLS for exchanges defaults off (SSL_VERIFY_EXCHANGE); proxy responses unwrap {data|body}
 * like PHP/Python for Tabdeal parity. Config is read lazily after dotenv.
 */

import https from "node:https";
import axios from "axios";
import { logError, logInfo } from "./logger.js";
import { envBool, getProxyUrl, getTimeoutSec, getUserAgent, getUserAgentPostman } from "./vars.js";

function exchangeHttpsAgent() {
  return new https.Agent({
    rejectUnauthorized: envBool("SSL_VERIFY_EXCHANGE", false),
  });
}

/**
 * @param {object} options
 * @param {string} options.method
 * @param {string} options.url
 * @param {object} [options.params]
 * @param {object} [options.data]
 * @param {string} [options.userAgent]
 * @param {object} [options.headers]
 * @param {boolean} [options.retry403]
 * @param {boolean} [options.throwOriginalError]
 * @param {boolean} [options.useProxy]
 * @returns {Promise<any>}
 */
export async function axiosRequest({
  method,
  url,
  params = {},
  data = {},
  userAgent = getUserAgent(),
  headers = {},
  retry403 = true,
  throwOriginalError = false,
  useProxy = false,
}) {
  const timeoutMs = getTimeoutSec() * 1000;
  /** @type {import('axios').AxiosRequestConfig} */
  const conf = {
    method,
    url,
    headers: {
      ...headers,
      Accept: "application/json",
      "User-Agent": userAgent,
    },
    responseType: "json",
    timeout: timeoutMs,
    httpsAgent: exchangeHttpsAgent(),
    maxRedirects: 3,
    validateStatus: (status) => status >= 200 && status < 300,
  };
  if (params && Object.keys(params).length) {
    conf.params = params;
  }
  if (data && Object.keys(data).length) {
    conf.data = data;
  }

  // REQUEST_RETRY_COUNT = retries after the first attempt (0 = single try).
  const retries = Number.parseInt(process.env.REQUEST_RETRY_COUNT ?? "0", 10) || 0;
  const baseDelayMs = Number.parseInt(process.env.REQUEST_RETRY_BASE_MS ?? "300", 10) || 300;
  const maxAttempts = 1 + retries;

  const proxyUrl = getProxyUrl();
  const hasProxy = Boolean(proxyUrl && process.env.PROXY_API_KEY);
  const shouldProxy = useProxy && hasProxy;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let response;
      if (shouldProxy) {
        response = await axiosRequestWithProxy({
          method: conf.method,
          url: conf.url,
          params: conf?.params,
          data: conf?.data,
          headers: conf.headers,
        });
      } else {
        response = await axios.request(conf);
      }

      return JSONizeResponse(response, { unwrapProxy: shouldProxy });
    } catch (error) {
      const isNetworkError =
        !!error?.code || /ENOTFOUND|ECONNRESET|ETIMEDOUT/.test(error?.message || "");
      if (error?.response) {
        logInfo(
          `Request to ${url} failed due to ${error.message} (status: ${error.response.status}) [attempt ${attempt}]`,
        );
      } else {
        logInfo(`${error.message} [attempt ${attempt}]`);
      }

      if (retry403 && error?.response?.status === 403 && attempt === 1) {
        logInfo(`Retry with Postman USER-AGENT for ${url}`);
        return await axiosRequest({
          method,
          url,
          params,
          data,
          headers,
          userAgent: getUserAgentPostman(),
          retry403: false,
          useProxy,
        });
      }

      if (isNetworkError && attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      if (throwOriginalError) {
        throw error;
      }

      const statusCode = error?.response?.status;
      const msg = statusCode
        ? `Failed to send request to ${url} server due to ${error.message} (Status: ${statusCode})`
        : `Failed to send request to ${url} server due to ${error.message}`;
      throw new Error(msg);
    }
  }
}

/**
 * @param {any} response - Axios response object.
 * @param {{ unwrapProxy?: boolean }} [opts]
 * @returns {any}
 */
export function JSONizeResponse(response, opts = {}) {
  let out;
  if (!response?.data && response?.data !== 0) {
    throw new Error("Response is empty");
  }
  if (typeof response.data === "object") {
    out = response.data;
  } else {
    try {
      out = JSON.parse(response.data);
    } catch {
      throw new Error("Response is not JSON");
    }
  }

  // Proxy may wrap the target body as { data } or { body } (PHP/Python parity).
  if (opts.unwrapProxy && out && typeof out === "object" && !Array.isArray(out)) {
    let data = out.data ?? out.body ?? out;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        /* keep string */
      }
    }
    out = data;
  }

  return out;
}

/**
 * @param {object} options
 * @param {string} options.method
 * @param {string} options.url
 * @param {object} [options.params]
 * @param {object} [options.data]
 * @param {object} [options.headers]
 * @returns {Promise<any>} Axios response from the proxy
 */
export async function axiosRequestWithProxy({ method, url, params = {}, data = {}, headers = {} }) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    throw new Error("PROXY_URL is not set");
  }

  const proxyApiKey = process.env.PROXY_API_KEY;
  if (!proxyApiKey) {
    throw new Error("PROXY_API_KEY is required when using proxy");
  }

  const timeoutMs = getTimeoutSec() * 1000;

  try {
    return await axios({
      method: "POST",
      url: proxyUrl,
      data: {
        url,
        method: method.toUpperCase(),
        params,
        body: data,
        headers,
        timeout: timeoutMs,
      },
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": proxyApiKey,
      },
      timeout: timeoutMs,
      httpsAgent: exchangeHttpsAgent(),
      maxRedirects: 3,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (error) {
    const err = error?.response?.data?.error ?? error?.response?.data ?? null;
    if (err) {
      logError(err);
    }
    const statusCode = error?.response?.status;
    const errorMessage = statusCode
      ? `Failed to send request to ${url} server via proxy due to ${error.message} (Status: ${statusCode})`
      : `Failed to send request to ${url} server via proxy due to ${error.message}`;
    throw new Error(errorMessage);
  }
}
