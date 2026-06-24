# GetAIBD Page Assistant (Chrome Extension)

A **Manifest V3** Chrome extension that adds an AI assistant to every web page
you visit. Click the toolbar icon and a **draggable chat panel** appears right
on the page — ask questions about what you're reading, pick which model to use,
and have a full multi-turn conversation, all powered by the
[GetAIBD Developer API](https://getaibd.com/v1/api) (OpenAI-compatible).

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Architecture](#architecture)
- [Files](#files)
- [Page Reading (Dynamic Sites)](#page-reading-dynamic-sites)
- [Models & Pricing](#models--pricing)
- [API Reference](#api-reference)
- [Privacy & Security](#privacy--security)

---

## Features

### 🪟 Draggable In-Page Panel

- Clicking the toolbar icon injects a floating chat panel **into the current
  page** (not a fixed toolbar popup), so it can be **dragged anywhere** by its
  header. Its position is remembered across sessions.
- Clicking the icon again (or the `✕` button) **toggles the panel closed**.
- The panel is rendered inside a **Shadow DOM**, so the page's own CSS can't
  interfere with it (and its styles can't leak onto the page).

### 🧠 In-Panel Model Selector

- A **model dropdown** lives at the top of the chat window.
- The model list comes from **getaibd.com**: your account's models via
  `GET /v1/api/models` when an API key is set, falling back to the **public
  catalog** (`GET /v1/catalog`) so the list is populated even before you add a
  key.
- Models are **sorted by price** (cheapest first) and labelled with their
  modality and input/output credit rates. The default selection is
  **`qwen-flash`** (the cheapest chat model) unless you've saved another.
- Changing the dropdown saves your choice instantly to `chrome.storage.local`.

### 💬 ChatGPT-style Conversation

- User and assistant messages render as styled chat bubbles with a fade-in
  animation.
- **Markdown rendering** for assistant replies (bold, italic, inline code, code
  blocks, headers, lists, blockquotes, horizontal rules).
- **Auto-resizing input**, **Enter to send** / **Shift+Enter** for a newline.
- **Multi-turn context** — the full conversation history is sent with each
  request so the model remembers what you discussed.
- **Persistence** — the conversation is saved to `chrome.storage.local` and
  restored when you reopen the panel.
- **Clear** (`🗑`) and **Copy** (`📋`) the whole conversation as Markdown.

### 🔄 Resilient API Client

- All network calls run in the background service worker.
- Transient gateway errors (`408/429/500/502/503/504`), network failures, and
  timeouts are **automatically retried** (linear backoff), with a hard 90s
  request timeout so a stalled server can't hang the UI.

### ⚙️ Settings Page

- Enter your GetAIBD **API key** (starts with `aiob_`); it's validated in real
  time by loading your models, and your **credit balance** is displayed.
- Open it any time from the panel's `⚙` button.

---

## Installation

1. Open **`chrome://extensions`** in Chrome/Edge/Brave.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** and select the `extension/` folder from this repo.
4. Open **Options** (right-click the icon → *Options*, or click `⚙` in the
   panel) and paste your **GetAIBD API key** (starts with `aiob_`). Wait for the
   model list to load, then click **Save settings**.
5. Click the toolbar icon on any normal web page to open the chat panel.

---

## Usage

1. Browse to any normal web page.
2. Click the **GetAIBD toolbar icon** — the draggable panel opens on the page.
3. (Optional) Drag the panel by its header to reposition it, and pick a model
   from the dropdown.
4. Type a question (e.g. *"Summarize this page in 3 bullets"*) and press
   **Enter**.
5. The extension reads the page content, sends it to the selected model, and
   shows the answer. Continue the conversation naturally.

| Action | How |
|--------|-----|
| Send | `Enter` (or the send button) |
| Newline | `Shift+Enter` |
| Move panel | Drag the header |
| Close panel | `✕` button (or click the toolbar icon again) |
| Clear conversation | `🗑` button |
| Copy conversation | `📋` button |
| Settings (API key) | `⚙` button |

> **Note:** A valid API key is required to send a chat. The panel can show the
> model list from getaibd.com without a key, but asking a question needs one.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Chrome Extension                        │
│                                                               │
│   click toolbar icon                                          │
│          │                                                    │
│          ▼                                                    │
│  ┌───────────────┐   chrome.scripting   ┌──────────────────┐ │
│  │ background.js  │ ───executeScript───▶ │     panel.js     │ │
│  │ (service       │                      │ (injected into   │ │
│  │  worker)       │ ◀──runtime.message── │  the page, in a  │ │
│  │                │                      │  Shadow DOM)     │ │
│  │  API client    │                      │                  │ │
│  │  /models       │                      │  • chat UI       │ │
│  │  /catalog      │                      │  • model picker  │ │
│  │  /balance      │                      │  • drag + state  │ │
│  │  /chat/        │                      │  • page reading  │ │
│  │  completions   │                      └──────────────────┘ │
│  └──────┬─────────┘                                           │
│         │                            ┌──────────────────────┐ │
│         │                            │     options.html      │ │
│         │                            │  (API key + balance)  │ │
│         ▼                            └──────────────────────┘ │
│  ┌─────────────────┐                                          │
│  │  getaibd.com     │                                         │
│  │  /v1/api/*       │                                         │
│  │  /v1/catalog     │                                         │
│  └─────────────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

1. **You click the toolbar icon.** Because the action has no popup,
   `chrome.action.onClicked` fires in `background.js`.
2. **background.js injects `panel.js`** into the active tab via
   `chrome.scripting.executeScript`. If the panel is already open, the
   re-injection toggles it closed.
3. **panel.js** builds the chat UI inside a Shadow DOM, loads the model list and
   saved conversation, and reads the page when you ask a question.
4. **panel.js sends messages** (`getModels`, `getCatalog`, `getBalance`,
   `chat`, `openOptions`) to **background.js**, which makes all the network
   calls (it holds the host permission and avoids page CORS).
5. **background.js** calls the GetAIBD API and returns results to the panel,
   which renders the assistant's Markdown reply and persists the conversation.

---

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 config: permissions (`storage`, `activeTab`, `scripting`), host permission for `getaibd.com`, toolbar action (no popup), options page, background service worker. |
| `background.js` | Service worker + API client: handles the toolbar click (inject/toggle panel), routes messages, and calls `GET /models`, `GET /v1/catalog`, `GET /balance`, `POST /chat/completions` with retry/timeout. |
| `panel.js` | The injected, draggable in-page chat panel (Shadow DOM): chat UI, model selector, Markdown renderer, conversation persistence, dragging, and the render-aware page reader. |
| `options.html` / `options.css` / `options.js` | Settings page: API key entry (auto-validates), model list (price-sorted), credit balance. |

> **Legacy:** `popup.html`, `popup.css`, `popup.js`, and `content.js` were part
> of the original toolbar-popup design and are **no longer referenced** by the
> manifest. The panel (`panel.js`) replaced them.

---

## Page Reading (Dynamic Sites)

The page reader is **render-aware**, so it works on modern client-rendered
sites, not just static HTML. When you ask a question, `panel.js` runs an
extraction routine in the page that:

1. **Waits for the page to settle** — waits for `load`, then uses a
   `MutationObserver` to wait until the DOM has been quiet for ~400 ms (capped),
   so single-page-app content has time to render.
2. **Auto-scrolls** through the page in steps to trigger lazy-loaded /
   infinite-scroll content, then restores your scroll position.
3. **Reads everything** — pulls text from the most content-rich container
   (`main` / `article` / `[role=main]` / `body`), plus **open Shadow DOM** that
   `innerText` would normally miss, and the page's meta description. The panel's
   own UI is skipped.

Text is capped at ~20,000 characters to fit model context budgets.

**Limitations:** content rendered to `<canvas>` or pages that actively block
scripting can't be read as text. Cross-origin `<iframe>` content is not read.

---

## Models & Pricing

- **Source:** `GET /v1/api/models` (your account's models) with a fallback to
  the public `GET /v1/catalog`.
- **Pricing:** the public catalog provides per-model rates —
  `input_token_rate` (credits / 1k input tokens) and `token_rate`
  (credits / 1k output tokens). `getModels` enriches each model with these so
  the lists can be sorted by price.
- **Sort order:** ascending by output token rate (cheapest first), with input
  rate as a tiebreaker; models without a known price are listed last.
- **Default model:** `qwen-flash` when nothing else is saved.

---

## API Reference

| Detail | Value |
|--------|-------|
| **Base URL** | `https://getaibd.com/v1/api` |
| **Catalog (public)** | `https://getaibd.com/v1/catalog` |
| **Authentication** | `Authorization: Bearer <API_KEY>` |
| **Content-Type** | `application/json` |

### `GET /models`

Returns the models available for the given API key.

```json
{ "data": [ { "id": "qwen-flash", "name": "…", "modality": "chat" } ] }
```

### `GET /v1/catalog` (no auth)

Returns model families with pricing, used to populate/sort the model list.

```json
{
  "families": [
    {
      "modality": "chat",
      "models": [
        { "id": "qwen-flash", "input_token_rate": 1.84, "token_rate": 5.52 }
      ]
    }
  ]
}
```

### `POST /chat/completions`

OpenAI-compatible chat completions (non-streaming).

```json
{
  "model": "qwen-flash",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant…" },
    { "role": "user", "content": "Page content…\n\n---\nQuestion: …" }
  ],
  "stream": false
}
```

### `GET /balance`

```json
{ "credits_balance": 5000 }
```

---

## Privacy & Security

- Your **API key** is stored in `chrome.storage.local` and is only sent to
  `https://getaibd.com/*`.
- No analytics, tracking, or third-party services.
- Page content is read **on demand** only when you ask a question — there is no
  background scraping.
- No conversation data leaves your browser except the API request payload sent
  to GetAIBD's servers.
