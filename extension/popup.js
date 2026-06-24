// popup.js — reads the active page and asks the GetAIBD API.
const promptEl = document.getElementById("prompt");
const askBtn = document.getElementById("ask");
const answerEl = document.getElementById("answer");
const statusEl = document.getElementById("status");
const mainEl = document.getElementById("main");
const needsSetup = document.getElementById("needsSetup");

document.getElementById("settings").addEventListener("click", openOptions);
document.getElementById("openOptions").addEventListener("click", openOptions);

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function setStatus(msg, kind = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// Show setup prompt if no key/model saved.
async function init() {
  const { apiKey, model } = await chrome.storage.local.get(["apiKey", "model"]);
  if (!apiKey || !model) {
    mainEl.classList.add("hidden");
    needsSetup.classList.remove("hidden");
  }
}

// Inject content.js into the active tab and get its returned page data.
async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("This page can't be read by extensions.");
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
  if (!result || !result.result) throw new Error("Could not extract page content.");
  return result.result; // { title, url, text }
}

askBtn.addEventListener("click", async () => {
  const question = promptEl.value.trim();
  if (!question) {
    setStatus("Type a question first.", "err");
    return;
  }

  answerEl.classList.add("hidden");
  answerEl.textContent = "";
  askBtn.disabled = true;
  setStatus("Reading page…");

  try {
    const { model } = await chrome.storage.local.get("model");
    const page = await readActivePage();

    setStatus("Thinking…");
    const res = await send({
      type: "chat",
      payload: {
        model,
        pageText: page.text,
        pageUrl: page.url,
        pageTitle: page.title,
        question,
      },
    });

    if (!res || !res.ok) throw new Error(res?.error || "Request failed.");

    answerEl.textContent = res.answer;
    answerEl.classList.remove("hidden");
    const u = res.usage;
    setStatus(u ? `Done · ${u.total_tokens ?? "?"} tokens` : "Done");
  } catch (err) {
    setStatus(err.message || String(err), "err");
  } finally {
    askBtn.disabled = false;
  }
});

// Submit with Cmd/Ctrl+Enter.
promptEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") askBtn.click();
});

init();
