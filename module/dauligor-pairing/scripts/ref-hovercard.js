// Reference hover-cards (page-system follow-up).
//
// Hovering a reference ANYWHERE Foundry renders enriched text (sheets, journals,
// chat) shows a small preview card; clicking still does its normal thing (a
// Foundry @UUID content-link opens the Foundry item; a Dauligor ref opens the
// Library / app). Two families are covered:
//   • Foundry content-links (@UUID[…] → <a class="content-link" data-uuid>) —
//     previewed from the linked Foundry DOCUMENT (name / img / description), i.e.
//     the same object clicking opens. No auth needed (fromUuid is local).
//   • Dauligor refs (<a class="dauligor-ref" data-ref-kind data-ref-id>) —
//     previewed from APP data via content-service resolveReferences (needs login).
//
// The card is a single body-level element (pointer-events:none) positioned next
// to the hovered link, so it never interferes with the click. Tokens fall back to
// literals because this lives outside the Dauligor window scope (like .dauligor-ref
// and the login card in base.css).

import { resolveReferences } from "./content-service.js";
import { isLoggedIn } from "./auth-service.js";
import { log } from "./utils.js";

const SELECTOR = ".dauligor-ref[data-ref-kind], a.content-link[data-uuid]";

let _tip = null;
let _activeAnchor = null;
let _token = 0;
const _uuidCache = new Map(); // uuid → card data | null

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Strip HTML tags, enriched refs (@Kind[…]{…} / &Reference[…]{…}, any case),
// leftover [..]/{display} brackets, and HTML entities → a clamped plain excerpt.
function excerpt(text, max = 240) {
  const t = String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:@|&amp;|&)\w+\[[^\]]*\](?:#[\w-]+)?(?:\{[^}]*\})?/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function titleCase(s) {
  const v = String(s ?? "");
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

function ensureTip() {
  if (_tip && _tip.isConnected) return _tip;
  _tip = document.createElement("div");
  _tip.className = "dauligor-reftip";
  _tip.style.display = "none";
  document.body.appendChild(_tip);
  return _tip;
}

function hide() {
  _token++;
  _activeAnchor = null;
  if (_tip) {
    _tip.style.display = "none";
    _tip.innerHTML = "";
  }
}

function cardHtml({ image, sub, title, summary, tag, tagKind }) {
  const img = image
    ? `<div class="dauligor-reftip__media"><img src="${esc(image)}" alt="" referrerpolicy="no-referrer" /></div>`
    : "";
  const subEl = sub ? `<div class="dauligor-reftip__sub">${esc(sub)}</div>` : "";
  const sumEl = summary ? `<div class="dauligor-reftip__summary">${esc(summary)}</div>` : "";
  const tagEl = tag
    ? `<div class="dauligor-reftip__tag dauligor-reftip__tag--${esc(tagKind || "info")}">${esc(tag)}</div>`
    : "";
  return `${img}<div class="dauligor-reftip__body">${subEl}<div class="dauligor-reftip__title">${esc(title)}</div>${sumEl}${tagEl}</div>`;
}

// Dauligor ref → app data (or a friendly state when logged out / not-yet-made).
async function dataForDauligorRef(a) {
  const kind = a.dataset.refKind;
  const id = a.dataset.refId;
  const label = (a.textContent || "").trim() || id || kind;
  if (!kind || !id) return null;
  if (!isLoggedIn()) {
    return { title: label, sub: titleCase(kind), summary: "", tag: "Log in to preview", tagKind: "info" };
  }
  const map = await resolveReferences([{ kind, id }]);
  const r = map.get(`${kind}:${id}`);
  if (!r) {
    return { title: label, sub: titleCase(kind), summary: "", tag: "Reference not yet made", tagKind: "missing" };
  }
  return {
    image: r.image || null,
    sub: r.sourceLabel || titleCase(kind),
    title: r.name || label,
    summary: excerpt(r.summary),
  };
}

// Foundry content-link → the linked document's own display data.
async function dataForContentLink(a) {
  const uuid = a.dataset.uuid;
  if (!uuid) return null;
  if (_uuidCache.has(uuid)) return _uuidCache.get(uuid);
  const fromUuidFn = globalThis.fromUuid;
  if (typeof fromUuidFn !== "function") return null;
  let data = null;
  try {
    const doc = await fromUuidFn(uuid);
    if (doc) {
      const sys = doc.system || {};
      const descRaw = sys?.description?.value ?? (typeof sys?.description === "string" ? sys.description : "");
      data = {
        image: doc.img || null,
        sub: doc.type ? titleCase(doc.type) : (doc.documentName || ""),
        title: doc.name || "Unknown",
        summary: excerpt(descRaw),
      };
    }
  } catch (err) {
    log("ref hover: fromUuid failed", uuid, err);
    data = null;
  }
  _uuidCache.set(uuid, data);
  return data;
}

function position(tip, rect) {
  const margin = 8;
  const vw = document.documentElement.clientWidth || window.innerWidth || 0;
  const vh = document.documentElement.clientHeight || window.innerHeight || 0;
  tip.style.display = "block";
  tip.style.visibility = "hidden"; // measure first
  tip.style.top = "0px";
  tip.style.left = "0px";
  const box = tip.getBoundingClientRect();
  let top = rect.bottom + margin;
  if (top + box.height > vh - margin) {
    const above = rect.top - box.height - margin;
    top = above >= margin ? above : Math.max(margin, vh - box.height - margin);
  }
  let left = rect.left;
  if (left + box.width > vw - margin) left = vw - margin - box.width;
  if (left < margin) left = margin;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.visibility = "visible";
}

async function onOver(ev) {
  const a = ev.target?.closest?.(SELECTOR);
  if (!a || a === _activeAnchor) return;
  // A ref that already sits inside an expanded card (the card IS the preview).
  if (a.classList.contains("dauligor-ref") && a.closest(".dauligor-card")) return;
  _activeAnchor = a;
  const token = ++_token;
  const rect = a.getBoundingClientRect();
  let data = null;
  try {
    data = a.classList.contains("content-link")
      ? await dataForContentLink(a)
      : await dataForDauligorRef(a);
  } catch (err) {
    log("ref hover: data lookup failed", err);
    data = null;
  }
  // Superseded (pointer moved / left) while resolving.
  if (token !== _token || _activeAnchor !== a) return;
  if (!data) { hide(); return; }
  const tip = ensureTip();
  tip.className = "dauligor-reftip";
  tip.innerHTML = cardHtml(data);
  position(tip, rect);
}

function onOut(ev) {
  const a = ev.target?.closest?.(SELECTOR);
  if (!a || a !== _activeAnchor) return;
  // Ignore moves between child nodes still inside the same anchor.
  const to = ev.relatedTarget;
  if (to && (a === to || a.contains(to))) return;
  hide();
}

/** Register the global reference hover-card handler. Call once in `ready`. */
export function registerRefHoverCards() {
  document.addEventListener("pointerover", onOver);
  document.addEventListener("pointerout", onOut);
  // A scroll or window blur can strand the card — hide it.
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
  log("Registered Dauligor reference hover cards.");
}
