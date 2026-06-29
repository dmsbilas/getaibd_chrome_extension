# Chrome Web Store — Submission Guide

This document covers everything needed to submit **GetAIBD Page Assistant** to
the Chrome Web Store. The packaged upload is `getaibd-page-assistant-v1.0.0.zip`
(built from the `extension/` folder).

## 1. Package

- Upload: `getaibd-page-assistant-v1.0.0.zip` (manifest.json at the zip root).
- Rebuild it with: `npm run zip` (from repo root) or the command in section 6.
- The zip intentionally excludes legacy files (`popup.*`, `content.js`,
  `chatui.css`), the `mcp-server/`, docs, and the signing key.

## 2. Store listing fields

- **Name:** GetAIBD Page Assistant
- **Summary (≤132 chars):** AI assistant that answers questions about the page
  you are viewing and helps you draft emails in Gmail.
- **Category:** Productivity
- **Single purpose:** "Provide an in-browser AI assistant that answers questions
  about the current web page and helps draft email." (Both features serve the
  one purpose: an AI assistant for the page/content you are working with.)
- **Privacy policy URL:** host `PRIVACY_POLICY.md` somewhere public (e.g., a
  GitHub Pages / raw GitHub URL) and paste that link.

## 3. Permission justifications (paste into the dashboard)

- **storage** — Save the user's API key, selected model, conversation history,
  and panel position locally.
- **activeTab** — Read the content of the page the user is currently viewing,
  only when they click the icon and ask a question.
- **scripting** — Inject the assistant panel and the page‑reading routine into
  the active tab on demand.
- **host permission `https://getaibd.com/*`** — Call the GetAIBD API (models,
  balance, chat completions) and the public model catalog.
- **host permission `https://mail.google.com/*`** — Run the Gmail helper content
  script that opens a compose window and fills it when the user asks the
  assistant to draft an email.

## 4. Data usage disclosures (Privacy tab)

Declare that the extension handles:
- **Website content** — sent to GetAIBD to answer questions.
- **Authentication information** (the API key) — stored locally, sent only to
  GetAIBD.
- Check: *not sold to third parties*, *not used for unrelated purposes*, *not
  used for creditworthiness/lending*.

## 5. Review-risk notes

- The **`https://mail.google.com` permission is the highest-scrutiny item.**
  Google reviews Gmail access carefully. Be ready to explain the email-drafting
  feature, and expect a possibly longer review. If you want the smoothest first
  approval, you can publish a build without the Gmail content script and add it
  in a later version (ask the maintainer for a "lite" build).
- No remote code is executed (MV3 compliant): all scripts are bundled; the
  extension only exchanges **data** with GetAIBD.

## 6. Rebuild the zip manually

```bash
cd extension
rm -f ../getaibd-page-assistant-v1.0.0.zip
zip -r ../getaibd-page-assistant-v1.0.0.zip \
  manifest.json background.js panel.js gmail-bridge.js \
  options.html options.css options.js icons \
  -x "*.DS_Store"
```
