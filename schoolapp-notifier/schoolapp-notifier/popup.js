const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

let lastUrl = "";
let lastSelector = "";

function fmtTime(ts) {
  if (!ts) return "jamais";
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function paintStatus(state) {
  const r = state.lastResult || {};
  const st = $("status");
  st.className = "status";
  if (!state.lastCheck) {
    st.textContent = "Pas encore vérifié.";
  } else if (r.ok === false) {
    st.className = "status err";
    st.innerHTML = `Dernière vérif ${fmtTime(state.lastCheck)} — <b>${r.error || "erreur"}</b>`;
  } else if (r.baseline) {
    st.className = "status ok";
    st.innerHTML = `Référence enregistrée ${fmtTime(state.lastCheck)}. <b>Je te préviendrai au prochain changement.</b>`;
  } else if (r.changed) {
    st.className = "status ok";
    st.innerHTML = `Dernière vérif ${fmtTime(state.lastCheck)} — <b>nouvelle note détectée !</b>`;
  } else {
    st.innerHTML = `Dernière vérif ${fmtTime(state.lastCheck)} — <b>aucun changement</b>`;
  }

  const banner = $("banner");
  if (r.looksLikeLogin) {
    banner.className = "banner show";
    banner.textContent = "⚠️ La page récupérée ressemble à un écran de connexion. Ouvre SchoolApp et connecte-toi dans le navigateur, puis réessaie.";
  } else {
    banner.className = "banner";
  }

  if (r.preview != null) $("preview").textContent = r.preview;
}

function paintPill(enabled) {
  const pill = $("pill");
  pill.className = "pill" + (enabled ? " live" : "");
  $("pillTxt").textContent = enabled ? "En surveillance" : "En pause";
}

async function load() {
  const state = await send({ type: "getState" });
  const c = state.config || {};
  $("url").value = c.url || "";
  $("interval").value = String(c.intervalMin || 15);
  $("selector").value = c.selector || "";
  $("enabled").checked = !!c.enabled;
  lastUrl = c.url || "";
  lastSelector = c.selector || "";
  paintPill(!!c.enabled);
  paintStatus(state);
  await send({ type: "markSeen" });
}

function readForm() {
  return {
    url: $("url").value.trim(),
    intervalMin: Number($("interval").value),
    selector: $("selector").value.trim(),
    enabled: $("enabled").checked
  };
}

async function save() {
  const config = readForm();
  if (config.enabled && !config.url) {
    $("status").className = "status err";
    $("status").innerHTML = "<b>Ajoute d'abord l'adresse de la page de notes.</b>";
    $("enabled").checked = false;
    return;
  }
  const resetBaseline = config.url !== lastUrl || config.selector !== lastSelector;
  await send({ type: "saveConfig", config, resetBaseline });
  lastUrl = config.url;
  lastSelector = config.selector;
  paintPill(config.enabled);
  $("status").className = "status ok";
  $("status").innerHTML = "<b>Réglages enregistrés.</b>";
}

async function checkNow() {
  const btn = $("check");
  btn.disabled = true;
  btn.textContent = "Vérification…";
  await save(); // s'assure que l'URL courante est prise en compte
  await send({ type: "checkNow" });
  const state = await send({ type: "getState" });
  paintStatus(state);
  await send({ type: "markSeen" });
  btn.disabled = false;
  btn.textContent = "Vérifier maintenant";
}

$("save").addEventListener("click", save);
$("check").addEventListener("click", checkNow);
$("enabled").addEventListener("change", save);
document.addEventListener("DOMContentLoaded", load);
load();
