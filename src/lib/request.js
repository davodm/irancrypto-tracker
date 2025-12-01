import axios from "axios";
import { logError, logInfo } from "./logger.js";
import { USER_AGENT, USER_AGENT_POSTMAN, TIMEOUT } from "./vars.js";
import https from "https";

const agent = new https.Agent({
  rejectUnauthorized: false, // Disable SSL certificate validation (only if necessary)
});

const PROXY_URL = process.env.PROXY_URL;

export async function axiosRequest({
  method,
  url,
  params = {},
  data = {},
  userAgent = USER_AGENT,
  headers = {},
  retry403 = true,
  throwOriginalError = false,
  useProxy = false,
}) {
  let tried = 0;
  const conf = {
    method: method,
    url: url,
    headers: {
      ...headers,
      Accept: "application/json",
      "User-Agent": userAgent,
    },
    responseType: "json",
    timeout: TIMEOUT * 1000,
    httpsAgent: agent, // Disable SSL certificate validation (only if necessary)
    maxRedirects: 3,
    validateStatus: function (status) {
      return status >= 200 && status < 300;
    },
  };
  if (params && Object.keys(params).length) {
    conf.params = params;
  }
  if (data && Object.keys(data).length) {
    conf.data = data;
  }

  // Retry/backoff configuration
  // `REQUEST_RETRY_COUNT` defines how many retries to perform on failure (not including the first attempt).
  // If it's 0 or not set, the function will perform a single attempt and will not retry.
  const retries = Number.parseInt(process.env.REQUEST_RETRY_COUNT ?? "0", 10) || 0;
  const baseDelayMs = Number.parseInt(process.env.REQUEST_RETRY_BASE_MS ?? "300", 10) || 300;
  const maxAttempts = 1 + retries; // total attempts = initial try + retries

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let response;
      // Send request via proxy
      if (useProxy) {
        // Send with proxy
        response = await axiosRequestWithProxy({
          method: conf.method,
          url: conf.url,
          params: conf?.params,
          data: conf?.data,
          headers: conf.headers,
        });
      } else {
        // First Try with Actual USER-AGENT
        response = await axios(conf);
      }

      // Check if the response is valid or convert it to valid JSON
      const result = JSONizeResponse(response);

      return result;
    } catch (error) {
      // Log the error (include attempt number)
      const isNetworkError = !!error?.code || /ENOTFOUND|ECONNRESET|ETIMEDOUT/.test(error?.message || '');
      if (error?.response) {
        logInfo(`Request to ${url} failed due to ${error.message} (status: ${error.response.status}) [attempt ${attempt}]`);
      } else {
        logInfo(`${error.message} [attempt ${attempt}]`);
      }

      // If failed with 403, Try with Postman USER-AGENT (only on first attempt)
      if (retry403 && error?.response?.status === 403 && attempt === 1) {
        logInfo(`Retry with Postman USER-AGENT for ${url}`);
        return await axiosRequest({
          method,
          url,
          params,
          data,
          headers,
          userAgent: USER_AGENT_POSTMAN,
          retry403: false,
        });
      }

      // If network error and attempts left, wait and retry
      if (isNetworkError && attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      // If throwOriginalError requested, rethrow the original axios error
      if (throwOriginalError) {
        throw error;
      }

      // Otherwise throw a normalized error
      const statusCode = error?.response?.status;
      const msg = statusCode
        ? `Failed to send request to ${url} server due to ${error.message} (Status: ${statusCode})`
        : `Failed to send request to ${url} server due to ${error.message}`;
      throw new Error(msg);
    }
  }
}

/**
 * Validate Axios response data and convert it to JSON if necessary.
 * @param {object} response - Axios response object.
 * @returns {object} - JSON response data.
 */
export function JSONizeResponse(response) {
  let out;
  // Check if the response is empty
  if (!response?.data) {
    throw new Error("Response is empty");
  }
  // Check if the response is JSON
  if (typeof response.data === "object") {
    out = response.data;
  } else {
    // The response is text, but let's attempt to convert it to JSON
    try {
      out = JSON.parse(response.data);
    } catch (e) {
      throw new Error("Response is not JSON");
    }
  }
  return out;
}

/**
 * Send request to the proxy server to bypass Local CORS issue.
 * @param {object} options - Request options.
 * @param {string} options.method - HTTP method.
 * @param {string} options.url - Request URL.
 * @param {object} options.params - Request query parameters.
 * @param {object} options.data - Request body data.
 * @param {object} options.headers - Request headers.
 *
 * @returns {Promise<object>} - Response data from the proxy server.
 */
export async function axiosRequestWithProxy({
  method,
  url,
  params = {},
  data = {},
  headers = {},
}) {
  if (!PROXY_URL) {
    throw new Error("PROXY_URL is not set");
  }

  const proxyApiKey = process.env.PROXY_API_KEY;
  if (!proxyApiKey) {
    throw new Error("PROXY_API_KEY is required when using proxy");
  }

  try {
    return await axios({
      method: "POST",
      url: PROXY_URL,
      data: {
        url,
        method: method.toUpperCase(),
        params,
        body: data,
        headers,
        timeout: TIMEOUT * 1000,
      },
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": proxyApiKey,
      },
      timeout: TIMEOUT * 1000,
      maxRedirects: 3,
      validateStatus: function (status) {
        return status >= 200 && status < 300;
      },
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
