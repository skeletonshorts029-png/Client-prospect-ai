const STORAGE_KEY = "sitecraft-prospect-ai-draft-v3";

const state = {
  config: null,
  leads: [],
  selectedLeadId: null,
  lastMeta: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  restoreDraft();
  await loadConfig();
  primeDefaults();
  refreshMessage();
});

function cacheElements() {
  const ids = [
    "apifyRunUrl",
    "businessType",
    "configStatusBadge",
    "copyMessageButton",
    "ctaLink",
    "customHook",
    "demoLink",
    "dispatchButton",
    "location",
    "meetingLink",
    "messageOutput",
    "messageTone",
    "minReviews",
    "onlyNoWebsite",
    "openCtaButton",
    "openMapsButton",
    "openWhatsAppButton",
    "pageSize",
    "refreshMessageButton",
    "resultsGrid",
    "saveDraftButton",
    "searchForm",
    "searchSummary",
    "selectedLeadCard",
    "senderBrand",
    "senderName",
    "spotlightCard",
    "toast",
    "keyword",
  ];

  for (const id of ids) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.searchForm.addEventListener("submit", handleSearch);
  els.saveDraftButton.addEventListener("click", () => {
    saveDraft();
    showToast("Draft saved locally.");
  });
  els.refreshMessageButton.addEventListener("click", refreshMessage);
  els.copyMessageButton.addEventListener("click", copyMessage);
  els.openWhatsAppButton.addEventListener("click", openWhatsAppDraft);
  els.dispatchButton.addEventListener("click", dispatchLead);
  els.openMapsButton.addEventListener("click", () => openLink(getSelectedLead()?.mapsUrl));
  els.openCtaButton.addEventListener("click", () => openLink(els.ctaLink.value));

  [
    "apifyRunUrl",
    "businessType",
    "ctaLink",
    "customHook",
    "demoLink",
    "keyword",
    "location",
    "meetingLink",
    "messageTone",
    "minReviews",
    "onlyNoWebsite",
    "pageSize",
    "senderBrand",
    "senderName",
  ].forEach((id) => {
    els[id].addEventListener("input", syncDraftAndMessage);
    els[id].addEventListener("change", syncDraftAndMessage);
  });

  els.resultsGrid.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    const leadCard = event.target.closest("[data-lead-id]");
    if (!leadCard) return;

    const leadId = leadCard.getAttribute("data-lead-id");
    if (!leadId) return;

    if (actionButton && actionButton.getAttribute("data-action") === "maps") {
      event.stopPropagation();
      openLink(findLead(leadId)?.mapsUrl);
      return;
    }

    state.selectedLeadId = leadId;
    renderSelectedLead();
    refreshMessage();
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    state.config = config;

    if (!els.ctaLink.value && config.defaultCtaLink) {
      els.ctaLink.value = config.defaultCtaLink;
    }

    els.configStatusBadge.textContent = config.hasApifyConfig
      ? "Server has Apify config"
      : "Paste Apify run URL locally";

    showToast(
      config.hasOutboundWebhook
        ? "Automation webhook is configured on the server."
        : "Webhook automation is off. WhatsApp draft mode still works."
    );
  } catch (error) {
    els.configStatusBadge.textContent = "Server config unavailable";
    showToast("Could not load server config. The UI is still usable.");
  }

  refreshActionButtons();
}

async function handleSearch(event) {
  event.preventDefault();
  showToast("Searching Apify...");

  const payload = {
    apifyRunUrl: els.apifyRunUrl.value.trim(),
    location: els.location.value.trim(),
    businessType: els.businessType.value.trim(),
    keyword: els.keyword.value.trim(),
    minReviews: Number(els.minReviews.value || 0),
    onlyNoWebsite: els.onlyNoWebsite.checked,
    pageSize: Number(els.pageSize.value || 15),
  };

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Search failed.");
    }

    state.leads = Array.isArray(data.results) ? data.results : [];
    state.lastMeta = data.meta || null;
    state.selectedLeadId = state.leads[0]?.id || null;

    renderAll();
    showToast(
      state.leads.length
        ? `Found ${state.leads.length} ranked Apify leads.`
        : "No matching leads came back. Try widening the location or lowering min reviews."
    );
  } catch (error) {
    showToast(error.message || "Search failed.");
  }
}

function renderAll() {
  renderSummary();
  renderSpotlight();
  renderResults();
  renderSelectedLead();
  refreshMessage();
}

function renderSummary() {
  if (!state.lastMeta) {
    els.searchSummary.textContent = "No search yet";
    return;
  }

  const source = state.lastMeta.source ? ` via ${state.lastMeta.source}` : "";
  els.searchSummary.textContent = `${state.lastMeta.returned} leads for ${state.lastMeta.businessType} in ${state.lastMeta.location}${source}`;
}

function renderSpotlight() {
  const lead = state.leads[0];
  if (!lead) {
    els.spotlightCard.className = "spotlight-card empty-card";
    els.spotlightCard.textContent = "Run a real search to see your top-ranked lead.";
    return;
  }

  els.spotlightCard.className = "spotlight-card";
  els.spotlightCard.innerHTML = `
    ${renderLeadMedia(lead, "large")}
    <div class="lead-copy">
      <div class="score-row">
        <div class="score-chip">${lead.fitScore}</div>
        <div>
          <p class="eyebrow">Best lead now</p>
          <h3>${escapeHtml(lead.name)}</h3>
          <p>${escapeHtml(lead.address)}</p>
        </div>
      </div>
      <div class="badge-row">
        ${renderStatusBadge(lead)}
        <span class="badge badge-muted">${lead.reviewCount} reviews</span>
        <span class="badge badge-muted">${Number(lead.rating || 0).toFixed(1)} rating</span>
        <span class="badge badge-muted">${escapeHtml(lead.primaryType || lead.requestedType || "Business")}</span>
      </div>
      ${renderLeadContacts(lead)}
      <div class="lead-meta">
        ${lead.whyItRanks.map((item) => `<span>${escapeHtml(item)}</span>`).join(" | ")}
      </div>
    </div>
  `;
}

function renderResults() {
  if (!state.leads.length) {
    els.resultsGrid.innerHTML = `<article class="lead-card empty-card">No results yet. Search a real location and business type.</article>`;
    return;
  }

  els.resultsGrid.innerHTML = state.leads
    .map((lead) => {
      const isSelected = lead.id === state.selectedLeadId;
      return `
        <article class="lead-card" data-lead-id="${escapeHtml(lead.id)}" style="${
          isSelected ? "outline: 1px solid rgba(120, 216, 255, 0.55);" : ""
        }">
          ${renderLeadMedia(lead, "small")}
          <div class="lead-topline">
            <div class="score-chip">${lead.fitScore}</div>
            <div>
              <h3>${escapeHtml(lead.name)}</h3>
              <p>${escapeHtml(lead.address)}</p>
            </div>
          </div>
          <div class="badge-row">
            ${renderStatusBadge(lead)}
            <span class="badge badge-muted">${lead.reviewCount} reviews</span>
            <span class="badge badge-muted">${Number(lead.rating || 0).toFixed(1)} rating</span>
            <span class="badge badge-muted">${escapeHtml(lead.primaryType || lead.requestedType || "Business")}</span>
          </div>
          ${renderLeadContacts(lead)}
          <div class="lead-meta">
            ${lead.whyItRanks.map((item) => `<span>${escapeHtml(item)}</span>`).join(" | ")}
          </div>
          <div class="card-actions">
            <button class="button button-secondary" data-action="select" type="button">Select</button>
            <button class="button button-ghost" data-action="maps" type="button">Maps</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSelectedLead() {
  const lead = getSelectedLead();
  if (!lead) {
    els.selectedLeadCard.className = "selected-lead-card";
    els.selectedLeadCard.innerHTML = "Pick a lead from the results to start composing.";
    refreshActionButtons();
    return;
  }

  els.selectedLeadCard.className = "selected-lead-card";
  els.selectedLeadCard.innerHTML = `
    ${renderLeadMedia(lead, "small")}
    <p class="eyebrow">Selected lead</p>
    <h3>${escapeHtml(lead.name)}</h3>
    <p>${escapeHtml(lead.address)}</p>
    <div class="badge-row">
      ${renderStatusBadge(lead)}
      <span class="badge badge-muted">${lead.reviewCount} reviews</span>
      <span class="badge badge-muted">${Number(lead.rating || 0).toFixed(1)} rating</span>
    </div>
    ${renderLeadContacts(lead)}
    <p><strong>Category:</strong> ${escapeHtml(lead.primaryType || lead.requestedType || "Business")}</p>
  `;

  refreshActionButtons();
}

function refreshMessage() {
  const lead = getSelectedLead();
  if (!lead) {
    els.messageOutput.value = "";
    refreshActionButtons();
    return;
  }

  const senderName = els.senderName.value.trim();
  const senderBrand = els.senderBrand.value.trim();
  const demoLink = els.demoLink.value.trim();
  const ctaLink = els.ctaLink.value.trim();
  const meetingLink = els.meetingLink.value.trim();
  const customHook = els.customHook.value.trim();
  const tone = els.messageTone.value;
  const location = els.location.value.trim() || lead.locationLabel || "";
  const businessType =
    els.businessType.value.trim() || lead.requestedType || lead.primaryType || "business";

  const introMap = {
    direct: `Hi ${lead.name}, I found your ${businessType} while reviewing strong local businesses in ${location}.`,
    friendly: `Hi ${lead.name}, I came across your ${businessType} in ${location} and noticed how many great reviews you already have.`,
    premium: `Hi ${lead.name}, your ${businessType} already has strong local proof with ${lead.reviewCount} reviews in ${location}.`,
  };

  const body = [
    introMap[tone] || introMap.friendly,
    lead.hasWebsite
      ? "You already have a website, but I still think there is room to improve the conversion flow and first impression."
      : "I could not find a proper website for you, so I built a quick demo showing how your business could look online.",
    demoLink ? `Demo link: ${demoLink}` : "Paste your demo link here and I will include it automatically.",
    customHook || "",
    ctaLink ? `You can also check this here: ${ctaLink}` : "",
    meetingLink ? `If you want to talk, book a short call here: ${meetingLink}` : "",
    [senderName, senderBrand].filter(Boolean).join(senderName && senderBrand ? " | " : ""),
  ]
    .filter(Boolean)
    .join("\n\n");

  els.messageOutput.value = body;
  refreshActionButtons();
}

function refreshActionButtons() {
  const lead = getSelectedLead();
  const message = els.messageOutput.value.trim();
  const whatsappUrl = lead ? buildWhatsAppUrl(lead.whatsappNumber, message) : "";

  els.copyMessageButton.disabled = !message;
  els.openWhatsAppButton.disabled = !whatsappUrl;
  els.openMapsButton.disabled = !lead?.mapsUrl;
  els.openCtaButton.disabled = !els.ctaLink.value.trim();
  els.dispatchButton.disabled = !message || !lead || !state.config?.hasOutboundWebhook;
}

async function copyMessage() {
  const message = els.messageOutput.value.trim();
  if (!message) {
    showToast("There is no message to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(message);
    showToast("Message copied.");
  } catch (error) {
    showToast("Clipboard copy failed. You can still copy manually.");
  }
}

function openWhatsAppDraft() {
  const lead = getSelectedLead();
  const message = els.messageOutput.value.trim();
  const url = buildWhatsAppUrl(lead?.whatsappNumber, message);

  if (!url) {
    showToast("This lead does not have a usable phone number for a WhatsApp draft.");
    return;
  }

  openLink(url);
}

async function dispatchLead() {
  const lead = getSelectedLead();
  if (!lead) {
    showToast("Pick a lead first.");
    return;
  }

  if (!state.config?.hasOutboundWebhook) {
    showToast("Add OUTREACH_WEBHOOK_URL to your server .env to enable automated dispatch.");
    return;
  }

  try {
    const response = await fetch("/api/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead,
        message: els.messageOutput.value.trim(),
        senderName: els.senderName.value.trim(),
        senderBrand: els.senderBrand.value.trim(),
        demoLink: els.demoLink.value.trim(),
        ctaLink: els.ctaLink.value.trim(),
        meetingLink: els.meetingLink.value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Dispatch failed.");
    }
    showToast("Lead payload sent to your automation.");
  } catch (error) {
    showToast(error.message || "Dispatch failed.");
  }
}

function syncDraftAndMessage() {
  saveDraft();
  refreshMessage();
}

function saveDraft() {
  const payload = {
    apifyRunUrl: els.apifyRunUrl.value,
    businessType: els.businessType.value,
    ctaLink: els.ctaLink.value,
    customHook: els.customHook.value,
    demoLink: els.demoLink.value,
    keyword: els.keyword.value,
    location: els.location.value,
    meetingLink: els.meetingLink.value,
    messageTone: els.messageTone.value,
    minReviews: els.minReviews.value,
    onlyNoWebsite: els.onlyNoWebsite.checked,
    pageSize: els.pageSize.value,
    senderBrand: els.senderBrand.value,
    senderName: els.senderName.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreDraft() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return false;
  try {
    const draft = JSON.parse(saved);
    for (const [key, value] of Object.entries(draft)) {
      if (!(key in els) || !els[key]) continue;
      if (els[key].type === "checkbox") {
        els[key].checked = Boolean(value);
      } else {
        els[key].value = value;
      }
    }
    return true;
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

function primeDefaults() {
  if (!els.senderName.value) els.senderName.value = "Ayush";
  if (!els.senderBrand.value) els.senderBrand.value = "SiteCraft";
  if (!els.ctaLink.value) {
    els.ctaLink.value = "https://ayushfun77-tech.github.io/SiteCraft/";
  }
}

function getSelectedLead() {
  return state.leads.find((lead) => lead.id === state.selectedLeadId) || null;
}

function findLead(id) {
  return state.leads.find((lead) => lead.id === id) || null;
}

function buildWhatsAppUrl(number, message) {
  if (!number || !message) return "";
  return `https://wa.me/${encodeURIComponent(number)}?text=${encodeURIComponent(message)}`;
}

function openLink(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderStatusBadge(lead) {
  return lead.hasWebsite
    ? `<span class="badge badge-warn">Website exists</span>`
    : `<span class="badge badge-good">No website found</span>`;
}

function renderLeadMedia(lead, size) {
  if (lead.imageUrl) {
    return `<img class="lead-media lead-media-${size}" src="${escapeHtml(
      lead.imageUrl
    )}" alt="${escapeHtml(lead.name)}" loading="lazy" />`;
  }

  return `<div class="lead-media-fallback lead-media-fallback-${size}">${escapeHtml(
    getInitials(lead.name)
  )}</div>`;
}

function renderLeadContacts(lead) {
  return `
    <div class="contact-strip">
      <div class="contact-chip">
        <span class="contact-label">Business email</span>
        ${renderContactValue(
          lead.primaryEmail,
          lead.primaryEmail ? `mailto:${encodeURIComponent(lead.primaryEmail)}` : "",
          "Not found"
        )}
      </div>
      <div class="contact-chip">
        <span class="contact-label">Phone</span>
        ${renderContactValue(
          lead.phone,
          lead.phone ? `tel:${encodeURIComponent(lead.phone)}` : "",
          "Not available"
        )}
      </div>
    </div>
  `;
}

function renderContactValue(value, href, emptyLabel) {
  if (!value) {
    return `<span class="contact-value contact-value-empty">${escapeHtml(emptyLabel)}</span>`;
  }

  if (href) {
    return `<a class="contact-value contact-link" href="${escapeHtml(href)}">${escapeHtml(
      value
    )}</a>`;
  }

  return `<span class="contact-value">${escapeHtml(value)}</span>`;
}

function getInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "SC";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message) {
  els.toast.textContent = message;
}
