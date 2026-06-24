// content.js — runs in the page to extract readable text and interact with form fields.
// Injected on demand by the popup via chrome.scripting.executeScript.
// The LAST expression in this file is what gets returned to popup.js as result.result.

const MAX_CHARS = 12000; // keep within model context budgets

function clean(text) {
  return (text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ── Form field interaction functions ─────────────────

/**
 * Get all form fields on the page.
 * Returns an array of { tag, type, name, id, placeholder, value, selector }.
 */
function getFormFields() {
  const fields = [];
  const selectors = [
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset'])",
    "textarea",
    "select",
  ];

  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el, idx) => {
      const tag = el.tagName.toLowerCase();
      const type = el.type || tag;
      const name = el.name || el.getAttribute("name") || "";
      const id = el.id || "";
      const placeholder = el.placeholder || "";
      const value = el.value || "";

      // Build a unique-ish CSS selector
      let selector = "";
      if (id) {
        selector = "#" + CSS.escape(id);
      } else if (name) {
        selector = tag + '[name="' + CSS.escape(name) + '"]';
      } else {
        selector = tag + ":nth-of-type(" + (idx + 1) + ")";
      }

      fields.push({ tag, type, name, id, placeholder, value, selector });
    });
  });

  return fields;
}

/**
 * Set the value of a specific form field identified by a CSS selector.
 * Triggers input/change events so JS frameworks (React, Vue, etc.) detect the change.
 */
function setFormField(selector, value) {
  const el = document.querySelector(selector);
  if (!el) {
    return { ok: false, error: "Field not found: " + selector };
  }

  // Focus the element
  el.focus();

  // For select elements, find and select the matching option
  if (el.tagName.toLowerCase() === "select") {
    // Try exact match first, then case-insensitive, then partial
    let option = el.querySelector('option[value="' + CSS.escape(value) + '"]');
    if (!option) {
      // case-insensitive match
      const lower = value.toLowerCase();
      option = Array.from(el.options).find(
        (opt) => opt.value.toLowerCase() === lower || opt.text.toLowerCase() === lower
      );
    }
    if (!option) {
      // partial match
      const lower = value.toLowerCase();
      option = Array.from(el.options).find(
        (opt) =>
          opt.value.toLowerCase().includes(lower) ||
          opt.text.toLowerCase().includes(lower)
      );
    }
    if (option) {
      el.value = option.value;
    } else {
      return { ok: false, error: "No matching option found for: " + value };
    }
  } else {
    // For input/textarea, use a native setter to trigger React's synthetic event
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ) || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    );

    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  // Dispatch events so frameworks detect the change
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  // Also dispatch a KeyboardEvent to simulate typing (some sites require this)
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));

  return { ok: true, selector, value };
}

/**
 * Fill multiple form fields at once.
 * fields: { selector: value, ... } or [{ selector, value }, ...]
 */
function fillFormFields(fields) {
  const results = [];
  const entries = Array.isArray(fields)
    ? fields
    : Object.entries(fields).map(([selector, value]) => ({ selector, value }));

  entries.forEach(({ selector, value }) => {
    const result = setFormField(selector, value);
    results.push(result);
  });

  return results;
}

// Expose functions to the global scope so popup can call them
window.__getAIBD_getFormFields = getFormFields;
window.__getAIBD_setFormField = setFormField;
window.__getAIBD_fillFormFields = fillFormFields;

// ── Page text extraction — LAST expression = return value ──
(function () {
  // Prefer the main/article element if present, else fall back to body.
  const main =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.body;

  let text = clean(main ? main.innerText : document.body.innerText);
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n…[content truncated]";
  }

  return {
    title: document.title || "",
    url: location.href,
    text,
  };
})();