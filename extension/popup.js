// popup.js — ChatGPT-style conversation UI with drag-and-drop.
const conversationEl = document.getElementById("conversation");
const welcomeMsg   = document.getElementById("welcome-msg");
const chatInput    = document.getElementById("chat-input");
const sendBtn      = document.getElementById("send-btn");
const statusEl     = document.getElementById("status");
const mainEl       = document.getElementById("main");
const needsSetup   = document.getElementById("needsSetup");

// ── State ────────────────────────────────────────────
let conversation = [];  // { role: "user"|"assistant", content: string }
let processing   = false;

// ── Buttons ──────────────────────────────────────────
document.getElementById("settings-btn").addEventListener("click", openOptions);
document.getElementById("openOptions").addEventListener("click", openOptions);
document.getElementById("clear-btn").addEventListener("click", clearConversation);
document.getElementById("copy-btn").addEventListener("click", copyConversation);

function openOptions() {
  chrome.runtime.openOptionsPage();
}

// ── Persistence ──────────────────────────────────────
async function saveConversation() {
  await chrome.storage.local.set({ conversation });
}

async function loadConversation() {
  const data = await chrome.storage.local.get("conversation");
  if (Array.isArray(data.conversation) && data.conversation.length > 0) {
    conversation = data.conversation;
    welcomeMsg.classList.add("hidden");
  } else {
    conversation = [];
    welcomeMsg.classList.remove("hidden");
  }
  renderConversation();
}

// ── Clear conversation ───────────────────────────────
async function clearConversation() {
  conversation = [];
  welcomeMsg.classList.remove("hidden");
  renderConversation();
  await chrome.storage.local.remove("conversation");
  setStatus("Conversation cleared.");
}

// ── Copy conversation to clipboard ───────────────────
async function copyConversation() {
  if (conversation.length === 0) {
    setStatus("Nothing to copy.");
    return;
  }
  const lines = conversation.map(msg => {
    const label = msg.role === "user" ? "You" : "GetAIBD";
    return `**${label}:** ${msg.content}`;
  });
  const text = lines.join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied to clipboard ✓");
  } catch (err) {
    setStatus("Could not copy: " + (err.message || String(err)), "err");
  }
}

// ── Status helpers ───────────────────────────────────
function setStatus(msg, kind = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// ── Send message to background service worker ─────────
function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// ── Setup gate ───────────────────────────────────────
async function init() {
  const { apiKey, model } = await chrome.storage.local.get(["apiKey", "model"]);
  if (!apiKey || !model) {
    mainEl.classList.add("hidden");
    needsSetup.classList.remove("hidden");
    return;
  }
  mainEl.classList.remove("hidden");
  needsSetup.classList.add("hidden");
  await loadConversation();
}

// ── Read active page ─────────────────────────────────
async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || "")) {
    throw new Error("This page can't be read by extensions.");
  }

  // Try executing content.js.  If the page hasn't finished loading or
  // chrome.scripting is restricted, give a clear error.
  let result;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    result = results && results[0];
  } catch (execErr) {
    throw new Error(
      "Could not read page. The page may still be loading or restricted. " +
      "Try reloading the page and clicking the extension again.\n\n" +
      "Details: " + (execErr.message || String(execErr))
    );
  }

  if (!result || !result.result) {
    throw new Error(
      "Could not extract page content. The page might be dynamic or not fully loaded."
    );
  }

  // Ensure we have usable text
  const page = result.result;
  if (!page.text || page.text.trim().length === 0) {
    throw new Error("Page content is empty — nothing to ask about.");
  }

  return page; // { title, url, text }
}

// ── Simple Markdown-to-HTML renderer ─────────────────
function renderMarkdown(text) {
  if (!text) return "";

  // Escape HTML first
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```lang\n code \n```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre><code class="language-${lang || "plaintext"}">${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Unordered lists: lines starting with - or *
  html = html.replace(/^[ \t]*[-*] (.+)$/gm, "<li>$1</li>");
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists: lines starting with 1. 2. etc.
  html = html.replace(/^[ \t]*\d+\. (.+)$/gm, "<li>$1</li>");
  // Any <li> that isn't already inside <ul> gets wrapped
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
    if (match.startsWith("<ul>")) return match; // already wrapped
    return "<ol>" + match + "</ol>";
  });

  // Headers: ### text, ## text, # text
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Horizontal rules: --- or ***
  html = html.replace(/^(?:---|\*\*\*)$/gm, "<hr>");

  // Blockquotes: > text
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs: blank line → <br>
  html = html.replace(/\n\n/g, "<br><br>");

  return html;
}

// ── Render conversation ──────────────────────────────
function renderConversation() {
  // Remove all dynamic messages (keep welcome if present)
  const existing = conversationEl.querySelectorAll(".message:not(.welcome)");
  existing.forEach((el) => el.remove());

  conversation.forEach((msg, idx) => {
    const div = document.createElement("div");
    div.className = "message " + msg.role;

    const content = document.createElement("div");
    content.className = "message-content";

    if (msg.role === "assistant") {
      content.innerHTML = renderMarkdown(msg.content);
    } else {
      content.textContent = msg.content;
    }

    div.appendChild(content);
    conversationEl.appendChild(div);
  });

  // Scroll to bottom
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

// ── Ask the API ──────────────────────────────────────
async function ask(question) {
  if (processing) return;
  processing = true;
  sendBtn.disabled = true;
  setStatus("Reading page…", "thinking");

  try {
    const { model } = await chrome.storage.local.get("model");
    const page = await readActivePage();

    // Add user message
    conversation.push({ role: "user", content: question });
    welcomeMsg.classList.add("hidden");
    renderConversation();
    await saveConversation();
    chatInput.value = "";
    autoResizeInput();

    setStatus("Thinking…", "thinking");
    const res = await send({
      type: "chat",
      payload: {
        model,
        pageText: page.text,
        pageUrl: page.url,
        pageTitle: page.title,
        question,
        // Send conversation history so the model remembers
        history: conversation.slice(0, -1), // all except the user message we just added
      },
    });

    if (!res || !res.ok) throw new Error(res?.error || "Request failed. Check your API key in settings.");

    // Add assistant message
    conversation.push({ role: "assistant", content: res.answer || "(No response)" });
    renderConversation();
    await saveConversation();

    const u = res.usage;
    setStatus(u ? `Done · ${u.total_tokens ?? "?"} tokens` : "Done");
  } catch (err) {
    const errMsg = err.message || String(err);
    setStatus(errMsg, "err");
    conversation.push({
      role: "assistant",
      content: "Sorry, something went wrong: " + errMsg,
    });
    renderConversation();
    await saveConversation();
  } finally {
    processing = false;
    sendBtn.disabled = false;
  }
}

// ── Send handler ─────────────────────────────────────
function handleSend() {
  const question = chatInput.value.trim();
  if (!question || processing) return;
  ask(question);
}

sendBtn.addEventListener("click", handleSend);

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// ── Auto-resize textarea ─────────────────────────────
function autoResizeInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
}
chatInput.addEventListener("input", autoResizeInput);

// ── Drag-and-drop (cursor feedback only) ─────────────
const dragHandle = document.getElementById("drag-handle");
let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
if (dragHandle) {
  dragHandle.addEventListener("mousedown", dragMouseDown);
}

function dragMouseDown(e) {
  e.preventDefault();
  pos3 = e.clientX;
  pos4 = e.clientY;
  document.onmouseup = closeDragElement;
  document.onmousemove = elementDrag;
}

function elementDrag(e) {
  e.preventDefault();
  pos1 = pos3 - e.clientX;
  pos2 = pos4 - e.clientY;
  pos3 = e.clientX;
  pos4 = e.clientY;
  dragHandle.style.cursor = "grabbing";
}

function closeDragElement() {
  document.onmouseup = null;
  document.onmousemove = null;
  if (dragHandle) dragHandle.style.cursor = "grab";
}

init();
