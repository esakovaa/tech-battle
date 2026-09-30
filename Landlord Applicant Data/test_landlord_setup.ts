import assert from "node:assert/strict";
import { matchIllegalCriterion } from "../src/lib/landlord-illegal-criteria";
import { validateListingConfig } from "../src/lib/landlord-setup-tools";
import { evaluateFinancialRoutes } from "../src/lib/tenant-financial-routes";

const family = matchIllegalCriterion("no families with kids");
assert.equal(family?.key, "family_status_kids");
assert.equal(family?.action, "redirect_to_alternative");

const origin = matchIllegalCriterion("no Turkish tenants");
assert.equal(origin?.key, "ethnicity_origin");
assert.equal(origin?.action, "refuse_outright");

assert.equal(matchIllegalCriterion("non-smoking only"), null);
assert.equal(matchIllegalCriterion("fifth floor, no lift"), null);

const base = {
  property_type: "flat", address: "Example Street 1", rooms: 3, kaltmiete_eur_monthly: 1200, warmmiete_eur_monthly: 1500,
  move_in_date: "2026-12-01", smoking_policy: "non_smoking_only", required_documents: ["identity"], min_income_multiple: 5,
  households_with_children_welcome: true, employment_context_types: ["unlimited_contract", "self_employed", "retired", "limited_contract", "burgergeld"],
};
const valid = validateListingConfig(base);
assert.equal(valid.valid.min_income_multiple, 3);
assert.match(valid.adjustments[0], /2x–3x/);
assert.equal(valid.issues.length, 0);

const invalidPolicy = validateListingConfig({ ...base, smoking_policy: "no_smokers" });
assert.ok(invalidPolicy.issues.some((issue) => issue.includes("smoking policy")));

const invalidDate = validateListingConfig({ ...base, move_in_date: "2026-02-31" });
assert.ok(invalidDate.issues.some((issue) => issue.includes("move-in date")));

const baseRoutes = { monthlyIncome: 1000, minimumIncome: 3000, hasGuarantor: false, hasDepositInsurance: false, savings: 0, minimumSavings: 4500 };
assert.deepEqual(evaluateFinancialRoutes({ ...baseRoutes, monthlyIncome: 3000 }).satisfiedRoutes, ["income"]);
assert.deepEqual(evaluateFinancialRoutes({ ...baseRoutes, hasGuarantor: true }).satisfiedRoutes, ["guarantor"]);
assert.deepEqual(evaluateFinancialRoutes({ ...baseRoutes, hasDepositInsurance: true }).satisfiedRoutes, ["deposit insurance"]);
assert.deepEqual(evaluateFinancialRoutes({ ...baseRoutes, savings: 4500 }).satisfiedRoutes, ["savings"]);
assert.equal(evaluateFinancialRoutes({ ...baseRoutes, monthlyIncome: null }).pass, null);
assert.equal(evaluateFinancialRoutes(baseRoutes).pass, false);

console.log("landlord setup assistant checks passed");
