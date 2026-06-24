# GetAIBD Gmail MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI client (Cursor,
Claude Desktop, etc.) **write and send emails in your open Gmail tab** through
the GetAIBD Chrome extension.

## How it works

```
AI client (Cursor / Claude Desktop)
   │  MCP over stdio
   ▼
server.js  ── also runs a localhost WebSocket server on ws://127.0.0.1:8765 ──┐
                                                                               │
                                                                               ▼
                          Chrome extension content script on https://mail.google.com
                                                                               │
                                                                               ▼
                                  Opens a Gmail compose window and fills the fields
```

- The server exposes MCP tools (`gmail_write_email`, `gmail_status`).
- When a tool is called, the request is relayed over a WebSocket to the GetAIBD
  extension's `gmail-bridge.js`, which runs inside your Gmail tab and drives the
  Gmail composer DOM.
- The WebSocket lives in the Gmail content script (not the extension's service
  worker), so it stays connected for as long as a Gmail tab is open.

## Prerequisites

- Node.js 18+ (tested on 22).
- The GetAIBD Chrome extension loaded (`extension/` folder), reloaded after this
  feature was added.
- A Gmail tab open at `https://mail.google.com`.

## Install

```bash
cd mcp-server
npm install
```

## Configure your MCP client

### Cursor

Add to `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "getaibd-gmail": {
      "command": "node",
      "args": ["/absolute/path/to/getaibd-chrome-plugin/mcp-server/server.js"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "getaibd-gmail": {
      "command": "node",
      "args": ["/absolute/path/to/getaibd-chrome-plugin/mcp-server/server.js"]
    }
  }
}
```

Use the **absolute path** to `server.js`. The MCP client launches the server for
you — you don't run it manually.

## Tools

### `gmail_write_email`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | no | Recipient address(es), comma-separated |
| `cc` | string | no | Cc address(es) |
| `bcc` | string | no | Bcc address(es) |
| `subject` | string | no | Subject line |
| `body` | string | **yes** | Email body (plain text) |
| `send` | boolean | no | If `true`, clicks Send. Default `false` (leaves a draft). |

Example prompt to your AI: *"Write an email to alice@example.com with subject
'Lunch?' asking if she's free Friday — leave it as a draft."*

### `gmail_status`

Reports whether a Gmail tab is currently connected.

## Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `GAIBD_WS_PORT` | `8765` | WebSocket port. Must match `WS_URL` in `extension/gmail-bridge.js`. |
| `GAIBD_WS_TOKEN` | `getaibd-local` | Shared secret. Must match `TOKEN` in `extension/gmail-bridge.js`. |

If you change either, update `extension/gmail-bridge.js` to match.

## Security notes

- The WebSocket binds to `127.0.0.1` only, so it isn't reachable from the
  network. A shared `TOKEN` guards against other local processes driving Gmail.
- By default `send` is `false`, so emails are left as drafts for you to review
  before sending. Set `send: true` only when you trust the content.

## Troubleshooting

- **"No Gmail tab is connected"** — open/refresh `https://mail.google.com`, make
  sure the extension is loaded, and confirm the port/token match.
- **Fields not filling** — Gmail's DOM changes over time; if a selector breaks,
  update `gmail-bridge.js`. The composer is fragile by nature (To creates
  recipient "chips", the body is a `contenteditable`).
- **Nothing happens in Cursor/Claude** — verify the MCP server path is absolute
  and restart the MCP client so it relaunches the server.
