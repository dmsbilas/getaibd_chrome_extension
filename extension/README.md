# GetAIBD Page Assistant (Chrome Extension)

A Manifest V3 Chrome extension that lets you ask questions about the page you're
viewing. It reads the current page's text and sends it, along with your question,
to the [GetAIBD Developer API](https://getaibd.com/v1/api) (OpenAI-compatible).

## Features

- **Settings page** — paste your GetAIBD API key (starts with `aiob_`). The key
  is validated by calling `GET /models`, and a model dropdown is populated
  automatically. Your remaining credit balance (`GET /balance`) is shown too.
- **Popup** — a ChatGPT-style conversation UI. Type a message, press **Enter**
  (or click send), and the extension reads the active page and calls
  `POST /chat/completions` (non-streaming) to answer. Messages render as chat
  bubbles and the panel has a draggable header.
- Your key is stored locally (`chrome.storage.local`) and only ever sent to
  `getaibd.com`.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Click the extension's **Details → Extension options** (or right-click the
   toolbar icon → Options).
5. Paste your API key, wait for models to load, pick one, and click **Save**.

## Usage

1. Browse to any normal web page.
2. Click the toolbar icon.
3. Type a question (e.g. *"Summarize this in 3 bullets"*) and click **Ask**
   (or press ⌘/Ctrl + Enter).

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 config, permissions (`storage`, `activeTab`, `scripting`) and host permission for `https://getaibd.com/*`. |
| `background.js` | Service worker; the API client for `/models`, `/balance`, `/chat/completions`. |
| `content.js` | Extracts readable page text (truncated to ~12k chars). |
| `options.html/.css/.js` | Settings UI: key entry, model selector, save. |
| `popup.html/.css/.js` | Prompt UI: reads the page and shows the answer. |
| `icons/` | Toolbar icons. |

## API reference (from `getaibd-api-docs.pdf`)

- Base URL: `https://getaibd.com/v1/api`
- Auth: `Authorization: Bearer <API_KEY>`
- `GET /models` → `{ "data": [{ "id", "name", "modality", ... }] }`
- `POST /chat/completions` → `{ model, messages, stream: false }`, OpenAI-compatible
- `GET /balance` → `{ "credits_balance": number }`
