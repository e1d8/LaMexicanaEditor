import { validateMenu, newId, priceFromInput, summarizeChanges } from "./menu-model.js";

const $ = (selector, root = document) => root.querySelector(selector);
const config = window.EDITOR_CONFIG || {};
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const apiBase = (isLocal ? "" : config.apiBase || "").replace(/\/$/, "");
const DRAFT_KEY = `mexicana-draft:${apiBase || location.origin}`;
const state = { menu: null, original: null, version: null, selected: null, icons: [], mode: null, dirty: false, saving: false };
const clone = (value) => structuredClone(value);
// Remove credentials left by the previous version without touching menu drafts.
try { sessionStorage.removeItem(`mexicana-session:${apiBase}`); } catch { /* Storage may be disabled. */ }
const legacyFragment = new URLSearchParams(location.hash.slice(1));
if (legacyFragment.has("session") || legacyFragment.has("error")) {
  history.replaceState(null, "", location.pathname + location.search);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, className, onClick) {
  const element = node("button", className, text);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}
function message(text, error = false, actions = []) {
  const notice = $("#notice");
  notice.className = error ? "error" : "";
  notice.replaceChildren(node("span", "", text), ...actions);
  notice.hidden = false;
}
function hideMessage() { $("#notice").hidden = true; }
function showPanel(name) {
  for (const id of ["loading", "error-panel", "editor"]) $(`#${id}`).hidden = id !== name;
}
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      cache: "no-store", ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
    });
  } catch {
    throw new Error("No hay conexión con el servicio de guardado. Comprueba tu conexión y vuelve a intentarlo. Tus cambios siguen en el editor.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "No se ha podido completar la operación.");
    error.status = response.status;
    error.details = data.errors;
    throw error;
  }
  return data;
}
function rememberDraft() {
  try {
    if (state.dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: state.version, menu: state.menu }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* Saving still works when browser storage is unavailable. */ }
}
function changed() {
  state.dirty = JSON.stringify(state.menu) !== JSON.stringify(state.original);
  rememberDraft();
  render();
}
function currentSection() { return state.menu.sections.find((section) => section.id === state.selected); }

function render() {
  const menu = state.menu;
  if (!menu) return;
  if (!menu.sections.some((section) => section.id === state.selected)) state.selected = menu.sections[0]?.id;
  const errors = validateMenu(menu);
  const count = menu.sections.reduce((sum, section) => sum + section.items.length, 0);
  $("#total-products").textContent = count;
  $("#total-sections").textContent = menu.sections.length;
  $("#section-count").textContent = menu.sections.length;
  $("#save-state").textContent = state.saving ? "Guardando…" : state.dirty ? "Cambios sin guardar" : "Todo al día";
  $("#save-hint").textContent = errors.length ? "Añade productos a las secciones nuevas" : state.dirty ? "Guarda cuando todo esté a tu gusto" : "La carta está lista para tus clientes";
  $("#state-dot").classList.toggle("dirty", state.dirty);
  $("#save").disabled = !state.dirty || state.saving || errors.length > 0;
  $("#discard").disabled = !state.dirty || state.saving;
  $("#preview").disabled = state.saving;
  for (const id of ["add-section", "organize", "allergens", "add-product", "rename-section"]) $(`#${id}`).disabled = state.saving;
  const nav = $("#section-nav");
  nav.replaceChildren(...menu.sections.map((section) => {
    const entry = button("", `section-nav-button${section.id === state.selected ? " active" : ""}`, () => {
      state.selected = section.id;
      $("#search").value = "";
      render();
    });
    entry.append(node("strong", "", section.name), node("span", "", section.items.length));
    entry.setAttribute("aria-current", section.id === state.selected ? "page" : "false");
    entry.disabled = state.saving;
    return entry;
  }));
  const section = currentSection();
  if (!section) return;
  $("#section-position").textContent = `SECCIÓN ${menu.sections.indexOf(section) + 1} DE ${menu.sections.length}`;
  $("#section-title").textContent = section.name;
  $("#section-description").textContent = "Cada detalle cuenta. Así lo verán tus clientes.";
  renderProducts();
}
function iconUrl(path) { return `${apiBase}/icons/${encodeURIComponent(path.split("/").pop())}`; }
function allergenChips(item, menu = state.menu) {
  const chips = node("div", "allergen-chips");
  for (const key of item.allergens || []) {
    const definition = menu.allergens[key];
    const chip = node("span", "allergen-chip");
    const image = node("img");
    image.src = iconUrl(definition.icon);
    image.alt = "";
    chip.append(image, document.createTextNode(definition.label));
    chips.append(chip);
  }
  return chips;
}
function renderProducts() {
  const section = currentSection();
  if (!section) return;
  const search = $("#search").value.trim().toLocaleLowerCase("es");
  const visible = section.items.map((item, index) => ({ item, index })).filter(({ item }) => `${item.name} ${item.description || ""}`.toLocaleLowerCase("es").includes(search));
  $("#visible-count").textContent = `${visible.length} ${visible.length === 1 ? "producto" : "productos"}`;
  const list = $("#products");
  list.replaceChildren();
  if (!visible.length) {
    const empty = node("div", "empty-panel");
    empty.append(node("h3", "", search ? "No hay productos con ese nombre" : "El primer plato lo eliges tú"), node("p", "", search ? "Prueba con otra palabra o borra la búsqueda." : "Añade un producto para completar esta sección y poder guardar la carta."));
    if (!search) empty.append(button("＋ Añadir el primer producto", "button primary", () => productForm()));
    list.append(empty);
    return;
  }
  for (const { item, index } of visible) {
    const card = node("article", "product-card");
    const info = node("div", "product-info");
    info.append(node("h3", "", item.name));
    if (item.description) info.append(node("p", "", item.description));
    if (item.allergens?.length) info.append(allergenChips(item));
    const actions = node("div", "product-actions");
    const moveUp = button("↑", "", () => moveProduct(index, -1));
    moveUp.setAttribute("aria-label", `Subir ${item.name}`);
    moveUp.disabled = index === 0 || state.saving;
    const moveDown = button("↓", "", () => moveProduct(index, 1));
    moveDown.setAttribute("aria-label", `Bajar ${item.name}`);
    moveDown.disabled = index === section.items.length - 1 || state.saving;
    const edit = button("✎ Editar", "edit", () => productForm(index));
    edit.setAttribute("aria-label", `Editar ${item.name}`);
    const remove = button("Eliminar", "delete", () => deleteProduct(index));
    remove.setAttribute("aria-label", `Eliminar ${item.name}`);
    edit.disabled = remove.disabled = state.saving;
    actions.append(moveUp, moveDown, edit, remove);
    card.append(node("span", "product-number", String(index + 1).padStart(2, "0")), info, node("span", "product-price", item.price || "A consultar"), actions);
    list.append(card);
  }
}
function moveProduct(index, direction) {
  const items = currentSection().items;
  [items[index], items[index + direction]] = [items[index + direction], items[index]];
  changed();
}

let dialogEdited = false;
let dialogLocked = false;
function openDialog(title, description = "", wide = false) {
  const dialog = $("#dialog");
  if (dialog.open) dialog.close();
  dialog.classList.toggle("wide", wide);
  const content = $("#dialog-body");
  content.replaceChildren(node("h2", "", title));
  content.firstChild.id = "dialog-title";
  if (description) content.append(node("p", "dialog-description", description));
  dialogEdited = false;
  dialogLocked = false;
  $("#close-dialog").disabled = false;
  dialog.showModal();
  return content;
}
function closeDialog(force = false) {
  if (dialogLocked && !force) return;
  if (!force && dialogEdited && !window.confirm("¿Cerrar sin aplicar los cambios de este formulario?")) return;
  $("#dialog").close();
  dialogEdited = false;
}
function field(form, name, label, { value = "", type = "text", help = "", required = false, multiline = false } = {}) {
  const group = node("div", "form-field");
  const caption = node("label", "", label);
  caption.htmlFor = `field-${name}`;
  const input = node(multiline ? "textarea" : "input");
  input.id = `field-${name}`;
  input.name = name;
  if (!multiline) input.type = type;
  input.value = value;
  input.required = required;
  group.append(caption, input);
  if (help) group.append(node("small", "", help));
  form.append(group);
  return input;
}
function formError(form, text) {
  let error = $(".form-error", form);
  if (!error) { error = node("div", "form-error"); error.setAttribute("role", "alert"); form.append(error); }
  error.textContent = text;
}
function formActions(form, submitText = "Aplicar cambios") {
  const actions = node("div", "dialog-actions");
  const submit = node("button", "button primary", submitText);
  submit.type = "submit";
  actions.append(button("Cancelar", "button secondary", () => closeDialog()), submit);
  form.append(actions);
  form.addEventListener("input", () => { dialogEdited = true; });
  form.addEventListener("change", () => { dialogEdited = true; });
}
function productForm(index) {
  const section = currentSection();
  const original = index === undefined ? {} : section.items[index];
  const content = openDialog(index === undefined ? "Un nuevo sabor en la carta" : "Editar producto", "Completa los datos del producto. Los cambios se publicarán cuando guardes la carta.");
  const form = node("form");
  content.append(form);
  const name = field(form, "name", "Nombre del producto", { value: original.name, required: true });
  name.autocomplete = "off";
  const description = field(form, "description", "Descripción · opcional", { value: original.description, multiline: true, help: "Cuenta qué lleva y cómo se prepara." });
  const price = field(form, "price", "Precio en euros", { value: original.price?.replace("€", "").trim().replace(".", ","), required: !!original.price || index === undefined, help: "Por ejemplo: 5,50. El símbolo € se añade automáticamente." });
  price.inputMode = "decimal";
  price.autocomplete = "off";
  const consultLabel = node("label", "check");
  const consult = node("input");
  consult.type = "checkbox";
  consult.checked = index !== undefined && original.price === undefined;
  price.disabled = consult.checked;
  consultLabel.append(consult, document.createTextNode("Precio a consultar (no mostrar importe)"));
  form.append(consultLabel);
  consult.addEventListener("change", () => { price.disabled = consult.checked; price.required = !consult.checked; });
  const destinationGroup = node("div", "form-field");
  const destLabel = node("label", "", "Sección de la carta");
  destLabel.htmlFor = "field-destination";
  const destination = node("select");
  destination.id = "field-destination";
  for (const option of state.menu.sections) {
    const entry = node("option", "", option.name);
    entry.value = option.id;
    entry.selected = option.id === section.id;
    destination.append(entry);
  }
  destinationGroup.append(destLabel, destination);
  form.append(destinationGroup);
  const allergenField = node("fieldset", "form-field");
  allergenField.style.border = "0";
  allergenField.style.padding = "0";
  allergenField.append(node("legend", "field-label", "Alérgenos"), node("p", "help-text", "Marca todos los que contenga el producto. Deja sin marcar si no contiene ninguno de los indicados."));
  const choices = node("div", "allergen-options");
  const checks = [];
  for (const [key, definition] of Object.entries(state.menu.allergens)) {
    const label = node("label", "check allergen-option");
    const input = node("input");
    input.type = "checkbox";
    input.checked = original.allergens?.includes(key) || false;
    const img = node("img"); img.src = iconUrl(definition.icon); img.alt = "";
    label.append(input, img, document.createTextNode(definition.label));
    choices.append(label);
    checks.push({ key, input });
  }
  allergenField.append(choices);
  form.append(allergenField);
  formActions(form, index === undefined ? "Añadir a la carta" : "Aplicar cambios");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!name.value.trim()) { formError(form, "Escribe el nombre del producto."); name.focus(); return; }
    const updated = { ...original, name: name.value.trim() };
    if (description.value.trim()) updated.description = description.value.trim(); else delete updated.description;
    if (consult.checked) delete updated.price;
    else {
      try { updated.price = priceFromInput(price.value); }
      catch (error) { formError(form, error.message); price.focus(); return; }
    }
    const allergens = checks.filter(({ input }) => input.checked).map(({ key }) => key);
    if (allergens.length) updated.allergens = allergens; else delete updated.allergens;
    if (destination.value !== section.id && index !== undefined && section.items.length === 1) {
      formError(form, "Es el único producto de esta sección. Añade otro antes de moverlo, o elimina la sección desde «Organizar secciones»."); return;
    }
    if (index !== undefined) section.items.splice(index, 1, ...(destination.value === section.id ? [updated] : []));
    if (index === undefined || destination.value !== section.id) state.menu.sections.find((s) => s.id === destination.value).items.push(updated);
    state.selected = destination.value;
    $("#search").value = "";
    closeDialog(true);
    changed();
    hideMessage();
  });
  name.focus();
}
function confirmAction(title, description, action, label = "Eliminar", warning = "Este cambio se publicará únicamente cuando guardes la carta.") {
  const content = openDialog(title, description);
  content.append(node("div", "warning-box", warning));
  const actions = node("div", "dialog-actions");
  actions.append(button("Cancelar", "button secondary", () => closeDialog()), button(label, "button danger", () => { closeDialog(true); action(); }));
  content.append(actions);
}
function deleteProduct(index) {
  const section = currentSection();
  if (section.items.length === 1) {
    message("Es el único producto de la sección. Para quitar también la sección, utiliza «Organizar secciones».", true); return;
  }
  confirmAction("¿Eliminar este producto?", section.items[index].name, () => { section.items.splice(index, 1); changed(); });
}
function sectionForm(id) {
  const section = state.menu.sections.find((s) => s.id === id);
  const content = openDialog(section ? "Editar sección" : "Una nueva sección", "Agrupa tus productos para que tus clientes encuentren lo que buscan.");
  const form = node("form"); content.append(form);
  const name = field(form, "section-name", "Nombre de la sección", { value: section?.name, required: true, help: "Por ejemplo: Especialidades de la casa." });
  formActions(form, section ? "Aplicar cambios" : "Crear sección");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!name.value.trim()) { formError(form, "Escribe un nombre para la sección."); return; }
    if (section) section.name = name.value.trim();
    else {
      const added = { id: newId(name.value, state.menu.sections.map((s) => s.id)), name: name.value.trim(), items: [] };
      state.menu.sections.push(added); state.selected = added.id;
    }
    closeDialog(true); changed();
    if (!section) { message("Sección creada. Añade su primer producto para poder guardar la carta."); productForm(); }
  });
  name.focus();
}
function organizeSections() {
  const content = openDialog("Cada sección en su sitio", "Usa las flechas para cambiar el orden. Se mostrará igual en la carta.", true);
  state.menu.sections.forEach((section, index) => {
    const row = node("div", "manage-row");
    const label = node("div", "row-name", section.name);
    label.append(node("small", "row-count", `${section.items.length} productos`));
    const move = (direction) => {
      const sections = state.menu.sections;
      [sections[index], sections[index + direction]] = [sections[index + direction], sections[index]];
      changed(); organizeSections();
    };
    const up = button("↑", "", () => move(-1)); up.disabled = index === 0; up.setAttribute("aria-label", `Subir ${section.name}`);
    const down = button("↓", "", () => move(1)); down.disabled = index === state.menu.sections.length - 1; down.setAttribute("aria-label", `Bajar ${section.name}`);
    const remove = button("Eliminar", "danger-link", () => confirmAction("¿Eliminar toda esta sección?", `«${section.name}» y sus ${section.items.length} productos se quitarán de la carta.`, () => {
      state.menu.sections = state.menu.sections.filter((s) => s.id !== section.id); changed(); organizeSections();
    }));
    remove.disabled = state.menu.sections.length === 1;
    row.append(label, up, down, button("Editar", "", () => sectionForm(section.id)), remove);
    content.append(row);
  });
  const actions = node("div", "dialog-actions");
  actions.append(button("＋ Añadir sección", "button secondary", () => sectionForm()), button("Listo", "button primary", () => closeDialog()));
  content.append(actions);
}
function manageAllergens() {
  const content = openDialog("Alérgenos, claros para todos", "Los alérgenos que configures aquí estarán disponibles al editar cualquier producto.", true);
  Object.entries(state.menu.allergens).forEach(([key, definition]) => {
    const uses = state.menu.sections.flatMap((s) => s.items).filter((item) => item.allergens?.includes(key)).length;
    const row = node("div", "manage-row");
    const img = node("img"); img.src = iconUrl(definition.icon); img.alt = "";
    const label = node("div", "row-name", definition.label);
    label.append(node("small", "row-count", `En ${uses} productos`));
    const remove = button("Eliminar", "danger-link", () => {
      if (uses) { message(`«${definition.label}» está asignado a ${uses} productos. Quítalo de esos productos antes de eliminarlo.`, true); closeDialog(); return; }
      confirmAction("¿Eliminar este alérgeno?", definition.label, () => { delete state.menu.allergens[key]; changed(); manageAllergens(); });
    });
    row.append(img, label, button("Editar", "", () => allergenForm(key)), remove);
    content.append(row);
  });
  const actions = node("div", "dialog-actions");
  actions.append(button("＋ Añadir alérgeno", "button secondary", () => allergenForm()), button("Listo", "button primary", () => closeDialog()));
  content.append(actions);
}
function allergenForm(key) {
  const definition = key ? state.menu.allergens[key] : null;
  const content = openDialog(definition ? "Editar alérgeno" : "Añadir alérgeno", "Elige un nombre claro y el icono que lo representa.");
  const form = node("form"); content.append(form);
  const name = field(form, "allergen-name", "Nombre del alérgeno", { value: definition?.label, required: true });
  const group = node("div", "form-field");
  const label = node("label", "", "Icono"); label.htmlFor = "allergen-icon";
  const select = node("select"); select.id = "allergen-icon"; select.required = true;
  const placeholder = node("option", "", "Elige un icono…"); placeholder.value = ""; select.append(placeholder);
  for (const path of state.icons) {
    const option = node("option", "", path.split("/").pop().replace(/\.[^.]+$/, "").replace(/-/g, " "));
    option.value = path; option.selected = path === definition?.icon; select.append(option);
  }
  const iconPreview = node("img"); iconPreview.width = 40; iconPreview.height = 40; iconPreview.alt = "Vista previa del icono"; iconPreview.hidden = !definition;
  if (definition) iconPreview.src = iconUrl(definition.icon);
  select.addEventListener("change", () => { iconPreview.hidden = !select.value; if (select.value) iconPreview.src = iconUrl(select.value); });
  group.append(label, select, node("small", "", "Los iconos disponibles ya están incluidos en la carta."), iconPreview); form.append(group);
  formActions(form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!name.value.trim() || !select.value) { formError(form, "Escribe un nombre y elige un icono."); return; }
    const duplicate = Object.entries(state.menu.allergens).some(([otherKey, item]) => otherKey !== key && item.label.toLocaleLowerCase("es") === name.value.trim().toLocaleLowerCase("es"));
    if (duplicate) { formError(form, "Ya existe un alérgeno con ese nombre."); return; }
    const id = key || newId(name.value, Object.keys(state.menu.allergens));
    state.menu.allergens[id] = { ...definition, label: name.value.trim(), icon: select.value };
    closeDialog(true); changed(); manageAllergens();
  });
  name.focus();
}
function previewMenu(menu = state.menu) {
  const content = openDialog("Así se verá tu carta", "Revisa nombres, descripciones, precios y alérgenos antes de guardar.", true);
  const preview = node("div", "preview-menu");
  for (const section of menu.sections) {
    preview.append(node("h3", "", section.name));
    for (const item of section.items) {
      const entry = node("div", "preview-item");
      const heading = node("div", "preview-item-heading");
      heading.append(node("strong", "", item.name), node("span", "price", item.price || "A consultar"));
      entry.append(heading);
      if (item.description) entry.append(node("p", "", item.description));
      if (item.allergens?.length) entry.append(allergenChips(item, menu));
      preview.append(entry);
    }
  }
  content.append(preview);
  const actions = node("div", "dialog-actions"); actions.append(button("Seguir editando", "button primary", () => closeDialog())); content.append(actions);
}
function reviewSave() {
  const errors = validateMenu(state.menu);
  if (errors.length) { message(errors.join("\n"), true); return; }
  const changes = summarizeChanges(state.original, state.menu);
  const content = openDialog("¿Todo a tu gusto?", "Estos son los cambios que vas a guardar en la carta.");
  const list = node("ul", "change-list"); changes.forEach((change) => list.append(node("li", "", change))); content.append(list);
  content.append(node("div", "warning-box", state.mode === "local" ? "Se actualizará directamente la carta de este ordenador." : "Se actualizará la carta en GitHub. La web pública puede tardar unos minutos en mostrar los cambios."));
  const error = node("div", "form-error"); error.hidden = true; error.setAttribute("role", "alert"); content.append(error);
  const actions = node("div", "dialog-actions");
  const cancel = button("Seguir editando", "button secondary", () => closeDialog());
  const save = button("Sí, guardar cambios", "button primary", async () => {
    state.saving = true; dialogLocked = true; render();
    save.disabled = cancel.disabled = $("#close-dialog").disabled = true;
    save.textContent = "Guardando…"; error.hidden = true;
    try {
      const result = await request("/api/menu", { method: "PUT", body: JSON.stringify({ menu: state.menu, version: state.version }) });
      state.version = result.version;
      state.original = clone(state.menu);
      state.dirty = false;
      rememberDraft();
      closeDialog(true);
      message(result.message || "Cambios guardados. Tu carta ya está actualizada.");
    } catch (failure) {
      error.hidden = false;
      error.textContent = failure.status === 409 ? "La carta ha cambiado desde que la abriste. Tus cambios se conservan. Cierra esta ventana y recarga la carta antes de volver a editar." : `${failure.message}${failure.details ? `\n${failure.details.join("\n")}` : ""}`;
    } finally {
      state.saving = false; dialogLocked = false; render();
      save.disabled = cancel.disabled = $("#close-dialog").disabled = false;
      save.textContent = "Sí, guardar cambios";
    }
  });
  actions.append(cancel, save); content.append(actions);
}
async function load() {
  hideMessage(); showPanel("loading");
  try {
    if (!apiBase && location.hostname.endsWith("github.io")) throw new Error("El servicio de guardado todavía no está conectado. Falta completar la configuración del editor.");
    const data = await request("/api/menu");
    const errors = validateMenu(data.menu);
    if (errors.length) throw new Error(`La carta actual necesita una revisión antes de editarse:\n${errors.join("\n")}`);
    state.menu = data.menu; state.original = clone(data.menu); state.version = data.version;
    state.mode = data.mode; state.icons = data.icons; state.selected = state.menu.sections[0].id; state.dirty = false;
    $("#connection").textContent = data.mode === "local" ? "Edición local" : "Editor público";
    showPanel("editor"); render();
    let draft;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { /* Ignore inaccessible storage. */ }
    if (draft?.menu && !validateMenu(draft.menu).length && JSON.stringify(draft.menu) !== JSON.stringify(state.menu)) {
      if (draft.version === state.version) {
        message("Hay cambios sin guardar de tu última visita.", false, [button("Recuperar cambios", "text-button", () => { state.menu = draft.menu; changed(); hideMessage(); }), button("Descartar borrador", "text-button", () => { localStorage.removeItem(DRAFT_KEY); hideMessage(); })]);
      } else {
        message("Hay un borrador de una versión anterior. La carta ha cambiado; no lo aplicaremos automáticamente.", true, [button("Ver borrador", "text-button", () => previewMenu(draft.menu)), button("Descartar borrador", "text-button", () => { localStorage.removeItem(DRAFT_KEY); hideMessage(); })]);
      }
    }
  } catch (error) {
    $("#error-message").textContent = error.message;
    $("#connection").textContent = "Sin conexión";
    showPanel("error-panel");
  }
}
$("#search").addEventListener("input", renderProducts);
$("#add-product").addEventListener("click", () => productForm());
$("#add-section").addEventListener("click", () => sectionForm());
$("#rename-section").addEventListener("click", () => sectionForm(state.selected));
$("#organize").addEventListener("click", organizeSections);
$("#allergens").addEventListener("click", manageAllergens);
$("#preview").addEventListener("click", () => previewMenu());
$("#save").addEventListener("click", reviewSave);
$("#retry").addEventListener("click", load);
$("#close-dialog").addEventListener("click", () => closeDialog());
$("#dialog").addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(); });
$("#discard").addEventListener("click", () => confirmAction("¿Descartar tus cambios?", "La carta volverá a la última versión que guardaste.", () => {
  state.menu = clone(state.original); $("#search").value = ""; changed(); hideMessage();
}, "Descartar cambios", "Los cambios sin guardar se perderán."));
window.addEventListener("beforeunload", (event) => { if (state.dirty || state.saving) { event.preventDefault(); event.returnValue = ""; } });
load();
