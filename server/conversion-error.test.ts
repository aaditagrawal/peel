import { test } from "node:test";
import assert from "node:assert/strict";
import { conversionError } from "../src/conversion-error";
test("native failures give an actionable message without bridge or Java details", () => {
  const result = conversionError(
    new Error(
      "Call to function 'WhatsAppStickers.convert' has been rejected.\n→ Caused by: java.lang.IllegalStateException: Could not encode this sticker.",
    ),
  );
  assert.match(result, /Try again/);
  assert.doesNotMatch(result, /java|WhatsAppStickers|Exception/);
});
test("preserves actionable file constraints inside native wrappers", () => {
  assert.equal(
    conversionError(
      new Error(
        "Call rejected\n→ Caused by: java.lang.IllegalArgumentException: GIF stickers can be up to 10 seconds long.",
      ),
    ),
    "GIF stickers can be up to 10 seconds long.",
  );
  assert.match(conversionError({}), /Try again/);
});

test("WhatsApp validation results remain visible instead of a generic file error", () => {
  assert.equal(
    conversionError(
      new Error(
        "WhatsApp could not add this pack: Sticker dimensions are invalid.",
      ),
    ),
    "WhatsApp could not add this pack: Sticker dimensions are invalid.",
  );
});
