export const RESERVED_IDS = ["main-content", "menu-sections", "navigation-list", "menu-button", "menu-overlay"];
export const ICON_PATTERN = /^assets\/allergens\/[a-zA-Z0-9_-]+\.(svg|png|webp)$/;
export const PRICE_PATTERN = /^\d+(?:[.,]\d{1,2})?\s*€$/;
export const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;

// Fail closed: never silently drop information when loading or saving an editable menu.
export function validateMenu(menu) {
  const errors = [];
  if (!isRecord(menu) || !isRecord(menu.allergens) || !Array.isArray(menu.sections)) {
    return ["La carta debe contener sus secciones y su catálogo de alérgenos."];
  }
  for (const [key, allergen] of Object.entries(menu.allergens)) {
    if (!text(key) || !isRecord(allergen) || !text(allergen.label) || !ICON_PATTERN.test(allergen.icon ?? "")) {
      errors.push(`El alérgeno «${key}» necesita un nombre y un icono válido.`);
    }
  }
  if (!menu.sections.length) errors.push("La carta necesita al menos una sección con productos.");
  const usedIds = new Set(RESERVED_IDS);
  menu.sections.forEach((section, sectionIndex) => {
    const title = `Sección ${sectionIndex + 1}`;
    if (!isRecord(section)) { errors.push(`${title}: información incorrecta.`); return; }
    if (typeof section.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(section.id)
      || usedIds.has(section.id) || usedIds.has(`${section.id}-title`)) {
      errors.push(`${title}: su identificador está repetido o no es válido.`);
    } else { usedIds.add(section.id); usedIds.add(`${section.id}-title`); }
    if (!text(section.name)) errors.push(`${title}: escribe un nombre.`);
    if (!Array.isArray(section.items) || !section.items.length) {
      errors.push(`«${section.name || title}»: añade al menos un producto.`); return;
    }
    section.items.forEach((item, itemIndex) => {
      const label = `«${section.name || title}», producto ${itemIndex + 1}`;
      if (!isRecord(item)) { errors.push(`${label}: información incorrecta.`); return; }
      if (!text(item.name)) errors.push(`${label}: escribe un nombre.`);
      if (item.description !== undefined && typeof item.description !== "string") errors.push(`${label}: revisa la descripción.`);
      if (item.price !== undefined && (typeof item.price !== "string" || !PRICE_PATTERN.test(item.price.trim()))) errors.push(`${label}: el precio debe ser un importe en euros con hasta dos decimales.`);
      if (item.allergens !== undefined && (!Array.isArray(item.allergens)
        || !item.allergens.every((key) => typeof key === "string" && Object.hasOwn(menu.allergens, key)))) errors.push(`${label}: revisa los alérgenos seleccionados.`);
    });
  });
  return errors;
}

export function newId(name, existingIds) {
  const taken = new Set([...RESERVED_IDS, ...existingIds.flatMap((id) => [id, `${id}-title`])]);
  let base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z]/.test(base)) base = `seccion-${base || "nueva"}`;
  let id = base;
  for (let suffix = 2; taken.has(id) || taken.has(`${id}-title`); suffix++) id = `${base}-${suffix}`;
  return id;
}

export function priceFromInput(value) {
  const clean = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean) || !Number.isFinite(Number(clean)) || Number(clean) > 999999.99) {
    throw new Error("Escribe un precio entre 0 y 999.999,99 €, con un máximo de dos decimales.");
  }
  return `${Number(clean).toFixed(2)}€`;
}

export function summarizeChanges(before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const changes = [];
  const oldIds = before.sections.map((s) => s.id), newIds = after.sections.map((s) => s.id);
  for (const section of before.sections) {
    if (!newIds.includes(section.id)) changes.push(`Eliminar sección «${section.name}» y sus ${section.items.length} productos.`);
  }
  for (const section of after.sections) {
    const old = before.sections.find((s) => s.id === section.id);
    if (!old) changes.push(`Añadir sección «${section.name}» con ${section.items.length} productos.`);
    else {
      if (old.name !== section.name) changes.push(`Renombrar «${old.name}» a «${section.name}».`);
      if (JSON.stringify(old.items) !== JSON.stringify(section.items)) changes.push(`Actualizar los productos de «${section.name}» (${old.items.length} → ${section.items.length}).`);
    }
  }
  if (JSON.stringify(oldIds.filter((id) => newIds.includes(id))) !== JSON.stringify(newIds.filter((id) => oldIds.includes(id)))) changes.push("Cambiar el orden de las secciones.");
  if (JSON.stringify(before.allergens) !== JSON.stringify(after.allergens)) changes.push("Actualizar el catálogo de alérgenos.");
  if (!changes.length) changes.push("Actualizar información de la carta.");
  return changes;
}
