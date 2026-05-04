import { MODULE_ID } from "./constants.js";

export function clampLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(20, Math.max(1, Math.round(numeric)));
}

export function normalizeSelectionIds(ids) {
  return Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];
}

export function normalizeSourceTypeIds(ids, fallbackId = undefined) {
  const raw = Array.isArray(ids)
    ? ids
    : (ids ? [ids] : (fallbackId ? [fallbackId] : []));
  return [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

export function normalizeCatalogUrls(urls, fallbackUrl = undefined) {
  const raw = Array.isArray(urls)
    ? urls
    : (urls ? [urls] : (fallbackUrl ? [fallbackUrl] : []));
  return [...new Set(raw.map((url) => String(url ?? "").trim()).filter(Boolean))];
}

export function normalizeImportTypeId(id, modeId = undefined) {
  const check = String(id ?? modeId ?? "").trim().toLowerCase();
  if (check.includes("subclass")) return "classes-subclasses";
  if (check.includes("spell")) return "spells";
  if (check.includes("feat")) return "feats";
  if (check.includes("item")) return "items";
  return "classes-subclasses";
}

export function getDefaultSourceTypeId(importTypeId) {
  if (importTypeId === "classes-subclasses") return "srd";
  return "srd";
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeHtml(value) {
  const plain = stripHtml(value);
  if (!plain) return "";
  return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
}
