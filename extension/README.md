# GetAIBD Page Assistant (Chrome Extension)

A **Manifest V3** Chrome extension that brings an AI assistant to every web page
you visit. Think of it as a mini ChatGPT that lives in your browser toolbar —
ask questions about the page you're viewing, get instant answers, and have a
full conversation thread, all powered by the
[GetAIBD Developer API](https://getaibd.com/v1/api) (OpenAI-compatible).

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Architecture](#architecture)
- [Files](#files)
- [API Reference](#api-reference)
- [Webpage Form Interaction](#webpage-form-interaction)
- [Privacy & Security](#privacy--security)

---

## Features

### 🎨 ChatGPT-style Conversation UI

- **Conversation thread** — user and assistant messages appear as styled chat
  bubbles (user on the right in blue, assistant on the left).
- **Drag handle** — the header has a grip icon and a grab cursor so the panel
  feels draggable.
- **Auto-resize input** — the textarea grows as you type (up to 100 px).
- **Send on Enter** — press `Enter` to send, `Shift+Enter` for a newline.
- **Fade-in animation** — new messages animate smoothly into view.

### 📝 Markdown Rendering

Assistant responses support full Markdown formatting:

| Element        | Syntax                         |
|----------------|--------------------------------|
| **Bold**       | `**text**` or `__text__`       |
| *Italic*       | `*text*` or `_text_`           |
| `inline code`  | `` `code` ``                   |
| Code blocks    | ` ```lang ... ``` `            |
| Headers        | `# H1`, `## H2`, `### H3`     |
| Unordered list | `- item` or `* item`           |
| Ordered list   | `1. item`                      |
| > Blockquote   | `> quoted text`                |
| Horizontal rule | `---` or `***`                |

### 💬 Conversation Management

- **Clear conversation** (`🗑` button) — wipes the thread and resets the
  welcome message.
- **Copy conversation** (`📋` button) — formats the entire thread as plain
  Markdown text and copies it to your clipboard:
  ```
  **You:** Your question here
  
  **GetAIBD:** Assistant reply here
  ```
- **Persistence** — the conversation is saved to `chrome.storage.local` after
  every message and automatically restored when you reopen the popup, so you
  never lose your thread.
- **Multi-turn context** — the full conversation history is sent to the model
  with each request, so it remembers what you discussed earlier.

### ⚙️ Settings Page

- **API Key** — paste your GetAIBD API key (starts with `aiob_`). The key is
  validated in real time by calling `GET /models`.
- **Model selector** — automatically populated with all models available for
  your key, including modality info.
- **Credit balance** — your remaining credit balance (`GET /balance`) is
  displayed after the key is validated.
- **Quick access** — open settings from the popup via the `⚙` gear button.

### 🔄 Setup Gate

If no API key or model has been configured, the popup shows a friendly setup
prompt instead of the chat UI. One click opens the settings page.

### 🌐 Webpage Form Interaction (Developer API)

The extension exposes three helper functions on the page's `window` scope that
allow programmatic interaction with webpage form fields. These are injected
alongside the page-text extraction when the popup asks a question.

#### `window.__getAIBD_getFormFields()`

Returns an array of all visible form fields (inputs, textareas, selects):

```js
[
  {
    tag: "input",
    type: "text",
    name: "username",
    id: "login-user",
    placeholder: "Enter your username",
    value: "",
    selector: "#login-user"
  },
  // ...
]
```

#### `window.__getAIBD_setFormField(selector, value)`

Sets the value of a form field identified by a CSS selector. Handles
`<select>` elements (supports exact, case-insensitive, and partial matching
of options). Uses the native property setter on `HTMLInputElement` and
`HTMLTextAreaElement` prototypes to bypass React's synthetic event system,
then dispatches `input`, `change`, and keyboard events so all JS frameworks
(Vue, Angular, Svelte, etc.) detect the change.

```js
window.__getAIBD_setFormField("#email", "hello@example.com");
// → { ok: true, selector: "#email", value: "hello@example.com" }
```

#### `window.__getAIBD_fillFormFields(fields)`

Batch-fills multiple form fields at once. Accepts either an object or an array:

```js
// Object form
window.__getAIBD_fillFormFields({
  "#first-name": "Jane",
  "#last-name": "Doe",
  "#country": "Bangladesh"
});

// Array form
window.__getAIBD_fillFormFields([
  { selector: "#email", value: "jane@example.com" },
  { selector: "#bio", value: "Software engineer" }
]);
```

---

## Installation

1. Open **`chrome://extensions`** in Chrome/Edge/Brave.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** and select the `extension/` folder from this repo.
4. The extension icon appears in your toolbar. Right-click it and choose
   **Options** (or click the `⚙` gear button in the popup).
5. Paste your **GetAIBD API key** (starts with `aiob_`), wait for the model
   list to load, select a model, and click **Save settings**.

---

## Usage

### Asking a Question

1. Browse to any normal web page.
2. Click the **GetAIBD toolbar icon** — the popup opens.
3. Type a question in the input area, e.g.:
   - *"Summarize this page in 3 bullets"*
   - *"What is the main argument of this article?"*
   - *"Extract the key dates from this page"*
4. Press **Enter** (or click the send button).
5. The extension reads the page content, sends it to the API, and displays the
   assistant's reply as a chat bubble. Continue the conversation naturally.

### Managing the Conversation

- **Send**: `Enter` key or click the blue send button (paper-plane icon).
- **Newline**: `Shift+Enter` inside the textarea.
- **Clear**: Click the `🗑` trash button to reset the thread.
- **Copy**: Click the `📋` clipboard button to export the whole conversation.
- **Settings**: Click the `⚙` gear button to change your API key or model.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Chrome Extension                     │
│                                                           │
│  ┌──────────────┐   ┌─────────────┐   ┌───────────────┐  │
│  │  popup.html   │   │ options.html│   │ background.js │  │
│  │  (Chat UI)    │   │ (Settings)  │   │ (Service      │  │
│  │               │   │             │   │  Worker)      │  │
│  │  popup.js ────┼───┼─────────────┼───┼─ API client   │  │
│  │  popup.css    │   │ options.js  │   │  /models      │  │
│  │               │   │ options.css │   │  /balance     │  │
│  └──────┬────────┘   └─────────────┘   │  /chat/       │  │
│         │                              │  completions  │  │
│         │ chrome.scripting             └───────┬───────┘  │
│         │ .executeScript                       │          │
│         ▼                                      │          │
│  ┌──────────────┐                              │          │
│  │  content.js   │                              │          │
│  │  (injected    │                              │          │
│  │   into page)  │                              │          │
│  │               │                              │          │
│  │  Extract text │                              │          │
│  │  Form helpers │                              │          │
│  └──────────────┘                              │          │
│                                                 ▼          │
│                                        ┌─────────────────┐ │
│                                        │  getaibd.com     │ │
│                                        │  /v1/api/*       │ │
│                                        └─────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

1. **User clicks the toolbar icon** → `popup.html` opens.
2. **popup.js** checks for a saved API key and model. If missing, shows the
   setup gate.
3. **User types a question and presses Enter**.
4. **popup.js** calls `chrome.scripting.executeScript()` to inject
   `content.js` into the active tab.
5. **content.js** extracts the page title, URL, and body text (up to 12,000
   characters), and exposes form-field helper functions on `window`.
6. **popup.js** sends a `{ type: "chat", payload: {...} }` message to
   **background.js** (the service worker).
7. **background.js** calls `POST https://getaibd.com/v1/api/chat/completions`
   with the model, the system prompt, conversation history, and the
   user's question with page context.
8. The response is sent back to popup.js, which renders the assistant's
   message as a styled Markdown bubble and saves the conversation to
   `chrome.storage.local`.

All network calls go through the **service worker** (`background.js`), which
has the `host_permissions` for `https://getaibd.com/*`. The popup and options
pages are purely UI — they never make API calls directly.

---

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 config: permissions (`storage`, `activeTab`, `scripting`), host permission for `getaibd.com`, popup + options + background declarations |
| `background.js` | Service worker API client: `GET /models`, `GET /balance`, `POST /chat/completions`. Handles all network I/O. |
| `content.js` | Injected into the active page. Extracts readable text (title, URL, body up to ~12k chars) and exposes `window.__getAIBD_*` helpers for form-field interaction. |
| `popup.html` | Conversation UI: drag handle, setup gate, message thread, status bar, textarea + send button. |
| `popup.css` | Dark theme styling: message bubbles, Markdown formatting, fade-in animation, scrollbar, input area. |
| `popup.js` | Chat controller: conversation state, Markdown renderer, persistence (save/load/clear), clipboard copy, page reading, API dispatch. |
| `options.html` | Settings page: API key input, model `<select>`, save button, balance display. |
| `options.css` | Settings page styling (dark card layout). |
| `options.js` | Settings logic: auto-validate key on input (600 ms debounce), populate model list, save to `chrome.storage.local`. |
| `icons/` | Toolbar icons (16×16, 48×48, 128×128). |

---

## API Reference

From the GetAIBD API documentation (`getaibd-api-docs.pdf`):

| Detail | Value |
|--------|-------|
| **Base URL** | `https://getaibd.com/v1/api` |
| **Authentication** | `Authorization: Bearer <API_KEY>` |
| **Content-Type** | `application/json` |

### `GET /models`

Returns the list of available models for the given API key.

```json
{
  "data": [
    { "id": "model-id", "name": "Model Name", "modality": "text" }
  ]
}
```

### `POST /chat/completions`

OpenAI-compatible chat completions endpoint.

**Request body:**

```json
{
  "model": "model-id",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant..." },
    { "role": "user", "content": "Page content...\n\n---\nQuestion: ..." }
  ],
  "stream": false
}
```

**Response:**

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The answer..."
      }
    }
  ],
  "usage": {
    "total_tokens": 1234
  }
}
```

### `GET /balance`

Returns the remaining credit balance.

```json
{
  "credits_balance": 5000
}
```

---

## Webpage Form Interaction

The extension comes with a built-in API for reading and writing form fields on
any webpage. These functions are injected into the page context when you use the
popup, and are available for advanced automation use cases:

| Function | Description |
|----------|-------------|
| `__getAIBD_getFormFields()` | Enumerate all visible form fields with metadata (tag, type, name, id, placeholder, value, CSS selector) |
| `__getAIBD_setFormField(sel, val)` | Set a field's value with full framework compatibility (React, Vue, etc.) |
| `__getAIBD_fillFormFields(fields)` | Batch-set multiple fields from a `{ selector: value }` map or array |

**Framework compatibility:** The setters use
`Object.getOwnPropertyDescriptor` on the native `HTMLInputElement` and
`HTMLTextAreaElement` prototypes to bypass framework-managed state, then
dispatch `input`, `change`, `keydown`, and `keyup` events so all major JS
frameworks pick up the change.

---

## Privacy & Security

- Your **API key** is stored in `chrome.storage.local` and is **never** sent
  to any server other than `https://getaibd.com/*`.
- The extension does **not** use any analytics, tracking, or third-party
  services.
- Page content is read on-demand only when you ask a question — there is no
  background scraping.
- No conversation data leaves your browser except the API request payload
  sent to GetAIBD's servers.