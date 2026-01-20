// utils/constants/TagRefs.js

/**
 * Enum-like object for tag "ref" values used across the backend.
 * These map directly to entries in the `tags` table (column `ref`).
 */
const TagRefs = {
  BREAKDOWN: "bd",
  MACHINE_STATE: "mchnst",
  FIRST_FAULT: "alarm",
  BOTTLES_COUNT: "bc",
  REJECTED_BOTTLES: "lost",
  CURRENT_SPEED: "flspd",
  RECIPE: "rcpn",
  CASE_COUNT: "csct",
  PALLET_COUNT: "pltsct",
  CURRENT_PROGRAM: "prgm",
  BOTTLES_PLANNED: "bp",
  BATCH_ACTIVE: "bac",
  BLOWERINPUT: "bc1",
};

Object.freeze(TagRefs); // Optional safety against accidental mutation

module.exports = TagRefs;
