# Privacy Policy — GetAIBD Page Assistant

_Last updated: 2026-06-25_

GetAIBD Page Assistant ("the extension") is a browser extension that lets you
ask an AI questions about the web page you are viewing and optionally draft
emails in Gmail. This policy explains what data the extension handles and how.

## Summary

- The extension does **not** sell your data.
- The extension does **not** use analytics, advertising, or third‑party
  trackers.
- Data is only sent to **GetAIBD** (`https://getaibd.com`) to answer your
  requests, and — if you use the optional Gmail feature — to a **local** helper
  running on your own computer.

## What data is handled

### 1. Your API key
- You enter a GetAIBD API key in the extension's settings.
- It is stored locally in your browser using `chrome.storage.local`.
- It is sent only to `https://getaibd.com` as an `Authorization` header to
  authenticate your requests. It is never sent anywhere else.

### 2. Web page content
- When you ask a question, the extension reads the text content of the page you
  are currently viewing (title, URL, and visible text).
- This content is sent to `https://getaibd.com` together with your question so
  the model can answer. It is processed to generate a response and is not used
  for any other purpose by the extension.
- Page content is read **only on demand** when you submit a question. There is
  no background scraping.

### 3. Conversation history
- Your chat messages are stored locally (`chrome.storage.local`) so the
  conversation can be restored when you reopen the panel.
- The conversation is included with each request to `https://getaibd.com` to
  provide context to the model. You can clear it at any time from the panel.

### 4. Gmail data (optional feature)
- The Gmail integration is only active on `https://mail.google.com` and only
  acts when you (via a connected AI client) explicitly ask it to write an email.
- It opens a Gmail compose window and fills the recipient, subject, and body
  fields with content you provide. It reads the Gmail page DOM solely to perform
  this action.
- The email content is exchanged only with a helper program running locally on
  your own computer (a WebSocket on `127.0.0.1`). It is not sent to GetAIBD or
  any external server by this feature.

## Data sharing

The extension shares data only with:
- **GetAIBD** (`https://getaibd.com`) — to answer your questions, governed by
  GetAIBD's own privacy practices.
- **A local helper on your own device** — for the optional Gmail feature; this
  never leaves your computer.

No data is shared with any other third party.

## Data retention and removal

- Your API key and conversation are stored locally and remain until you remove
  the extension or clear its data (e.g., via the panel's "clear" button or by
  removing the extension).

## Contact

For questions about this policy, contact: **support@getaibd.com**

_Replace the contact address above with your own before publishing._
