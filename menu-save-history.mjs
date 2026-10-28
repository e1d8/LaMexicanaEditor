const HISTORY_KEY = "_editor";
const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long" });
const canonicalJSON = (value) => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
});
const historyError = () => Object.assign(new Error("El contador de guardados de la carta no es válido. Revisa el campo _editor antes de guardar."), { status: 422 });

export function readSaveHistory(menu) {
  if (!Object.hasOwn(menu, HISTORY_KEY)) return null;
  const history = menu[HISTORY_KEY];
  if (!history || typeof history !== "object" || Array.isArray(history)
    || !Number.isSafeInteger(history.saveNumber) || history.saveNumber < 1
    || typeof history.savedAt !== "string" || !Number.isFinite(Date.parse(history.savedAt))) throw historyError();
  return history;
}

export function saveTitle(saveNumber, savedAt) {
  const parts = dateFormat.formatToParts(new Date(savedAt));
  const day = parts.find((part) => part.type === "day").value;
  const month = parts.find((part) => part.type === "month").value;
  return `#${saveNumber} - Cambios del ${day} de ${month[0].toLocaleUpperCase("es-ES")}${month.slice(1)}`;
}

export function prepareMenuSave(current, edited, timestamp) {
  const history = readSaveHistory(current);
  const menu = structuredClone(edited);
  // Only the committed file determines the counter; incoming metadata is ignored.
  if (history) menu[HISTORY_KEY] = structuredClone(history);
  else delete menu[HISTORY_KEY];
  if (canonicalJSON(menu) === canonicalJSON(current)) return { changed: false, menu: current };

  const saveNumber = (history?.saveNumber || 0) + 1;
  if (!Number.isSafeInteger(saveNumber)) throw historyError();
  const savedAt = new Date(timestamp).toISOString();
  menu[HISTORY_KEY] = { ...history, saveNumber, savedAt };
  return { changed: true, menu, title: saveTitle(saveNumber, savedAt) };
}
