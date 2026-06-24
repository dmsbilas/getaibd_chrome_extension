#!/usr/bin/env node
// GetAIBD Gmail MCP server.
//
// Two roles in one process:
//   1. An MCP server (stdio) that exposes Gmail tools to an MCP client
//      (Cursor, Claude Desktop, etc.).
//   2. A localhost WebSocket server that the GetAIBD Chrome extension's Gmail
//      content script connects to. Tool calls are relayed over this socket to
//      the open Gmail tab, which actually fills the compose fields.
//
// IMPORTANT: stdout is reserved for the MCP stdio transport. All logging MUST
// go to stderr (console.error), never console.log.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.GAIBD_WS_PORT || 8765);
// Shared secret so a random local process can't drive your Gmail. Must match
// the TOKEN in the extension's gmail-bridge.js.
const TOKEN = process.env.GAIBD_WS_TOKEN || "getaibd-local";

// ── WebSocket bridge to the Chrome extension (Gmail tab) ──────────
const clients = new Set();          // authenticated extension sockets
const pending = new Map();          // request id -> { resolve, timer }

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (ws) => {
  ws.authed = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "hello") {
      if (TOKEN && msg.token !== TOKEN) {
        console.error("[gaibd] rejected a client with a bad token");
        ws.close();
        return;
      }
      ws.authed = true;
      clients.add(ws);
      console.error(`[gaibd] Gmail tab connected (${msg.url || "unknown url"}). Clients: ${clients.size}`);
      return;
    }

    if (!ws.authed) return;

    if (msg.type === "result" && msg.id && pending.has(msg.id)) {
      const { resolve, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.error(`[gaibd] Gmail tab disconnected. Clients: ${clients.size}`);
  });
  ws.on("error", () => {});
});

wss.on("error", (e) => {
  console.error(`[gaibd] WebSocket server error on :${PORT} — ${e.message}`);
});

// Send a command to the most-recently-connected Gmail tab and await its result.
function sendCommand(action, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const target = [...clients].pop(); // newest connection
    if (!target || target.readyState !== target.OPEN) {
      reject(
        new Error(
          "No Gmail tab is connected. Open https://mail.google.com in Chrome " +
            "(with the GetAIBD extension installed and this server running), then retry."
        )
      );
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Timed out waiting for the Gmail tab to respond."));
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      target.send(JSON.stringify({ type: "command", id, action, payload }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}

// ── MCP server (stdio) ───────────────────────────────────────────
const mcp = new McpServer({ name: "getaibd-gmail", version: "1.0.0" });

mcp.tool(
  "gmail_write_email",
  "Compose (and optionally send) an email in the user's open Gmail tab via the " +
    "GetAIBD Chrome extension. Opens a Gmail compose window and fills the " +
    "recipients, subject, and body. Requires a Gmail tab open in Chrome.",
  {
    to: z.string().optional().describe("Recipient email address(es), comma-separated"),
    cc: z.string().optional().describe("Cc address(es), comma-separated"),
    bcc: z.string().optional().describe("Bcc address(es), comma-separated"),
    subject: z.string().optional().describe("Subject line"),
    body: z.string().describe("Email body as plain text"),
    send: z
      .boolean()
      .optional()
      .describe("If true, click Send after composing. Default false — leaves a draft for review."),
  },
  async (args) => {
    try {
      const res = await sendCommand("write_email", args);
      return {
        content: [{ type: "text", text: res.message || (res.ok ? "Done." : "Failed.") }],
        isError: !res.ok,
      };
    } catch (e) {
      return { content: [{ type: "text", text: e.message || String(e) }], isError: true };
    }
  }
);

mcp.tool(
  "gmail_status",
  "Check whether a Gmail tab is currently connected to this bridge.",
  {},
  async () => {
    const n = clients.size;
    return {
      content: [
        {
          type: "text",
          text:
            n > 0
              ? `${n} Gmail tab(s) connected on ws://127.0.0.1:${PORT}.`
              : `No Gmail tab connected. Open https://mail.google.com in Chrome with the GetAIBD extension installed.`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
console.error(`[gaibd] MCP server ready (stdio). Gmail WS bridge listening on ws://127.0.0.1:${PORT}`);
