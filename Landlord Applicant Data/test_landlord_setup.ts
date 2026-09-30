import assert from "node:assert/strict";
import { matchIllegalCriterion } from "../src/lib/landlord-illegal-criteria";
import { validateListingConfig } from "../src/lib/landlord-setup-tools";

const family = matchIllegalCriterion("no families with kids");
assert.equal(family?.key, "family_status_kids");
assert.equal(family?.action, "redirect_to_alternative");

const origin = matchIllegalCriterion("no Turkish tenants");
assert.equal(origin?.key, "ethnicity_origin");
assert.equal(origin?.action, "refuse_outright");

assert.equal(matchIllegalCriterion("non-smoking only"), null);
assert.equal(matchIllegalCriterion("fifth floor, no lift"), null);

const base = {
  address: "Example Street 1", rooms: 3, kaltmiete_eur_monthly: 1200, warmmiete_eur_monthly: 1500,
  move_in_date: "2026-12-01", smoking_policy: "non_smoking_only", required_documents: ["identity"], min_income_multiple: 5,
};
const valid = validateListingConfig(base);
assert.equal(valid.valid.min_income_multiple, 3);
assert.match(valid.adjustments[0], /2x–3x/);
assert.equal(valid.issues.length, 0);

const invalidPolicy = validateListingConfig({ ...base, smoking_policy: "no_smokers" });
assert.ok(invalidPolicy.issues.some((issue) => issue.includes("smoking policy")));

const invalidDate = validateListingConfig({ ...base, move_in_date: "2026-02-31" });
assert.ok(invalidDate.issues.some((issue) => issue.includes("move-in date")));

console.log("landlord setup assistant checks passed");
