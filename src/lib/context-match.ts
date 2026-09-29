// Keyword matcher from free text ("anything else important to you?", or an
// "other" hobby) to the grounded criteria keys in context-criteria.ts.
// Pure and data-free, so it runs on the client too. The real LLM agent
// does this matching itself (see /api/agent's system prompt); this is the
// no-key path used by the data-only write-up and AGENT_MOCK mode.

/** Whole-word, case-insensitive match that also works for non-ASCII words
 *  ("café", "Lärm") — plain \b treats accented letters as non-word chars. */
function w(alternation: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, "iu");
}

const TOPIC_PATTERNS: [key: string, pattern: RegExp][] = [
  ["schools", w(String.raw`schools?|schule|abitur|gymnasium|education|teachers?`)],
  ["green_space", w(String.raw`parks?|green|nature|garden|forest|wald|trees?|running|jogging|hiking|cycling|walks?|dog`)],
  ["noise", w(String.raw`quiet|noise|noisy|loud|lärm|calm|sleep`)],
  ["air_quality", w(String.raw`air|pollution|asthma|allerg\w*|smog`)],
  ["crime", w(String.raw`safe|safety|crime|security|danger\w*|night`)],
  ["affordability_rent", w(String.raw`rent|cheap|afford\w*|budget|money|expensive`)],
  ["affordability_buy", w(String.raw`buy|buying|purchase|own(ing)? a|mortgage|kaufen|property`)],
  ["family_friendliness", w(String.raw`famil\w*|playmates|other kids|children|neighbou?rs with kids`)],
  ["kita_access", w(String.raw`kita|daycare|nursery|krippe`)],
  ["kinderarzt_access", w(String.raw`doctor|pediatric\w*|paediatric\w*|kinderarzt`)],
  ["yoga", w(String.raw`yoga|pilates`)],
  ["gym", w(String.raw`gym|fitness|crossfit`)],
  ["bouldering", w(String.raw`boulder\w*|climb\w*`)],
  ["transit_access", w(String.raw`transit|trains?|bahn|s-bahn|u-bahn|trams?|bus|car|public transport|commut\w*`)],
  ["wohnlage", w(String.raw`wohnlage|upscale|nice area|good area|residential`)],
  ["socioeconomic_status", w(String.raw`diverse|diversity|affluent|wealthy|status|social mix`)],
  ["distance_from_center", w(String.raw`cent(er|re)|central|suburb\w*|outskirts|downtown|city life`)],
  ["school_construction_activity", w(String.raw`new schools?|school construction|school expansion`)],
];

/** Common topics with no data behind them anywhere in the project — mirrors
 *  UNAVAILABLE_TOPICS in context-criteria.ts, plus sports facilities. */
const UNAVAILABLE_PATTERNS: [label: string, pattern: RegExp][] = [
  ["nightlife and bars", w(String.raw`nightlife|bars?|clubs?|pubs?`)],
  ["cafés and restaurants", w(String.raw`caf[eé]s?|coffee|restaurants?|food`)],
  ["internet speed", w(String.raw`internet|wi-?fi|broadband|fiber|fibre`)],
  ["views and looks", w(String.raw`views?|pretty|beautiful|aesthetic\w*|architecture`)],
  ["walkability", w(String.raw`walkab\w*`)],
  ["parking", w(String.raw`parking`)],
  ["shops", w(String.raw`shops?|shopping|supermarkets?|market`)],
  ["sports facilities", w(String.raw`swimming|pool|football|soccer|tennis|basketball|dance|dancing|martial arts|judo|karate`)],
  ["music and culture", w(String.raw`music|choir|concerts?|theat(er|re)|museums?|galler(y|ies)`)],
];

export interface ContextMatch {
  /** Criteria keys we have real data for (see context-criteria.ts). */
  keys: string[];
  /** Human labels for mentioned topics with no data at all. */
  unavailable: string[];
}

export function matchContextTopics(text: string): ContextMatch {
  if (!text.trim()) return { keys: [], unavailable: [] };
  const keys = TOPIC_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
  const unavailable = UNAVAILABLE_PATTERNS.filter(([, re]) => re.test(text)).map(([l]) => l);
  return { keys, unavailable };
}
