import axios from "axios";
import { USER_AGENT, USER_AGENT_POSTMAN, TIMEOUT } from "./vars.js";

export async function axiosRequest({
  method,
  url,
  params = {},
  data = {},
  userAgent = USER_AGENT,
  headers = {},
  retry403 = true,
  throwOriginalError = false,
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
    // First Try with Actual USER-AGENT
    const response = await axios(conf);
    tried++;

    // Check if the response is valid or convert it to valid JSON
    const result = JSONizeResponse(response);

    return result;
  } catch (error) {
    // If failed with 403, Try with Postman USER-AGENT
    if (retry403 && error.response?.status === 403 && !tried) {
      return await request({
        method,
        url,
        params,
        data,
        headers,
        userAgent: USER_AGENT_POSTMAN,
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
