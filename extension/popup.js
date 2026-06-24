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

// How much page text to send to the model. Larger = more complete page
// understanding, at the cost of more tokens/credits per request.
const MAX_PAGE_CHARS = 20000;

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

// ── Page extraction (runs IN the page) ───────────────
// This async function is serialized and injected via chrome.scripting
// .executeScript with `func`, which awaits the returned Promise and reliably
// hands the value back to the popup. It is "render-aware": it waits for the DOM
// to settle, auto-scrolls to trigger lazy-loaded content, and reads text from
// open shadow DOM (web components) — so dynamic / client-rendered pages work.
// It must be fully self-contained (no references to popup.js scope).
async function extractPageContent(perFrameMax) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Resolve once the document has loaded (capped so we never hang).
  function waitForReady(maxWait) {
    if (document.readyState === "complete") return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, maxWait);
      window.addEventListener(
        "load",
        () => {
          clearTimeout(t);
          res();
        },
        { once: true }
      );
    });
  }

  // Resolve once the DOM has been "quiet" (no mutations) for a short window,
  // or when maxWait elapses — this waits out client-side rendering.
  function waitForSettle(maxWait) {
    return new Promise((resolve) => {
      let quiet = null;
      let observer = null;
      const hard = setTimeout(done, maxWait);
      function done() {
        clearTimeout(hard);
        if (quiet) clearTimeout(quiet);
        if (observer) observer.disconnect();
        resolve();
      }
      function bump() {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(done, 400);
      }
      try {
        observer = new MutationObserver(bump);
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      } catch (_) {}
      bump();
    });
  }

  // Scroll through the page in steps to trigger lazy-load / infinite scroll,
  // then restore the original position.
  async function autoScroll() {
    try {
      const startY = window.scrollY;
      const total = Math.min(
        (document.documentElement && document.documentElement.scrollHeight) || 0,
        80000
      );
      const step = Math.max(window.innerHeight * 0.9, 500);
      const steps = Math.min(Math.ceil(total / step), 25);
      for (let i = 1; i <= steps; i++) {
        window.scrollTo(0, step * i);
        await sleep(100);
      }
      window.scrollTo(0, startY);
      await sleep(150);
    } catch (_) {}
  }

  function clean(text) {
    return (text || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  // Recursively collect text from open shadow roots, which innerText misses.
  function collectShadowText() {
    const parts = [];
    function textOf(root) {
      let s = "";
      root.childNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          s += n.textContent;
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          const tag = n.tagName ? n.tagName.toLowerCase() : "";
          if (tag !== "script" && tag !== "style" && tag !== "noscript") {
            s += " " + (n.innerText || n.textContent || "");
          }
        }
      });
      return s;
    }
    function walk(node) {
      const els = node.querySelectorAll ? node.querySelectorAll("*") : [];
      els.forEach((el) => {
        if (el.shadowRoot) {
          parts.push(textOf(el.shadowRoot));
          walk(el.shadowRoot);
        }
      });
    }
    try {
      walk(document);
    } catch (_) {}
    return parts.join("\n");
  }

  function richestText() {
    const candidates = [
      document.querySelector("main"),
      document.querySelector("article"),
      document.querySelector("[role='main']"),
      document.querySelector("#content, #main, .content, .main"),
      document.body,
      document.documentElement,
    ];
    let best = "";
    for (const el of candidates) {
      if (!el) continue;
      const t = el.innerText || el.textContent || "";
      if (t.length > best.length) best = t;
    }
    return best;
  }

  // Wait → scroll → wait again so scroll-triggered content is captured.
  await waitForReady(4000);
  await waitForSettle(4000);
  await autoScroll();
  await waitForSettle(2500);

  let text = richestText();
  const shadow = collectShadowText();
  if (shadow && shadow.trim() && !text.includes(shadow)) {
    text = text + "\n\n" + shadow;
  }
  text = clean(text);

  const metaDesc =
    (document.querySelector('meta[name="description"]') || {}).content ||
    (document.querySelector('meta[property="og:description"]') || {}).content ||
    "";
  if (metaDesc && !text.includes(metaDesc)) {
    text = clean(metaDesc + "\n\n" + text);
  }

  if (text.length > perFrameMax) text = text.slice(0, perFrameMax);

  return {
    isTop: window === window.top,
    title: document.title || "",
    url: location.href,
    text,
    readyState: document.readyState,
  };
}

// ── Read active page ─────────────────────────────────
async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source|moz-extension):/.test(tab.url || "")) {
    throw new Error("This page can't be read by extensions (browser/system page).");
  }

  // Run in every frame so embedded iframes (docs, players, widgets) are read
  // too. If subframe injection isn't permitted, fall back to the top frame.
  async function injectFrames(allFrames) {
    const execResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames },
      func: extractPageContent,
      args: [MAX_PAGE_CHARS],
    });
    return Array.isArray(execResult) ? execResult : execResult?.results || [];
  }

  let results;
  try {
    results = await injectFrames(true);
  } catch (_) {
    try {
      results = await injectFrames(false);
    } catch (execErr) {
      throw new Error(
        "Could not access this page. Reload the page, then click the extension again.\n\n" +
        "Details: " + (execErr.message || String(execErr))
      );
    }
  }

  const frames = (results || []).map((r) => r && r.result).filter(Boolean);
  if (frames.length === 0) {
    throw new Error(
      "Could not extract page content. Try reloading the page and asking again."
    );
  }

  // Merge: top frame first, then content-rich child frames, up to the budget.
  const top = frames.find((f) => f.isTop) || frames[0];
  let combined = top.text || "";
  const others = frames
    .filter((f) => f !== top && f.text && f.text.trim().length > 200)
    .sort((a, b) => b.text.length - a.text.length);
  for (const f of others) {
    if (combined.length >= MAX_PAGE_CHARS) break;
    combined += `\n\n--- [embedded frame: ${f.url}] ---\n${f.text}`;
  }
  if (combined.length > MAX_PAGE_CHARS) combined = combined.slice(0, MAX_PAGE_CHARS);

  if (!combined || combined.trim().length === 0) {
    throw new Error(
      "This page has no readable text yet" +
      (top.readyState && top.readyState !== "complete"
        ? " (still loading). Wait for it to finish loading and try again."
        : ". It may render content to <canvas> or block reading.")
    );
  }

  return { title: top.title, url: top.url, text: combined, readyState: top.readyState };
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
