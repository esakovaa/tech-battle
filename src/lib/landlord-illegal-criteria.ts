/**
 * Auditable policy registry for tenant-selection criteria the setup assistant
 * must refuse or redirect. This table is product policy, not an automated
 * legal opinion; AGG application depends on the letting and statutory scope.
 */
export interface IllegalCriterionCategory {
  key: string;
  label: string;
  examplePhrasings: string[];
  basis: string;
  action: "refuse_outright" | "redirect_to_alternative";
  alternative: string | null;
}

export const ILLEGAL_CRITERIA: IllegalCriterionCategory[] = [
  {
    key: "ethnicity_origin",
    label: "Ethnicity or ethnic origin",
    examplePhrasings: [
      "no foreigners",
      "foreigners not allowed",
      "German tenants only",
      "only German tenants",
      "no Turkish tenants",
      "no tenants from Turkey",
      "no immigrants",
      "German names only",
      "reject applicants based on their name",
    ],
    basis: "AGG §§ 1, 2(1) no. 8 and 19 protect access to housing from ethnic-origin discrimination, subject to the statute’s scope and exceptions.",
    action: "refuse_outright",
    alternative: null,
  },
  {
    key: "religion",
    label: "Religion or belief",
    examplePhrasings: [
      "Christian tenants only",
      "only Christian tenants",
      "no Muslim tenants",
      "no Jewish tenants",
      "no headscarves",
      "exclude applicants based on religion",
    ],
    basis: "AGG §§ 1, 2(1) no. 8 and 19 name religion as a protected ground for housing access, subject to statutory scope and exceptions.",
    action: "refuse_outright",
    alternative: null,
  },
  {
    key: "disability",
    label: "Disability",
    examplePhrasings: [
      "no disabled tenants",
      "disabled people may not apply",
      "able-bodied tenants only",
      "no wheelchair users",
      "exclude applicants with disabilities",
      "no tenants with a disability",
    ],
    basis: "AGG §§ 1, 2(1) no. 8 and 19 name disability as a protected ground for housing access, subject to statutory scope and exceptions.",
    action: "refuse_outright",
    alternative: null,
  },
  {
    key: "age",
    label: "Age",
    examplePhrasings: [
      "young professionals only",
      "no pensioners",
      "under 40 only",
      "over 60 not allowed",
      "exclude older applicants",
      "no elderly tenants",
    ],
    basis: "AGG §§ 1, 2(1) no. 8 and 19 name age as a protected ground for housing access, subject to statutory scope and exceptions.",
    action: "refuse_outright",
    alternative: null,
  },
  {
    key: "sexual_orientation_gender",
    label: "Sex, gender, or sexual orientation",
    examplePhrasings: [
      "no gay tenants",
      "no lesbian tenants",
      "no trans tenants",
      "heterosexual couples only",
      "women only",
      "men only",
      "exclude applicants based on gender",
      "exclude applicants based on sexual orientation",
    ],
    basis: "AGG §§ 1, 2(1) no. 8 and 19 name sex and sexual identity as protected grounds for housing access, subject to statutory scope and exceptions.",
    action: "refuse_outright",
    alternative: null,
  },
  {
    key: "language_nationality_proxy",
    label: "Language or passport as a nationality proxy",
    examplePhrasings: [
      "fluent German required",
      "must speak fluent German",
      "native German speakers only",
      "German passport required",
      "German citizens only",
      "German-speaking tenants only",
      "reject applicants who do not speak German",
    ],
    basis: "AGG §§ 1, 2(1) no. 8 and 19; language or passport rules can act as proxies for ethnic origin and require case-specific review.",
    action: "refuse_outright",
    alternative: null,
  },
  {
    key: "family_status_kids",
    label: "Excluding households with children or by family type",
    examplePhrasings: [
      "no families with kids",
      "no families with children",
      "no children allowed",
      "child-free building",
      "households with children may not apply",
      "singles only",
      "couples only",
    ],
    basis: "Product fairness policy: do not exclude a household type; assess the flat’s room count and objective suitability instead.",
    action: "redirect_to_alternative",
    alternative: "Set the room count accurately. Occupancy fit is assessed structurally, not by excluding a household type.",
  },
  {
    key: "employment_type_blanket",
    label: "Blanket employment-type exclusions",
    examplePhrasings: [
      "permanent contract only",
      "permanent job required",
      "no freelancers",
      "freelancers may not apply",
      "no students",
      "students may not apply",
      "employed applicants only",
      "no unemployed applicants",
    ],
    basis: "Product fairness rule: employment type is not a blanket gate; the existing financial-security test has four equal routes.",
    action: "redirect_to_alternative",
    alternative: "Use min_income_multiple instead. Financial security already has four equal routes: the income threshold, a guarantor, deposit insurance, or savings covering about three months’ warm rent. Do not add an employment-type exclusion.",
  },
];

function normalizePhrase(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * V1 is intentionally a small exact-substring matcher over reviewed examples,
 * not natural-language understanding. A null result means only “no registry
 * phrase matched”; it is not a legal clearance. Neutral property facts such as
 * “fifth floor, no lift” are deliberately absent from the disability phrases.
 */
export function matchIllegalCriterion(phrase: string): IllegalCriterionCategory | null {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return null;

  return (
    ILLEGAL_CRITERIA.find((category) =>
      category.examplePhrasings.some((example) => normalized.includes(normalizePhrase(example)))
    ) ?? null
  );
}
