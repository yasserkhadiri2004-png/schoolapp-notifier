// ===== SchoolApp – Alerte notes : service worker (arrière-plan) =====

const ALARM_NAME = "schoolapp-check";
const DEFAULTS = { url: "", intervalMin: 15, selector: "", enabled: false };

// ---------- utilitaires storage ----------
async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULTS, ...(config || {}) };
}
async function setState(patch) {
  const cur = await chrome.storage.local.get(null);
  await chrome.storage.local.set({ ...cur, ...patch });
}

// ---------- planification ----------
async function reschedule() {
  const cfg = await getConfig();
  await chrome.alarms.clear(ALARM_NAME);
  if (cfg.enabled && cfg.url) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: Math.max(1, Number(cfg.intervalMin) || 15),
      delayInMinutes: 0.1
    });
  }
}

chrome.runtime.onInstalled.addListener(reschedule);
chrome.runtime.onStartup.addListener(reschedule);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_NAME) checkNow().catch(console.error);
});

// ---------- document offscreen pour parser le HTML ----------
let creatingOffscreen = null;
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Extraire le texte des notes depuis le HTML récupéré."
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function extractText(html, selector) {
  await ensureOffscreen();
  return await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "extract",
    html,
    selector
  });
}

// ---------- comparaison ----------
function toLines(txt) {
  return (txt || "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
}
function newLines(oldTxt, newTxt) {
  const oldSet = new Set(toLines(oldTxt));
  return toLines(newTxt).filter((l) => !oldSet.has(l));
}
function looksLikeLogin(txt) {
  const t = (txt || "").toLowerCase();
  const hits = ["mot de passe", "se connecter", "connexion", "identifiant", "login", "password", "sign in"]
    .filter((k) => t.includes(k)).length;
  return hits >= 2 && (txt || "").length < 1200;
}

// ---------- vérification principale ----------
async function checkNow() {
  const cfg = await getConfig();
  if (!cfg.url) {
    await setState({ lastResult: { ok: false, error: "Aucune URL configurée." }, lastCheck: Date.now() });
    return { ok: false, error: "Aucune URL configurée." };
  }

  let html;
  try {
    const res = await fetch(cfg.url, { credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error("Réponse HTTP " + res.status);
    html = await res.text();
  } catch (e) {
    const error = "Impossible de charger la page (" + (e.message || e) + ").";
    await setState({ lastResult: { ok: false, error }, lastCheck: Date.now() });
    return { ok: false, error };
  }

  let text;
  try {
    text = await extractText(html, cfg.selector);
  } catch (e) {
    const error = "Échec d'extraction du contenu.";
    await setState({ lastResult: { ok: false, error }, lastCheck: Date.now() });
    return { ok: false, error };
  }
  text = (text || "").trim();

  const login = looksLikeLogin(text);
  const { snapshot } = await chrome.storage.local.get("snapshot");

  // premier passage : on enregistre la référence sans alerter
  if (snapshot === undefined || snapshot === null) {
    await setState({
      snapshot: text,
      lastCheck: Date.now(),
      lastResult: { ok: true, changed: false, baseline: true, looksLikeLogin: login, preview: text.slice(0, 1500) }
    });
    return { ok: true, baseline: true };
  }

  const added = newLines(snapshot, text);
  const changed = text !== snapshot && added.length > 0;

  if (changed && !login) {
    const { unseenCount = 0 } = await chrome.storage.local.get("unseenCount");
    const count = unseenCount + 1;
    await chrome.action.setBadgeBackgroundColor({ color: "#FFB020" });
    await chrome.action.setBadgeText({ text: String(count) });

    const body = added.slice(0, 4).join("\n") || "Le contenu de la page a changé.";
    chrome.notifications.create("note-" + Date.now(), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Nouvelle note détectée 🎓",
      message: body.slice(0, 240),
      priority: 2,
      requireInteraction: true
    });

    await setState({
      snapshot: text,
      unseenCount: count,
      lastCheck: Date.now(),
      lastResult: { ok: true, changed: true, looksLikeLogin: login, newLines: added.slice(0, 10), preview: text.slice(0, 1500) }
    });
    return { ok: true, changed: true, newLines: added };
  }

  // pas de changement (ou page de login -> on ne met pas à jour la référence)
  await setState({
    snapshot: login ? snapshot : text,
    lastCheck: Date.now(),
    lastResult: { ok: true, changed: false, looksLikeLogin: login, preview: text.slice(0, 1500) }
  });
  return { ok: true, changed: false, looksLikeLogin: login };
}

// clic sur la notification -> ouvrir la page de notes
chrome.notifications.onClicked.addListener(async () => {
  const cfg = await getConfig();
  if (cfg.url) chrome.tabs.create({ url: cfg.url });
});

// ---------- messages depuis le popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return; // ignorer les messages destinés à l'offscreen
  (async () => {
    if (msg.type === "saveConfig") {
      await setState({ config: { ...DEFAULTS, ...msg.config } });
      // réinitialiser la référence si l'URL ou le sélecteur change
      if (msg.resetBaseline) await chrome.storage.local.remove("snapshot");
      await reschedule();
      sendResponse({ ok: true });
    } else if (msg.type === "checkNow") {
      const r = await checkNow();
      sendResponse(r);
    } else if (msg.type === "getState") {
      const all = await chrome.storage.local.get(null);
      sendResponse({ config: { ...DEFAULTS, ...(all.config || {}) }, ...all });
    } else if (msg.type === "markSeen") {
      await chrome.action.setBadgeText({ text: "" });
      await setState({ unseenCount: 0 });
      sendResponse({ ok: true });
    }
  })();
  return true; // réponse asynchrone
});
