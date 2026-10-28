import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareMenuSave, readSaveHistory, saveTitle } from "../menu-save-history.mjs";
const fixture = JSON.parse(await readFile(new URL("./fixtures/menu.json", import.meta.url)));

test("new numbering starts at one only after a content change and never mutates inputs", () => {
  const same = prepareMenuSave(fixture, structuredClone(fixture), Date.now());
  assert.equal(same.changed, false);
  assert.equal(readSaveHistory(same.menu), null);
  const edited = structuredClone(fixture); edited.sections[0].items[0].price = "2.50€";
  const save = prepareMenuSave(fixture, edited, Date.parse("2026-10-17T12:00:00Z"));
  assert.equal(save.changed, true);
  assert.equal(save.menu._editor.saveNumber, 1);
  assert.equal(save.title, "#1 - Cambios del 17 de Octubre");
  assert.equal(fixture._editor, undefined);
  assert.equal(edited._editor, undefined);
});
test("the saved file controls the next number and additional fields survive", () => {
  const current = structuredClone(fixture);
  current.extra = { keep: true };
  current._editor = { saveNumber: 12, savedAt: "2026-10-16T12:00:00Z", extra: "preserved" };
  const edited = structuredClone(current); edited.sections.reverse();
  edited._editor = { saveNumber: -99 };
  const save = prepareMenuSave(current, edited, Date.parse("2026-10-17T12:00:00Z"));
  assert.equal(save.menu._editor.saveNumber, 13);
  assert.equal(save.menu._editor.extra, "preserved");
  assert.deepEqual(save.menu.extra, { keep: true });
});
test("only changing metadata is ignored, including on unnumbered older menus", () => {
  const edited = structuredClone(fixture); edited._editor = { saveNumber: 999 };
  assert.equal(prepareMenuSave(fixture, edited, Date.now()).changed, false);
});
test("dates use Madrid daylight saving and month/year transitions", () => {
  assert.equal(saveTitle(1, "2026-10-17T21:59:00Z"), "#1 - Cambios del 17 de Octubre");
  assert.equal(saveTitle(2, "2026-10-17T22:00:00Z"), "#2 - Cambios del 18 de Octubre");
  assert.equal(saveTitle(3, "2026-12-31T23:00:00Z"), "#3 - Cambios del 1 de Enero");
  assert.equal(saveTitle(4, "2026-10-25T22:30:00Z"), "#4 - Cambios del 25 de Octubre");
});
test("invalid stored counters never silently reset or overflow", () => {
  for (const history of [null, {}, [], { saveNumber: 0 }, { saveNumber: "1", savedAt: "2026-10-17" }, { saveNumber: 1, savedAt: "invalid" }]) {
    assert.throws(() => readSaveHistory({ ...fixture, _editor: history }), { status: 422 });
  }
  const current = { ...fixture, _editor: { saveNumber: Number.MAX_SAFE_INTEGER, savedAt: "2026-10-17T12:00:00Z" } };
  const edited = structuredClone(current); edited.sections.reverse();
  assert.throws(() => prepareMenuSave(current, edited, Date.now()), { status: 422 });
});
