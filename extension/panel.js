// panel.js — draggable in-page assistant panel.
// Injected on demand by background.js when the toolbar icon is clicked.
// The whole file is one IIFE so it can be re-injected safely (re-injection
// toggles the panel off), and it keeps a single floating panel in the page
// using a Shadow DOM so the page's CSS can't interfere with our UI.
(function () {
  "use strict";

  const HOST_ID = "__getaibd_panel_host__";
  const DEFAULT_MODEL = "qwen-flash";
  const MAX_PAGE_CHARS = 20000;

  // Toggle: if the panel is already open, close it and stop.
  const existingHost = document.getElementById(HOST_ID);
  if (existingHost) {
    existingHost.remove();
    return;
  }

  // ── State ──────────────────────────────────────────
  let conversation = [];
  let processing = false;

  // ── Styles (Shadow DOM, isolated from the page) ─────
  const STYLES = `
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  .gaibd-panel {
    position: fixed; top: 20px; right: 20px;
    width: 390px; max-width: calc(100vw - 24px);
    height: 540px; max-height: calc(100vh - 40px);
    display: flex; flex-direction: column;
    background: #1e1f24; color: #e8e8ea;
    border: 1px solid #34353b; border-radius: 12px;
    box-shadow: 0 14px 44px rgba(0,0,0,.55);
    z-index: 2147483646; overflow: hidden; font-size: 14px;
  }
  .gaibd-header { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#26272d; border-bottom:1px solid #34353b; cursor: grab; user-select:none; }
  .gaibd-header.dragging { cursor: grabbing; }
  .gaibd-grip { color:#6b6c72; font-size:13px; letter-spacing:1px; }
  .gaibd-title { font-weight:600; flex:1; white-space:nowrap; }
  .gaibd-actions { display:flex; gap:2px; }
  .gaibd-actions button { background:transparent; border:none; color:#b8b9bf; cursor:pointer; font-size:14px; padding:4px 6px; border-radius:6px; line-height:1; }
  .gaibd-actions button:hover { background:#34353b; color:#fff; }
  .gaibd-modelrow { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid #2c2d33; }
  .gaibd-modelrow label { color:#9a9ba1; font-size:12px; }
  .gaibd-modelrow select { flex:1; background:#2a2b31; color:#e8e8ea; border:1px solid #3a3b42; border-radius:8px; padding:6px 8px; font-size:12px; outline:none; }
  .gaibd-setup { padding:20px 16px; text-align:center; color:#c4c5cb; }
  .gaibd-setup button { margin-top:10px; background:#2f6fed; color:#fff; border:none; border-radius:8px; padding:8px 14px; cursor:pointer; font-size:13px; }
  .gaibd-conversation { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
  .gaibd-conversation::-webkit-scrollbar { width:8px; }
  .gaibd-conversation::-webkit-scrollbar-thumb { background:#3a3b42; border-radius:4px; }
  .gaibd-welcome { color:#8a8b91; text-align:center; margin:auto; padding:0 16px; }
  .gaibd-msg { max-width:86%; padding:8px 12px; border-radius:12px; line-height:1.45; word-wrap:break-word; overflow-wrap:anywhere; animation: gaibd-fade .18s ease; }
  @keyframes gaibd-fade { from { opacity:0; transform: translateY(4px);} to { opacity:1; transform:none; } }
  .gaibd-msg.user { align-self:flex-end; background:#2f6fed; color:#fff; border-bottom-right-radius:4px; white-space:pre-wrap; }
  .gaibd-msg.assistant { align-self:flex-start; background:#2a2b31; border-bottom-left-radius:4px; }
  .gaibd-msg.assistant p { margin:0 0 8px; } .gaibd-msg.assistant *:last-child { margin-bottom:0; }
  .gaibd-msg pre { background:#15161a; padding:8px; border-radius:8px; overflow-x:auto; margin:6px 0; }
  .gaibd-msg code { background:#15161a; padding:1px 5px; border-radius:4px; font-family: ui-monospace, Menlo, monospace; font-size:12px; }
  .gaibd-msg pre code { padding:0; background:none; }
  .gaibd-msg ul, .gaibd-msg ol { margin:6px 0; padding-left:20px; }
  .gaibd-msg h2,.gaibd-msg h3,.gaibd-msg h4 { margin:8px 0 4px; }
  .gaibd-status { padding:4px 12px; font-size:11px; color:#8a8b91; min-height:18px; }
  .gaibd-status.err { color:#ff6b6b; } .gaibd-status.thinking { color:#f0c674; }
  .gaibd-inputbar { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #34353b; background:#26272d; }
  .gaibd-inputbar textarea { flex:1; resize:none; background:#2a2b31; color:#e8e8ea; border:1px solid #3a3b42; border-radius:10px; padding:8px 10px; font-size:13px; max-height:100px; outline:none; line-height:1.4; }
  .gaibd-inputbar button { width:40px; min-width:40px; background:#2f6fed; border:none; color:#fff; border-radius:10px; font-size:16px; cursor:pointer; }
  .gaibd-inputbar button:disabled { opacity:.5; cursor:default; }
  .gaibd-hidden { display:none !important; }
  .gaibd-overlay { position:fixed; inset:0; z-index:2147483645; cursor:grabbing; background:transparent; }
  `;

  // ── Build the panel inside a Shadow DOM ─────────────
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  // Use a constructable stylesheet so strict page CSP can't block our styles.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    shadow.adoptedStyleSheets = [sheet];
  } catch (_) {
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLES;
    shadow.appendChild(styleEl);
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="gaibd-panel">
      <div class="gaibd-header" id="gaibd-drag">
        <span class="gaibd-grip">\u2630</span>
        <span class="gaibd-title">GetAIBD Assistant</span>
        <div class="gaibd-actions">
          <button id="gaibd-clear" title="Clear conversation">\u{1F5D1}</button>
          <button id="gaibd-copy" title="Copy conversation">\u{1F4CB}</button>
          <button id="gaibd-settings" title="Settings (API key)">\u2699</button>
          <button id="gaibd-close" title="Close">\u2715</button>
        </div>
      </div>
      <div class="gaibd-modelrow">
        <label for="gaibd-model">Model</label>
        <select id="gaibd-model"><option value="">Loading models\u2026</option></select>
      </div>
      <div class="gaibd-setup gaibd-hidden" id="gaibd-setup">
        <p>Add your GetAIBD API key to start asking about this page.</p>
        <button id="gaibd-open-options">Open settings</button>
      </div>
      <div class="gaibd-conversation" id="gaibd-conversation">
        <div class="gaibd-welcome" id="gaibd-welcome">Ask anything about this page.</div>
      </div>
      <div class="gaibd-status" id="gaibd-status"></div>
      <div class="gaibd-inputbar">
        <textarea id="gaibd-input" rows="1" placeholder="Ask about this page\u2026"></textarea>
        <button id="gaibd-send" title="Send">\u27A4</button>
      </div>
    </div>
  `;
  shadow.appendChild(wrapper);
  (document.documentElement || document.body).appendChild(host);

  const $ = (id) => shadow.getElementById(id);
  const panelEl = shadow.querySelector(".gaibd-panel");
  const dragHandle = $("gaibd-drag");
  const modelSelect = $("gaibd-model");
  const setupEl = $("gaibd-setup");
  const conversationEl = $("gaibd-conversation");
  const welcomeEl = $("gaibd-welcome");
  const statusEl = $("gaibd-status");
  const inputEl = $("gaibd-input");
  const sendBtn = $("gaibd-send");

  // ── Helpers ─────────────────────────────────────────
  const store = {
    get: (keys) => chrome.storage.local.get(keys),
    set: (obj) => chrome.storage.local.set(obj),
    remove: (k) => chrome.storage.local.remove(k),
  };
  const send = (message) =>
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg || "";
    statusEl.className = "gaibd-status" + (kind ? " " + kind : "");
  }

  // ── Model price sorting (mirrors the options page) ──
  function priceOf(m) {
    if (typeof m.outputTokenRate === "number") return m.outputTokenRate;
    if (typeof m.inputTokenRate === "number") return m.inputTokenRate;
    return null;
  }
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
  function modelLabel(m) {
    const meta = [];
    if (m.modality) meta.push(m.modality);
    const inR = formatRate(m.inputTokenRate);
    const outR = formatRate(m.outputTokenRate);
    if (inR !== null || outR !== null) meta.push(`${inR ?? "?"} in / ${outR ?? "?"} out`);
    return meta.length ? `${m.id} (${meta.join(" \u00B7 ")})` : m.id;
  }

  async function loadModels() {
    const { apiKey, model } = await store.get(["apiKey", "model"]);
    // Show the "add your key" prompt when there's no key, but still load the
    // model list from getaibd.com so the dropdown is always populated.
    setupEl.classList.toggle("gaibd-hidden", !!apiKey);
    modelSelect.disabled = true;
    modelSelect.innerHTML = '<option value="">Loading models\u2026</option>';

    let models = [];

    // 1) Account models from /v1/api/models (requires the key).
    if (apiKey) {
      const res = await send({ type: "getModels", key: apiKey });
      if (res && res.ok) models = res.models || [];
      else if (res && res.error) setStatus(res.error, "err");
    }

    // 2) Fallback: public catalog from getaibd.com (no key needed).
    if (models.length === 0) {
      const cat = await send({ type: "getCatalog" });
      if (cat && cat.ok) models = cat.models || [];
    }

    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">Could not load models</option>';
      return;
    }

    models = models.slice().sort(byPriceAsc);
    modelSelect.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = modelLabel(m);
      modelSelect.appendChild(opt);
    }

    // Prefer the saved model; otherwise default to qwen-flash, then cheapest.
    let chosen = model && models.some((m) => m.id === model) ? model : null;
    if (!chosen) chosen = models.some((m) => m.id === DEFAULT_MODEL) ? DEFAULT_MODEL : models[0].id;
    modelSelect.value = chosen;
    modelSelect.disabled = false;
    await store.set({ model: chosen });
  }

  modelSelect.addEventListener("change", async () => {
    if (!modelSelect.value) return;
    await store.set({ model: modelSelect.value });
    setStatus("Model set to " + modelSelect.value);
  });

  // ── Conversation persistence + rendering ────────────
  async function saveConversation() {
    await store.set({ conversation });
  }
  async function loadConversation() {
    const data = await store.get("conversation");
    if (Array.isArray(data.conversation) && data.conversation.length > 0) {
      conversation = data.conversation;
      welcomeEl.classList.add("gaibd-hidden");
    } else {
      conversation = [];
      welcomeEl.classList.remove("gaibd-hidden");
    }
    renderConversation();
  }
  async function clearConversation() {
    conversation = [];
    welcomeEl.classList.remove("gaibd-hidden");
    renderConversation();
    await store.remove("conversation");
    setStatus("Conversation cleared.");
  }
  async function copyConversation() {
    if (conversation.length === 0) {
      setStatus("Nothing to copy.");
      return;
    }
    const text = conversation
      .map((m) => `**${m.role === "user" ? "You" : "GetAIBD"}:** ${m.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard \u2713");
    } catch (err) {
      setStatus("Could not copy: " + (err.message || String(err)), "err");
    }
  }

  function renderMarkdown(text) {
    if (!text) return "";
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) =>
      `<pre><code class="language-${lang || "plaintext"}">${code.trim()}</code></pre>`
    );
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/^[ \t]*[-*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
    html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^(?:---|\*\*\*)$/gm, "<hr>");
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/\n\n/g, "<br><br>");
    return html;
  }

  function renderConversation() {
    conversationEl.querySelectorAll(".gaibd-msg").forEach((el) => el.remove());
    for (const msg of conversation) {
      const div = document.createElement("div");
      div.className = "gaibd-msg " + msg.role;
      if (msg.role === "assistant") div.innerHTML = renderMarkdown(msg.content);
      else div.textContent = msg.content;
      conversationEl.appendChild(div);
    }
    conversationEl.scrollTop = conversationEl.scrollHeight;
  }

  // ── Render-aware page extraction (runs here, in the page) ──
  async function extractPageContent() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function waitForReady(maxWait) {
      if (document.readyState === "complete") return Promise.resolve();
      return new Promise((res) => {
        const t = setTimeout(res, maxWait);
        window.addEventListener("load", () => { clearTimeout(t); res(); }, { once: true });
      });
    }
    function waitForSettle(maxWait) {
      return new Promise((resolve) => {
        let quiet = null, observer = null;
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
            childList: true, subtree: true, characterData: true,
          });
        } catch (_) {}
        bump();
      });
    }
    async function autoScroll() {
      try {
        const startY = window.scrollY;
        const total = Math.min((document.documentElement && document.documentElement.scrollHeight) || 0, 80000);
        const step = Math.max(window.innerHeight * 0.9, 500);
        const steps = Math.min(Math.ceil(total / step), 25);
        for (let i = 1; i <= steps; i++) { window.scrollTo(0, step * i); await sleep(100); }
        window.scrollTo(0, startY);
        await sleep(150);
      } catch (_) {}
    }
    function clean(t) {
      return (t || "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    }
    function collectShadowText() {
      const parts = [];
      function textOf(root) {
        let s = "";
        root.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) s += n.textContent;
          else if (n.nodeType === Node.ELEMENT_NODE) {
            const tag = n.tagName ? n.tagName.toLowerCase() : "";
            if (tag !== "script" && tag !== "style" && tag !== "noscript") s += " " + (n.innerText || n.textContent || "");
          }
        });
        return s;
      }
      function walk(node) {
        const els = node.querySelectorAll ? node.querySelectorAll("*") : [];
        els.forEach((el) => {
          if (el.id === HOST_ID) return; // skip our own panel
          if (el.shadowRoot) { parts.push(textOf(el.shadowRoot)); walk(el.shadowRoot); }
        });
      }
      try { walk(document); } catch (_) {}
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

    await waitForReady(4000);
    await waitForSettle(4000);
    await autoScroll();
    await waitForSettle(2500);

    let text = richestText();
    const shadowTxt = collectShadowText();
    if (shadowTxt && shadowTxt.trim() && !text.includes(shadowTxt)) text += "\n\n" + shadowTxt;
    text = clean(text);

    const metaDesc =
      (document.querySelector('meta[name="description"]') || {}).content ||
      (document.querySelector('meta[property="og:description"]') || {}).content || "";
    if (metaDesc && !text.includes(metaDesc)) text = clean(metaDesc + "\n\n" + text);

    if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS);
    return { title: document.title || "", url: location.href, text, readyState: document.readyState };
  }

  // ── Ask flow ────────────────────────────────────────
  async function ask(question) {
    if (processing) return;
    const model = modelSelect.value;
    if (!model) {
      setStatus("Pick a model first (or add your API key in settings).", "err");
      return;
    }
    processing = true;
    sendBtn.disabled = true;
    setStatus("Reading page\u2026 (this can take a few seconds)", "thinking");
    try {
      const page = await extractPageContent();
      if (!page.text || !page.text.trim()) {
        throw new Error(
          "This page has no readable text" +
          (page.readyState !== "complete" ? " yet — wait for it to finish loading." : " — it may render to canvas or block reading.")
        );
      }

      conversation.push({ role: "user", content: question });
      welcomeEl.classList.add("gaibd-hidden");
      renderConversation();
      await saveConversation();
      inputEl.value = "";
      autoResize();

      setStatus("Thinking\u2026", "thinking");
      const res = await send({
        type: "chat",
        payload: {
          model,
          pageText: page.text,
          pageUrl: page.url,
          pageTitle: page.title,
          question,
          history: conversation.slice(0, -1),
        },
      });
      if (!res || !res.ok) throw new Error(res?.error || "Request failed. Check your API key in settings.");

      conversation.push({ role: "assistant", content: res.answer || "(No response)" });
      renderConversation();
      await saveConversation();
      const u = res.usage;
      setStatus(u ? `Done \u00B7 ${u.total_tokens ?? "?"} tokens` : "Done");
    } catch (err) {
      const m = err.message || String(err);
      setStatus(m, "err");
      conversation.push({ role: "assistant", content: "Sorry, something went wrong: " + m });
      renderConversation();
      await saveConversation();
    } finally {
      processing = false;
      sendBtn.disabled = false;
    }
  }

  function handleSend() {
    const q = inputEl.value.trim();
    if (!q || processing) return;
    ask(q);
  }

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
  }

  // ── Dragging (with a viewport overlay so dragging works over iframes) ──
  function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }

  async function restorePosition() {
    const { panelPos } = await store.get("panelPos");
    if (panelPos && panelPos.left && panelPos.top) {
      panelEl.style.left = panelPos.left;
      panelEl.style.top = panelPos.top;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
    }
  }

  function initDrag() {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, overlay = null;

    function onMove(e) {
      const left = clamp(startLeft + (e.clientX - startX), 0, window.innerWidth - panelEl.offsetWidth);
      const top = clamp(startTop + (e.clientY - startY), 0, window.innerHeight - panelEl.offsetHeight);
      panelEl.style.left = left + "px";
      panelEl.style.top = top + "px";
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
    }
    function onUp() {
      if (overlay) { overlay.remove(); overlay = null; }
      dragHandle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      store.set({ panelPos: { left: panelEl.style.left, top: panelEl.style.top } });
    }
    dragHandle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return; // let header buttons work
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      dragHandle.classList.add("dragging");

      // Transparent overlay captures the mouse even over page iframes.
      overlay = document.createElement("div");
      overlay.className = "gaibd-overlay";
      overlay.addEventListener("mousemove", onMove);
      overlay.addEventListener("mouseup", onUp);
      shadow.appendChild(overlay);

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      e.preventDefault();
    });
  }

  // ── Wire up events ──────────────────────────────────
  $("gaibd-close").addEventListener("click", () => host.remove());
  $("gaibd-clear").addEventListener("click", clearConversation);
  $("gaibd-copy").addEventListener("click", copyConversation);
  $("gaibd-settings").addEventListener("click", () => send({ type: "openOptions" }));
  $("gaibd-open-options").addEventListener("click", () => send({ type: "openOptions" }));
  sendBtn.addEventListener("click", handleSend);
  inputEl.addEventListener("input", autoResize);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  initDrag();
  restorePosition();
  loadModels();
  loadConversation();
  inputEl.focus();
})();
