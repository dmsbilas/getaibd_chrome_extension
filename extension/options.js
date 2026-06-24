// options.js — settings page logic.
const keyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("model");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const balanceEl = document.getElementById("balance");

let debounceTimer = null;

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

  modelSelect.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.modality ? `${m.id} (${m.modality})` : m.id;
    modelSelect.appendChild(opt);
  }
  if (selected && models.some((m) => m.id === selected)) {
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
