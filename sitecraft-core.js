const crypto = require("node:crypto");
const fs = require("node:fs");

const APIFY_RUN_CACHE = new Map();
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function getConfigPayload() {
  return {
    defaultCtaLink: getDefaultCtaLink(),
    hasApifyConfig: hasApifyConfig(),
    hasOutboundWebhook: Boolean(process.env.OUTREACH_WEBHOOK_URL),
  };
}

async function searchPlaces(input) {
  const location = sanitizeText(input.location);
  const businessType = sanitizeText(input.businessType);
  const keyword = sanitizeText(input.keyword);
  const pageSize = clampNumber(input.pageSize, 5, 50, 15);
  const minReviews = clampNumber(input.minReviews, 0, 100000, 20);
  const onlyNoWebsite = Boolean(input.onlyNoWebsite);

  if (!location) {
    throw badRequest("Add a location first.");
  }
  if (!businessType) {
    throw badRequest("Add a business type like cafe, clinic, salon, or gym.");
  }

  const apifyConfig = await resolveApifyConfig(input);
  const searchString = [businessType, keyword].filter(Boolean).join(" ");
  const actorInput = buildApifyInput(apifyConfig.baseInput, {
    location,
    pageSize,
    searchString,
  });

  const rawPlaces = await runApifyActor(
    apifyConfig.actorId,
    apifyConfig.token,
    actorInput
  );

  let leads = rawPlaces
    .filter(Boolean)
    .map((place) => normalizeApifyLead(place, { businessType, location }));

  leads = leads.filter((lead) => lead.reviewCount >= minReviews);

  if (onlyNoWebsite) {
    leads = leads.filter((lead) => !lead.websiteUrl);
  }

  leads.sort(compareLeads);

  return {
    meta: {
      location,
      businessType,
      minReviews,
      onlyNoWebsite,
      returned: leads.length,
      source: "Apify Google Maps Scraper",
    },
    results: leads,
  };
}

async function dispatchLead(input) {
  const lead = input.lead || {};
  const message = sanitizeText(input.message);
  const webhookUrl = sanitizeText(process.env.OUTREACH_WEBHOOK_URL);

  if (!lead.id || !sanitizeText(lead.name)) {
    throw badRequest("Pick a lead before dispatching it.");
  }
  if (!message) {
    throw badRequest("Generate or edit the outreach message before dispatching it.");
  }
  if (!webhookUrl) {
    throw badRequest(
      "Outbound webhook is not configured. Add OUTREACH_WEBHOOK_URL to your .env to automate dispatch."
    );
  }

  const payload = {
    lead,
    message,
    senderName: sanitizeText(input.senderName),
    senderBrand: sanitizeText(input.senderBrand),
    demoLink: sanitizeText(input.demoLink),
    ctaLink: sanitizeText(input.ctaLink),
    meetingLink: sanitizeText(input.meetingLink),
    generatedAt: new Date().toISOString(),
    source: "sitecraft-prospect-ai",
  };

  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body).toString(),
    "X-SiteCraft-Source": "sitecraft-prospect-ai",
  };

  const webhookSecret = sanitizeText(process.env.WEBHOOK_SECRET);
  if (webhookSecret) {
    headers["X-SiteCraft-Signature"] = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body,
  });

  const responseText = await response.text();

  if (!response.ok) {
    const error = new Error(`Webhook dispatch failed: ${response.status} ${responseText}`);
    error.statusCode = 502;
    error.publicMessage = "Your webhook rejected the outreach payload.";
    throw error;
  }

  return {
    ok: true,
    status: response.status,
    message: "Lead payload sent to your automation webhook.",
    responsePreview: responseText.slice(0, 400),
  };
}

async function resolveApifyConfig(input) {
  const directToken = sanitizeText(process.env.APIFY_TOKEN);
  const directActorId = sanitizeText(process.env.APIFY_ACTOR_ID);
  const directRunUrl =
    sanitizeText(process.env.APIFY_RUN_URL) || sanitizeText(input.apifyRunUrl);

  if (directToken && directActorId) {
    return {
      token: directToken,
      actorId: directActorId,
      baseInput: getDefaultApifyInput(),
    };
  }

  if (!directRunUrl) {
    throw badRequest(
      "Add your Apify run URL in the setup panel or put APIFY_RUN_URL in .env."
    );
  }

  if (APIFY_RUN_CACHE.has(directRunUrl)) {
    return APIFY_RUN_CACHE.get(directRunUrl);
  }

  const parsed = parseApifyRunUrl(directRunUrl);
  const metadata = await fetchJson(
    `https://api.apify.com/v2/actor-runs/${encodeURIComponent(
      parsed.runId
    )}?token=${encodeURIComponent(parsed.token)}`
  );

  const actorId = sanitizeText(metadata?.data?.actId);
  const defaultStoreId = sanitizeText(metadata?.data?.defaultKeyValueStoreId);

  if (!actorId) {
    throw badRequest("Could not resolve the Apify actor ID from the run URL.");
  }

  let baseInput = getDefaultApifyInput();
  if (defaultStoreId) {
    try {
      const savedInput = await fetchJson(
        `https://api.apify.com/v2/key-value-stores/${encodeURIComponent(
          defaultStoreId
        )}/records/INPUT?token=${encodeURIComponent(parsed.token)}`
      );

      if (savedInput && typeof savedInput === "object" && !Array.isArray(savedInput)) {
        baseInput = { ...baseInput, ...savedInput };
      }
    } catch (error) {
      console.warn("Falling back to local Apify defaults because saved input could not be loaded.");
    }
  }

  const config = {
    token: parsed.token,
    actorId,
    baseInput,
  };

  APIFY_RUN_CACHE.set(directRunUrl, config);
  return config;
}

function buildApifyInput(baseInput, params) {
  const enrichmentLimit = Math.max(
    params.pageSize,
    clampNumber(baseInput.maximumLeadsEnrichmentRecords, 0, 250, params.pageSize)
  );

  return {
    ...getDefaultApifyInput(),
    ...baseInput,
    locationQuery: params.location,
    searchStringsArray: [params.searchString],
    maxCrawledPlacesPerSearch: params.pageSize,
    language: sanitizeText(baseInput.language) || getDefaultApifyLanguage(),
    includeWebResults: false,
    scrapeContacts: true,
    scrapeDirectories: true,
    scrapeImageAuthors: false,
    scrapePlaceDetailPage: true,
    scrapeTableReservationProvider: false,
    website: "allPlaces",
    maxQuestions: 0,
    maxReviews: 0,
    maxImages: 0,
    maximumLeadsEnrichmentRecords: enrichmentLimit,
  };
}

async function runApifyActor(actorId, token, actorInput) {
  const response = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(
      actorId
    )}/run-sync-get-dataset-items?token=${encodeURIComponent(
      token
    )}&clean=true&format=json&timeout=120`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(actorInput),
    }
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Apify actor run failed: ${response.status} ${responseText}`);
  }

  const parsed = responseText ? JSON.parse(responseText) : [];
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeApifyLead(place, context) {
  const reviewCount = Number(place.reviewsCount || 0);
  const rating = Number(place.totalScore || 0);
  const websiteUrl = sanitizeText(place.website);
  const phoneRaw =
    sanitizeText(place.phoneUnformatted) || sanitizeText(place.phone);
  const emails = extractEmailsFromObject(place);
  const isClosed = Boolean(place.permanentlyClosed || place.temporarilyClosed);

  const lead = {
    id:
      sanitizeText(place.placeId) ||
      sanitizeText(place.cid) ||
      sanitizeText(place.fid) ||
      sanitizeText(place.url) ||
      sanitizeText(place.title) ||
      crypto.randomUUID(),
    name: sanitizeText(place.title) || "Unknown business",
    address: sanitizeText(place.address) || "Address not available",
    rating,
    reviewCount,
    websiteUrl,
    hasWebsite: Boolean(websiteUrl),
    phone: phoneRaw || null,
    whatsappNumber: toWhatsAppNumber(phoneRaw),
    emails,
    primaryEmail: emails[0] || null,
    mapsUrl: sanitizeText(place.url) || null,
    businessStatus: isClosed ? "CLOSED" : "OPERATIONAL",
    primaryType:
      sanitizeText(place.categoryName) || sanitizeText(context.businessType),
    types: Array.isArray(place.categories) ? place.categories : [],
    locationLabel: context.location,
    requestedType: context.businessType,
    imageUrl: sanitizeText(place.imageUrl) || null,
    searchString: sanitizeText(place.searchString),
  };

  lead.fitScore = scoreLead(lead);
  lead.whyItRanks = buildWhyItRanks(lead);
  return lead;
}

function scoreLead(lead) {
  let score = 0;
  if (!lead.hasWebsite) score += 74;
  if (lead.whatsappNumber) score += 18;
  if (lead.primaryEmail) score += 14;
  if (lead.businessStatus === "OPERATIONAL") score += 12;
  score += Math.min(lead.reviewCount, 500) * 0.5;
  score += lead.rating * 15;
  return Math.round(score);
}

function compareLeads(a, b) {
  if (a.hasWebsite !== b.hasWebsite) {
    return Number(a.hasWebsite) - Number(b.hasWebsite);
  }
  if (b.reviewCount !== a.reviewCount) {
    return b.reviewCount - a.reviewCount;
  }
  if (b.rating !== a.rating) {
    return b.rating - a.rating;
  }
  return b.fitScore - a.fitScore;
}

function buildWhyItRanks(lead) {
  const reasons = [];
  if (!lead.hasWebsite) reasons.push("No website detected");
  reasons.push(`${lead.reviewCount} reviews`);
  if (lead.rating) reasons.push(`${lead.rating.toFixed(1)} rating`);
  if (lead.primaryEmail) reasons.push("Business email found");
  if (lead.whatsappNumber) reasons.push("WhatsApp-ready phone found");
  return reasons;
}

function hasApifyConfig() {
  return Boolean(
    sanitizeText(process.env.APIFY_RUN_URL) ||
      (sanitizeText(process.env.APIFY_TOKEN) &&
        sanitizeText(process.env.APIFY_ACTOR_ID))
  );
}

function parseApifyRunUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/v2\/actor-runs\/([^/]+)/);
    const runId = match?.[1];
    const token = url.searchParams.get("token");

    if (!runId || !token) {
      throw new Error("missing runId or token");
    }

    return { runId, token };
  } catch (error) {
    throw badRequest(
      "Apify run URL must look like https://api.apify.com/v2/actor-runs/<runId>?token=<token>."
    );
  }
}

function getDefaultApifyInput() {
  return {
    includeWebResults: false,
    language: getDefaultApifyLanguage(),
    locationQuery: "",
    maxCrawledPlacesPerSearch: 15,
    maximumLeadsEnrichmentRecords: 15,
    scrapeContacts: true,
    scrapeDirectories: true,
    scrapeImageAuthors: false,
    scrapePlaceDetailPage: true,
    scrapeReviewsPersonalData: true,
    scrapeSocialMediaProfiles: {
      facebooks: false,
      instagrams: false,
      tiktoks: false,
      twitters: false,
      youtubes: false,
    },
    scrapeTableReservationProvider: false,
    searchStringsArray: ["restaurant"],
    skipClosedPlaces: false,
    searchMatching: "all",
    placeMinimumStars: "",
    website: "allPlaces",
    maxQuestions: 0,
    maxReviews: 0,
    reviewsSort: "newest",
    reviewsFilterString: "",
    reviewsOrigin: "all",
    maxImages: 0,
    allPlacesNoSearchAction: "",
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "GET" });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${responseText}`);
  }
  return responseText ? JSON.parse(responseText) : {};
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function sanitizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractEmailsFromObject(value, seen = new Set()) {
  const found = new Map();

  walk(value);
  return Array.from(found.values());

  function walk(current) {
    if (!current) return;

    if (typeof current === "string") {
      if (!current.includes("@")) return;
      collectEmails(current);
      return;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        walk(item);
      }
      return;
    }

    if (typeof current === "object") {
      if (seen.has(current)) return;
      seen.add(current);

      for (const item of Object.values(current)) {
        walk(item);
      }
    }
  }

  function collectEmails(input) {
    const matches = input.match(EMAIL_PATTERN) || [];
    for (const match of matches) {
      const normalized = match
        .replace(/^mailto:/i, "")
        .replace(/^[<("'`\s]+|[>),;:'"`\s]+$/g, "")
        .toLowerCase();

      if (!normalized || !normalized.includes("@")) continue;
      if (!found.has(normalized)) {
        found.set(normalized, normalized);
      }
    }
  }
}

function toWhatsAppNumber(value) {
  const digits = sanitizeText(value).replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.replace(/^\+/, "").replace(/^00/, "");
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.publicMessage = message;
  return error;
}

function parseJsonString(raw) {
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw badRequest("Request body must be valid JSON.");
  }
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function getErrorDetails(error) {
  return {
    statusCode: error.statusCode || 500,
    payload: {
      error: error.publicMessage || "Something went wrong on the server.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message,
    },
  };
}

function getDefaultCtaLink() {
  return process.env.DEFAULT_CTA_LINK || "https://ayushfun77-tech.github.io/SiteCraft";
}

function getDefaultApifyLanguage() {
  return process.env.APIFY_LANGUAGE || "en";
}

module.exports = {
  badRequest,
  dispatchLead,
  getConfigPayload,
  getErrorDetails,
  jsonResponse,
  loadEnvFile,
  parseJsonString,
  searchPlaces,
};
