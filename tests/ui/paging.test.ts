import assert from "node:assert/strict";
import { test } from "node:test";
import { pageItems } from "../../src/lib/paging.ts";

test("short tables list every page", () => {
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(3, 5), [1, 2, 3, 4, 5]);
});

test("long tables keep the first page, the last page and the current page's neighbours", () => {
  assert.deepEqual(pageItems(1, 10), [1, 2, 3, 4, null, 10]);
  assert.deepEqual(pageItems(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(pageItems(10, 10), [1, null, 7, 8, 9, 10]);
});

test("a gap of a single page shows that page instead of an ellipsis", () => {
  assert.deepEqual(pageItems(4, 10), [1, 2, 3, 4, 5, null, 10]);
});
