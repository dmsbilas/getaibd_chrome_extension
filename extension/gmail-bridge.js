// gmail-bridge.js — runs on https://mail.google.com/*.
//
// Maintains a WebSocket connection to the local GetAIBD MCP server and, on
// command, opens a Gmail compose window and fills the To/Cc/Bcc/Subject/Body
// fields (optionally clicking Send). The connection lives as long as the Gmail
// tab is open, which avoids MV3 service-worker lifetime problems.
(function () {
  "use strict";

  const WS_URL = "ws://127.0.0.1:8765"; // must match the MCP server's port
  const TOKEN = "getaibd-local";        // must match GAIBD_WS_TOKEN on the server

  let ws = null;
  let retry = 0;
  let reconnectTimer = null;

  // ── Connection ─────────────────────────────────────
  function connect() {
    clearTimeout(reconnectTimer);
    try {
      ws = new WebSocket(WS_URL);
    } catch (_) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      retry = 0;
      send({ type: "hello", client: "gmail-extension", token: TOKEN, url: location.href });
    };

    ws.onmessage = async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "command" && msg.action === "write_email") {
        const result = await handleWriteEmail(msg.payload || {});
        send({ type: "result", id: msg.id, ...result });
      } else if (msg.type === "ping") {
        send({ type: "pong" });
      }
    };

    ws.onclose = () => scheduleReconnect();
    ws.onerror = () => {
      try {
        ws.close();
      } catch (_) {}
    };
  }

  function send(obj) {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    } catch (_) {}
  }

  function scheduleReconnect() {
    retry = Math.min(retry + 1, 6);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1000 * retry); // back off up to 6s
  }

  // ── DOM helpers ─────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Poll until predicate() returns a truthy value, or time out.
  async function waitFor(predicate, timeoutMs = 8000, intervalMs = 150) {
    const start = Date.now();
    for (;;) {
      let val;
      try {
        val = predicate();
      } catch (_) {
        val = null;
      }
      if (val) return val;
      if (Date.now() - start > timeoutMs) return null;
      await sleep(intervalMs);
    }
  }

  // Set <input>/<textarea> value in a way React/Gmail listeners notice.
  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pressEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
      );
    }
  }

  // Find the currently open compose dialog (the one containing the subject box).
  function findComposeDialog() {
    const subject = document.querySelector('input[name="subjectbox"]');
    if (subject) return subject.closest('div[role="dialog"]') || subject.closest("table") || document;
    return null;
  }

  async function openCompose() {
    if (findComposeDialog()) return findComposeDialog();
    // Click the "Compose" button.
    const composeBtn =
      document.querySelector('div[gh="cm"]') ||
      Array.from(document.querySelectorAll('div[role="button"]')).find(
        (b) => (b.textContent || "").trim().toLowerCase() === "compose"
      );
    if (composeBtn) composeBtn.click();
    return await waitFor(() => findComposeDialog(), 8000);
  }

  function setRecipients(dialog, kind, value) {
    if (!value) return false;
    // kind: "to" | "cc" | "bcc"
    const selectors = [
      `input[aria-label="${kind === "to" ? "To recipients" : kind === "cc" ? "Cc recipients" : "Bcc recipients"}"]`,
      `textarea[name="${kind}"]`,
      `input[name="${kind}"]`,
    ];
    let input = null;
    for (const s of selectors) {
      input = dialog.querySelector(s);
      if (input) break;
    }
    if (!input) return false;
    input.focus();
    setNativeValue(input, value);
    // Commit chips: Enter, then blur.
    pressEnter(input);
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function toggleCcBcc(dialog, kind) {
    // kind: "cc" | "bcc"
    const label = kind === "cc" ? "Add Cc recipients" : "Add Bcc recipients";
    const btn =
      dialog.querySelector(`[aria-label="${label}"]`) ||
      Array.from(dialog.querySelectorAll('span,div[role="button"]')).find(
        (e) => (e.textContent || "").trim().toLowerCase() === kind
      );
    if (btn) btn.click();
  }

  function setSubject(dialog, subject) {
    const input = dialog.querySelector('input[name="subjectbox"]');
    if (!input) return false;
    input.focus();
    setNativeValue(input, subject);
    return true;
  }

  function setBody(dialog, body) {
    const editor =
      dialog.querySelector('div[aria-label="Message Body"]') ||
      dialog.querySelector('div[role="textbox"][contenteditable="true"]');
    if (!editor) return false;
    editor.focus();
    // execCommand is deprecated but is the most reliable way to insert text into
    // Gmail's contenteditable so its own handlers fire.
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, body);
    } catch (_) {
      ok = false;
    }
    if (!ok) {
      editor.textContent = body;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return true;
  }

  function clickSend(dialog) {
    const btn = Array.from(dialog.querySelectorAll('div[role="button"]')).find((b) => {
      const label = (b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || "").trim();
      return /^Send\b/i.test(label);
    });
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  // ── Command handler ────────────────────────────────
  async function handleWriteEmail(p) {
    try {
      const dialog = await openCompose();
      if (!dialog) {
        return { ok: false, message: "Could not open a Gmail compose window. Make sure Gmail is fully loaded." };
      }
      // Give the dialog a moment to finish rendering its fields.
      await waitFor(() => dialog.querySelector('input[name="subjectbox"]'), 4000);

      if (p.cc) toggleCcBcc(dialog, "cc");
      if (p.bcc) toggleCcBcc(dialog, "bcc");
      await sleep(150);

      if (p.to) setRecipients(dialog, "to", p.to);
      if (p.cc) setRecipients(dialog, "cc", p.cc);
      if (p.bcc) setRecipients(dialog, "bcc", p.bcc);
      if (typeof p.subject === "string") setSubject(dialog, p.subject);
      if (typeof p.body === "string") setBody(dialog, p.body);

      if (p.send) {
        await sleep(200);
        const sent = clickSend(dialog);
        return {
          ok: sent,
          message: sent ? "Email composed and Send was clicked." : "Composed, but could not find the Send button.",
        };
      }
      return { ok: true, message: "Email drafted in the Gmail compose window (not sent)." };
    } catch (e) {
      return { ok: false, message: e.message || String(e) };
    }
  }

  connect();
})();
