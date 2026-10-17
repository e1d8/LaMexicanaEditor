import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateMenu, newId, priceFromInput, summarizeChanges } from "../public/menu-model.js";
const fixture = JSON.parse(await readFile(new URL("./fixtures/menu.json", import.meta.url)));

test("accepts the menu format including a product without a price", () => assert.deepEqual(validateMenu(fixture), []));
test("rejects malformed entries without silently deleting data", () => {
  for (const change of [
    (menu) => { menu.sections[0].items.push(null); },
    (menu) => { menu.sections[0].name = " "; },
    (menu) => { menu.sections[0].items[0].price = "-2€"; },
    (menu) => { menu.sections[0].items[0].price = 2; },
    (menu) => { menu.sections[0].items[0].price = "3.999€"; },
    (menu) => { menu.sections[0].items[0].description = {}; },
    (menu) => { menu.sections[0].items[0].allergens = ["toString"]; },
    (menu) => { menu.allergens.lacteo.icon = "javascript:alert(1)"; },
    (menu) => { menu.sections[1].id = "bebidas-title"; },
    (menu) => { menu.sections[1].id = "menu-button"; },
    (menu) => { menu.sections[1].id = "bebidas"; },
    (menu) => { menu.sections[1].items = []; },
    (menu) => { menu.sections = []; }
  ]) {
    const menu = structuredClone(fixture); change(menu);
    const before = JSON.stringify(menu);
    assert.ok(validateMenu(menu).length);
    assert.equal(JSON.stringify(menu), before);
  }
  for (const menu of [null, [], { sections: [] }, { allergens: {}, sections: {} }]) assert.ok(validateMenu(menu).length);
});
test("generates identifiers without accents, duplicates or heading collisions", () => {
  assert.equal(newId("Menú niños", []), "menu-ninos");
  assert.equal(newId("Tacos", ["tacos"]), "tacos-2");
  assert.equal(newId("Tacos title", ["tacos"]), "tacos-title-2");
  assert.equal(newId("Tacos", ["tacos-title"]), "tacos-2");
  assert.equal(newId("123", []), "seccion-123");
  assert.equal(newId("Menu button", []), "menu-button-2");
});
test("prices are guided, precise, non-negative and reject scientific notation", () => {
  for (const [input, expected] of [["5,50", "5.50€"], ["5.5", "5.50€"], ["0", "0.00€"], ["12", "12.00€"]]) assert.equal(priceFromInput(input), expected);
  for (const input of ["", "-1", "2.999", "2,000.00", "1e4", "Infinity", "gratis", "1000000"]) assert.throws(() => priceFromInput(input));
});
test("change summary includes deletes, additions, names, order and allergen changes", () => {
  assert.deepEqual(summarizeChanges(fixture, structuredClone(fixture)), []);
  const after = structuredClone(fixture);
  after.sections.reverse(); after.sections[0].name = "Nuevos tacos"; after.allergens.lacteo.label = "Leche";
  const changes = summarizeChanges(fixture, after);
  assert.ok(changes.some((text) => text.includes("Renombrar")));
  assert.ok(changes.some((text) => text.includes("orden")));
  assert.ok(changes.some((text) => text.includes("alérgenos")));
});
