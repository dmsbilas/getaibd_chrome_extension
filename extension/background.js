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

// Generic helper that throws a readable Error on failure.
async function apiFetch(path, { method = "GET", key, body } = {}) {
  const apiKey = key || (await getApiKey());
  if (!apiKey) {
    throw new Error("No API key saved. Open the extension options and add your GetAIBD key.");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: authHeaders(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && (data.error?.message || data.error || data.message)) ||
      `Request failed (HTTP ${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

// GET /models -> { data: [{ id, name, ... }] }
async function getModels(key) {
  const data = await apiFetch("/models", { key });
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    modality: m.modality,
  }));
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

// Message router for options/popup pages.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "getModels":
          sendResponse({ ok: true, models: await getModels(msg.key) });
          break;
        case "getBalance":
          sendResponse({ ok: true, balance: await getBalance(msg.key) });
          break;
        case "chat":
          sendResponse({ ok: true, ...(await chat(msg.payload)) });
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
