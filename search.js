const path = require("node:path");

const {
  getErrorDetails,
  jsonResponse,
  loadEnvFile,
  parseJsonString,
  searchPlaces,
} = require("../../lib/sitecraft-core");

loadEnvFile(path.resolve(__dirname, "..", "..", ".env"));

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." }, { Allow: "POST" });
  }

  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    const body = parseJsonString(rawBody);
    const payload = await searchPlaces(body || {});
    return jsonResponse(200, payload);
  } catch (error) {
    const response = getErrorDetails(error);
    return jsonResponse(response.statusCode, response.payload);
  }
};
