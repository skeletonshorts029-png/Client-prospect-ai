const path = require("node:path");

const {
  getConfigPayload,
  getErrorDetails,
  jsonResponse,
  loadEnvFile,
} = require("../../lib/sitecraft-core");

loadEnvFile(path.resolve(__dirname, "..", "..", ".env"));

exports.handler = async function handler(event) {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." }, { Allow: "GET" });
  }

  try {
    return jsonResponse(200, getConfigPayload());
  } catch (error) {
    const response = getErrorDetails(error);
    return jsonResponse(response.statusCode, response.payload);
  }
};
