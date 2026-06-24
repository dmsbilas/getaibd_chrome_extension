// options.js — settings page logic.
const keyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("model");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const balanceEl = document.getElementById("balance");

// Model selected by default when nothing has been saved yet.
const DEFAULT_MODEL = "qwen-flash";

let debounceTimer = null;

// The price we sort by: output token rate, falling back to input token rate.
function priceOf(m) {
  if (typeof m.outputTokenRate === "number") return m.outputTokenRate;
  if (typeof m.inputTokenRate === "number") return m.inputTokenRate;
  return null;
}

// Cheapest first; models without a known price are pushed to the end.
function byPriceAsc(a, b) {
  const ap = priceOf(a);
  const bp = priceOf(b);
  if (ap === null && bp === null) return a.id.localeCompare(b.id);
  if (ap === null) return 1;
  if (bp === null) return -1;
  if (ap !== bp) return ap - bp;
  return a.id.localeCompare(b.id);
}

function formatRate(r) {
  if (typeof r !== "number") return null;
  return (Math.round(r * 100) / 100).toLocaleString();
}

// e.g. "qwen-flash (chat · 1.84 in / 5.52 out credits/1k)"
function modelLabel(m) {
  const meta = [];
  if (m.modality) meta.push(m.modality);
  const inRate = formatRate(m.inputTokenRate);
  const outRate = formatRate(m.outputTokenRate);
  if (inRate !== null || outRate !== null) {
    meta.push(`${inRate ?? "?"} in / ${outRate ?? "?"} out credits/1k`);
  }
  return meta.length ? `${m.id} (${meta.join(" · ")})` : m.id;
}

function setStatus(msg, kind = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// Load saved settings on open.
async function restore() {
  const { apiKey, model } = await chrome.storage.local.get(["apiKey", "model"]);
  if (apiKey) {
    keyInput.value = apiKey;
    await loadModels(apiKey, model);
  }
}

async function loadModels(key, selected) {
  if (!key) {
    modelSelect.innerHTML = '<option value="">Enter a valid API key to load models…</option>';
    modelSelect.disabled = true;
    saveBtn.disabled = true;
    return;
  }

  setStatus("Validating key and loading models…");
  modelSelect.disabled = true;
  saveBtn.disabled = true;

  const res = await send({ type: "getModels", key });
  if (!res || !res.ok) {
    setStatus(res?.error || "Failed to load models.", "err");
    modelSelect.innerHTML = '<option value="">Could not load models</option>';
    return;
  }

  const models = res.models || [];
  if (models.length === 0) {
    modelSelect.innerHTML = '<option value="">No models available for this key</option>';
    setStatus("Key valid, but no models are available.", "err");
    return;
  }

  const sorted = [...models].sort(byPriceAsc);

  modelSelect.innerHTML = "";
  for (const m of sorted) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = modelLabel(m);
    modelSelect.appendChild(opt);
  }

  // Default to qwen-flash whenever it's available; only fall back to a
  // previously saved model (or the cheapest one) if qwen-flash is missing.
  if (sorted.some((m) => m.id === DEFAULT_MODEL)) {
    modelSelect.value = DEFAULT_MODEL;
  } else if (selected && sorted.some((m) => m.id === selected)) {
    modelSelect.value = selected;
  }
  modelSelect.disabled = false;
  saveBtn.disabled = false;
  setStatus(`Loaded ${models.length} model(s).`, "ok");

  // Best-effort balance display.
  const bal = await send({ type: "getBalance", key });
  if (bal?.ok && typeof bal.balance !== "undefined") {
    balanceEl.textContent = `Balance: ${bal.balance} credits`;
  }
}

keyInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const key = keyInput.value.trim();
  balanceEl.textContent = "";
  debounceTimer = setTimeout(() => loadModels(key), 600);
});

saveBtn.addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  const model = modelSelect.value;
  if (!apiKey || !model) {
    setStatus("Please provide a valid key and select a model.", "err");
    return;
  }
  await chrome.storage.local.set({ apiKey, model });
  setStatus("Settings saved ✓", "ok");
});

restore();
