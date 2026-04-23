import { MODULE_ID } from "./constants.js";

export function log(message, ...args) {
  console.log(`${MODULE_ID} | ${message}`, ...args);
}

export function warn(message, ...args) {
  console.warn(`${MODULE_ID} | ${message}`, ...args);
}

export function notifyInfo(message) {
  ui.notifications?.info(message);
}

export function notifyWarn(message) {
  ui.notifications?.warn(message);
}

export function slugifyFilename(name) {
  const safe = String(name ?? "export")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safe || "export";
}

export function downloadJson(data, filenameBase) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  foundry.utils.saveDataToFile(blob, "application/json", `${slugifyFilename(filenameBase)}.json`);
}

export function getCleanSource(document) {
  return foundry.utils.deepClone(document.toObject());
}

export function buildDocumentEnvelope(document) {
  return {
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    documentName: document.documentName,
    uuid: document.uuid,
    name: document.name,
    type: document.type ?? null,
    source: getCleanSource(document)
  };
}

export async function promptForText({
  title,
  label,
  value = "",
  hint = ""
}) {
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `
        <div class="form-group">
          <label>${foundry.utils.escapeHTML(label)}</label>
          <input type="text" name="value" value="${foundry.utils.escapeHTML(value)}" autofocus>
          ${hint ? `<p class="hint">${hint}</p>` : ""}
        </div>
      `,
      ok: {
        label: "Continue",
        callback: (_event, button) => button.form.elements.value.value.trim()
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

export async function chooseDownload({ title, name }) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>Prepared <strong>${foundry.utils.escapeHTML(name)}</strong>. Download it as JSON?</p>`,
    modal: true,
    rejectClose: false,
    yes: { label: "Download" },
    no: { label: "Skip" }
  });
}
