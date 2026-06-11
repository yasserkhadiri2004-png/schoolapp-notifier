// Reçoit du HTML brut, renvoie le texte visible (ou celui d'un sélecteur CSS).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "extract") return;

  try {
    const doc = new DOMParser().parseFromString(msg.html || "", "text/html");
    doc.querySelectorAll("script, style, noscript, svg").forEach((n) => n.remove());

    let nodes = [];
    if (msg.selector && msg.selector.trim()) {
      try {
        nodes = Array.from(doc.querySelectorAll(msg.selector.trim()));
      } catch {
        nodes = [];
      }
    }
    let text;
    if (nodes.length) {
      text = nodes.map((n) => n.textContent || "").join("\n");
    } else {
      text = (doc.body && doc.body.textContent) || "";
    }

    // normaliser les lignes (enlever les lignes vides multiples)
    text = text
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
      .filter((l, i, arr) => l.trim() !== "" || (arr[i - 1] || "").trim() !== "")
      .join("\n")
      .trim();

    sendResponse(text);
  } catch (e) {
    sendResponse("");
  }
  return true;
});
