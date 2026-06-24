// content.js — runs in the page to extract readable text.
// Injected on demand by the popup via chrome.scripting.executeScript.
(function () {
  const MAX_CHARS = 12000; // keep within model context budgets

  function clean(text) {
    return (text || "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

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
