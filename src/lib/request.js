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
    tried++;

    // Check if the response is valid or convert it to valid JSON
    const result = JSONizeResponse(response);

    return result;
  } catch (error) {
    // Access to body of error response
    if (error?.response) {
      logInfo(`Request to ${url} failed due to ${error.message}`);
    } else {
      logInfo(error.message);
    }
    // If failed with 403, Try with Postman USER-AGENT (only if not tried yet)
    if (retry403 && error?.response?.status === 403 && tried === 0) {
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
    // Throw the original error if requested
    if (throwOriginalError) {
      throw error;
    }

    // Throw custom error
    throw new Error(
      `Failed to send request to ${url} server due to ${error.message}`
    );
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
