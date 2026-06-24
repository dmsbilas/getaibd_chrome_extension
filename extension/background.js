// background.js — GetAIBD API client (Manifest V3 service worker).
// All network calls happen here so we have host permission and avoid page CORS.

const API_BASE = "https://getaibd.com/v1/api";

// Read the saved API key from storage.
async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  return apiKey || "";
}

function authHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Transient gateway/server errors worth retrying.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// One fetch attempt with a hard timeout so a stalled gateway doesn't hang us.
async function fetchOnce(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Generic helper that throws a readable Error on failure.
// Retries transient gateway errors (502/503/504/429/etc.) and timeouts, which
// are common with non-streamed completions behind a load balancer.
async function apiFetch(path, { method = "GET", key, body, retries = 2, timeoutMs = 90000 } = {}) {
  const apiKey = key || (await getApiKey());
  if (!apiKey) {
    throw new Error("No API key saved. Open the extension options and add your GetAIBD key.");
  }

  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: authHeaders(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(800 * attempt); // simple linear backoff

    let res;
    try {
      res = await fetchOnce(url, options, timeoutMs);
    } catch (err) {
      // Network failure or timeout (AbortError) — retry while we have attempts.
      lastErr = new Error(
        err.name === "AbortError"
          ? "The request timed out. The server took too long to respond."
          : `Network error: ${err.message || String(err)}`
      );
      continue;
    }

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { raw: text };
    }

    if (res.ok) return data;

    const msg =
      (data && (data.error?.message || data.error || data.message)) ||
      `Request failed (HTTP ${res.status})`;
    lastErr = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));

    // Retry transient server/gateway errors; fail fast on 4xx like 401/403.
    if (!RETRYABLE_STATUS.has(res.status)) break;
  }

  throw lastErr || new Error("Request failed.");
}

// Coerce a value to a finite number, or null if it isn't one.
function toNumber(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && isFinite(n) ? n : null;
}

// Public catalog with per-model pricing (credits per 1k tokens). It has no auth
// and is the same source the getaibd.com pricing page uses, so we rely on it to
// fill in rates that the OpenAI-compatible /models endpoint may omit.
async function getCatalogPriceMap() {
  try {
    const res = await fetch("https://getaibd.com/v1/catalog");
    if (!res.ok) return {};
    const data = await res.json();
    const families = Array.isArray(data?.families) ? data.families : [];
    const map = {};
    for (const fam of families) {
      const models = Array.isArray(fam?.models) ? fam.models : [];
      for (const m of models) {
        if (!m?.id) continue;
        map[m.id] = {
          inputTokenRate: toNumber(m.input_token_rate),
          outputTokenRate: toNumber(m.token_rate),
          modality: fam.modality,
        };
      }
    }
    return map;
  } catch (_) {
    return {};
  }
}

// Flat, price-sortable model list straight from the public catalog
// (getaibd.com/v1/catalog). No API key required — used so the dropdown can
// always show the model list from getaibd.com, even before a key is entered.
async function getCatalogModels() {
  const map = await getCatalogPriceMap();
  return Object.entries(map).map(([id, p]) => ({
    id,
    name: id,
    modality: p.modality,
    inputTokenRate: p.inputTokenRate ?? null,
    outputTokenRate: p.outputTokenRate ?? null,
  }));
}

// GET /models -> { data: [{ id, name, ... }] }
// Each model is enriched with input/output token rates (credits per 1k tokens)
// so the options page can sort the list by price.
async function getModels(key) {
  const data = await apiFetch("/models", { key });
  const list = Array.isArray(data?.data) ? data.data : [];
  const priceMap = await getCatalogPriceMap();

  return list.map((m) => {
    const price = priceMap[m.id] || {};
    return {
      id: m.id,
      name: m.name || m.id,
      modality: m.modality || price.modality,
      inputTokenRate: toNumber(m.input_token_rate) ?? price.inputTokenRate ?? null,
      outputTokenRate: toNumber(m.token_rate) ?? price.outputTokenRate ?? null,
    };
  });
}

// GET /balance -> { credits_balance: number }
async function getBalance(key) {
  const data = await apiFetch("/balance", { key });
  return data?.credits_balance;
}

// POST /chat/completions (non-streaming) -> assistant text
async function chat({ model, pageText, pageUrl, pageTitle, question, history }) {
  if (!model) throw new Error("No model selected. Choose a model in the extension options.");

  const context = [
    pageTitle ? `Page title: ${pageTitle}` : "",
    pageUrl ? `Page URL: ${pageUrl}` : "",
    pageText ? `Page content:\n${pageText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "You are a helpful assistant embedded in a Chrome extension. " +
        "Answer the user's question using the provided web page content. " +
        "If the answer is not in the page, say so and answer from general knowledge.",
    },
  ];

  // If we have conversation history, include it so the model remembers context
  if (Array.isArray(history) && history.length > 0) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add the current question with page context
  messages.push({
    role: "user",
    content: `${context}\n\n---\nQuestion: ${question}`,
  });

  const data = await apiFetch("/chat/completions", {
    method: "POST",
    body: { model, messages, stream: false },
  });

  const answer = data?.choices?.[0]?.message?.content;
  return {
    answer: answer || "(No content returned by the model.)",
    usage: data?.usage,
  };
}

// Pages we can't inject the panel into.
const RESTRICTED_URL = /^(chrome|edge|about|chrome-extension|devtools|view-source|moz-extension|chrome-search):/;

// Clicking the toolbar icon injects (and toggles) the draggable in-page panel.
// panel.js itself removes the panel if it's already open, so injecting again
// acts as a toggle.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  if (RESTRICTED_URL.test(tab.url || "")) {
    // Can't run on browser/system pages; nothing we can do here.
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["panel.js"],
    });
  } catch (err) {
    console.warn("GetAIBD: could not open panel on this page:", err);
  }
});

// Message router for the in-page panel and the options page.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "getModels":
          sendResponse({ ok: true, models: await getModels(msg.key) });
          break;
        case "getCatalog":
          sendResponse({ ok: true, models: await getCatalogModels() });
          break;
        case "getBalance":
          sendResponse({ ok: true, balance: await getBalance(msg.key) });
          break;
        case "chat":
          sendResponse({ ok: true, ...(await chat(msg.payload)) });
          break;
        case "openOptions":
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});
