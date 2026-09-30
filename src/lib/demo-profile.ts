import type { KidsCriteria } from "./types";

/** Fictional walkthrough profile. Every value is editable before use. */
export const ANNA_MUELLER_DEMO = {
  name: "Anna Müller",
  householdSummary: "One adult and two children: a toddler in Kita and a teenager in high school.",
  currentKiez: { plr_id: "08100311", plr_name: "Reuterplatz", bezirk: "Neukölln", dominant_plz: "12047" },
  kids: { kita: true, primarySchool: false, highSchool: true, kidDoctor: false } satisfies KidsCriteria,
  commuteAddress: "Alexanderplatz, 10178 Berlin",
  rentBudget: "flexible" as const,
  rooms: 3,
  familyAnswer: "I’m Anna Müller, and home to me is a place where my children can settle into their routines: our toddler’s Kita mornings and our teenager’s high-school days.",
  kiezAnswer: "We live in Reuterplatz, Neukölln, and I work near Alexanderplatz. A practical public-transport commute matters to our week.",
  extraAnswer: "I’m looking for a stable, welcoming home where both children can grow and feel part of the neighborhood.",
  story: "Dear landlord,\n\nMy name is Anna Müller. I’m a mother of two—a toddler in Kita and a teenager in high school—and we are looking for a welcoming place to call home. Our daily routines are rooted in Neukölln, and I work near Alexanderplatz, so being able to reach work and keep the children’s daycare and school routines manageable matters to us.\n\nWe would take good care of the home and hope to become considerate, long-term neighbors. Thank you for considering our application. I’d be happy to introduce our family and answer any questions.\n\nBest wishes,\nAnna Müller",
  documents: [
    { key: "identity", url: "/demo-documents/wurzelraum-demo-accepted-identity.pdf", filename: "wurzelraum-demo-accepted-identity.pdf" },
    { key: "payslips", url: "/demo-documents/wurzelraum-demo-accepted-payslips.pdf", filename: "wurzelraum-demo-accepted-payslips.pdf" },
    { key: "schufa", url: "/demo-documents/wurzelraum-demo-accepted-schufa.pdf", filename: "wurzelraum-demo-accepted-schufa.pdf" },
    { key: "mietschuldenfreiheit", url: "/demo-documents/wurzelraum-demo-accepted-rent-certificate.pdf", filename: "wurzelraum-demo-accepted-rent-certificate.pdf" },
  ] as const,
};
