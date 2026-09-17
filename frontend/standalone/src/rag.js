/* ══════════════════════════════════════════════════════════════════
   ASSISTANT — retrieval-augmented answering over the platform's own records

   The retrieval here is real. A question is tokenised, scored against a
   BM25 index built over every record the platform holds plus a document
   corpus, diversified with MMR so the passages do not all say the same
   thing, and the answer is composed only from what came back — with the
   record each sentence came from shown next to it.

   Three rules it will not break, because an assistant in a disaster
   platform that breaks them is worse than no assistant:

     1. If retrieval returns nothing above threshold, it says it does not
        know. It does not fall back on general knowledge.
     2. A model estimate is never phrased as a warning. Official warnings
        are quoted with their issuing authority attached.
     3. It will not tell an individual whether they personally are safe.
        That is a judgement for the authorities and the responder on the
        ground, and it says so and hands over the numbers instead.

   With a backend, POST /api/assistant/query runs the same retrieval
   server-side over the database and hands the passages to a language
   model under the same three rules. The composer below is what answers
   when the single-file build is running on its own.
   ══════════════════════════════════════════════════════════════════ */

const RAG = {
  chunks: [],        // { id, kind, title, text, tokens, ref, when }
  df: new Map(),     // token → document frequency
  avgLen: 0,
  dirty: true,
  k1: 1.5, b: 0.75,
  /* The miss threshold is per-matchable-term, not absolute. BM25 scores
     scale with how many query words the corpus knows, so a fixed floor
     silently refuses every short question — "what should I do in a flood"
     carries exactly one content word once stopwords are gone, and can
     never clear a floor set for a five-word query. */
  minPerTerm: 0.62,
  history: []
};

/* ── Tokenisation ───────────────────────────────────────────────────
   Light and deliberate: lowercase, split on non-alphanumerics, drop
   stopwords, and fold a few English suffixes so "shelters" matches
   "shelter". Full stemming would cost more than it buys on a corpus
   this size and would mangle Indian place names. */
const STOP = new Set(('a an the is are was were be been being of in on at to for from by with '
  + 'and or but if then than that this these those there here it its as into about over under '
  + 'what which who whom whose when where why how do does did can could should would will shall '
  + 'my your our their i we you they me us them he she his her not no yes any some all more most '
  + 'much many very just also so such own same too s t').split(' '));

function fold(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

function tokenise(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s.-]/g, ' ')
    .split(/[\s.\-]+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(fold);
}

/* ── Corpus ─────────────────────────────────────────────────────────
   Two halves. The live half is rebuilt from the store whenever the
   pipeline has moved; the document half is static and carries the
   things a record cannot say — how a number was produced, what to do
   about it, what the platform will not claim. */

function docCorpus() {
  const D = [];
  const add = (id, kind, title, text, ref) => D.push({ id, kind, title, text, ref });

  /* how the platform works */
  add('doc.risk', 'method', 'How risk is calculated',
    'Risk is the calibrated probability of the hazard occurring in the cell within the forecast horizon, ' +
    'multiplied by expected intensity and by corroboration from independent sources. Confidence is computed ' +
    'separately from probability: a high risk with low confidence means the model is uncertain, not that the ' +
    'danger is smaller. Scores run 0 to 100 and band as low 0-29, medium 30-59, high 60-84, critical 85-100. ' +
    'A cell with no model output is shown as no data with a hatched fill, never as a safe green cell.',
    'Risk engine · backend/app/risk/engine.py');

  add('doc.exposure', 'method', 'How exposure is estimated',
    'Population exposure is a spatial overlay, not probability multiplied by the total population of a cell. ' +
    'The hazard footprint is derived from height above nearest drainage for flood and from slope for landslide, ' +
    'the resident population inside that footprint is counted, and an occupancy factor is applied. ' +
    'Eight thousand people in a cell twelve metres above the drainage line are not eight thousand people at risk.',
    'Exposure engine · backend/app/impact/');

  add('doc.priority', 'method', 'How relocation priority is ranked',
    'Six weighted factors: hazard risk 0.30, population exposure 0.22, vulnerability 0.18, time to hazard 0.13, ' +
    'evacuation difficulty 0.12 and accessibility 0.05. Each contribution is shown and the displayed contributions ' +
    'sum exactly to the score, so a rank can be argued with rather than only accepted. The sort is a stable merge ' +
    'sort at O(n log n) with a documented tie-break, so the queue does not reshuffle between ticks.',
    'Priority engine · backend/app/priority/engine.py');

  add('doc.capacity', 'method', 'How shelter capacity is calculated',
    'Effective capacity is the minimum of space, water, food, sanitation and medical capacity, multiplied by an ' +
    'operational factor, and the platform names which constraint binds. Sphere and NDMA standards are used: ' +
    '3.5 square metres of covered space per person, 15 litres of water per person per day, one latrine per twenty ' +
    'people, one trained responder per 250 people, and 90 percent safe utilisation. A hall rated for five thousand ' +
    'with four thousand two hundred inside and one nurse does not have eight hundred usable places.',
    'Capacity engine · backend/app/capacity/');

  add('doc.routing', 'method', 'How evacuation routes are found',
    'One Dijkstra per zone gives the shortest path to every candidate shelter at once, and A star with a great ' +
    'circle over maximum speed heuristic is used point to point. The heuristic is admissible and consistent so the ' +
    'result is provably optimal. Segments reported blocked are removed from the graph and segments inside the ' +
    'hazard footprint are penalised, so a route is never planned through the thing being escaped.',
    'Routing engine · backend/app/routing/graph.py');

  add('doc.attribution', 'policy', 'Model output is not an official warning',
    'Everything this platform computes is AI-based risk prediction and decision support. It is not an official ' +
    'warning. Official warnings are issued by the India Meteorological Department, the NDMA through SACHET, the ' +
    'Central Water Commission, INCOIS, the National Center for Seismology and the State Disaster Management ' +
    'Authorities, and are carried on this platform verbatim with the issuing authority attached. Where a warning ' +
    'and a model estimate disagree, the warning takes precedence.',
    'Platform policy · §5');

  add('doc.freshness', 'policy', 'Stale data is never shown as live',
    'Every record carries when it was observed and when it was ingested. A source past its staleness window is ' +
    'marked stale, the confidence of any prediction that depended on it is reduced, and the affected output is ' +
    'stamped with the degraded input. A disconnected dashboard says it is offline and shows how old its figures ' +
    'are rather than continuing to display them as current.',
    'Platform policy · §28');

  add('doc.credentials', 'policy', 'Sources that need credentials',
    'Where an Indian authority requires registration, the connector ships as an interface and a configuration ' +
    'placeholder and reports not configured. It does not call a fabricated endpoint. All nine hazards run with no ' +
    'credentials at all, on Open-Meteo, GloFAS, USGS FDSN, GDACS and INCOIS ERDDAP. Credentials buy fidelity, not ' +
    'existence: a keyless flood chain gives modelled five kilometre discharge where a credentialed one gives a ' +
    'surveyed CWC gauge stage.',
    'Data source register · docs/10-data-sources.md');

  add('doc.security', 'policy', 'How access is controlled',
    'The public portal and District Command are two trust levels and crossing between them is an authentication ' +
    'event. Passwords are verified against PBKDF2-SHA-256 with 210 000 iterations and compared in constant time. ' +
    'Five failed attempts lock the account with backoff to a fifteen minute ceiling. Sessions expire after fifteen ' +
    'minutes idle and eight hours absolute. Privileged writes require re-entering the password, and every ' +
    'authentication event is written to an append-only audit log.',
    'Security · src/auth.js, backend/app/core/security.py');

  /* what to do — the part a resident actually needs */
  const SAFETY = {
    flood: ['Flood — what to do',
      'Move to higher ground before water reaches the road, not after. Do not try to cross a flooded causeway on ' +
      'foot or by vehicle: sixty centimetres of moving water will carry a car. Switch off electricity at the mains ' +
      'before you leave. Take identity papers, medicines, a phone and a charger in a sealed bag. Do not return until ' +
      'the district administration says the area is clear, and boil or chlorinate all drinking water afterwards.'],
    landslide: ['Landslide — what to do',
      'New cracks in walls or ground, doors that suddenly stick, tilting poles or trees, and a change in the sound ' +
      'of a stream are all warnings that come before a slope moves. Leave immediately and move sideways out of the ' +
      'path, not downhill along it. Do not stop or park below a cut slope on a hill road. After heavy rain the risk ' +
      'stays high for days because the ground is still saturated.'],
    earthquake: ['Earthquake — what to do',
      'Drop, cover and hold on. Get under a sturdy table and stay away from windows and heavy furniture until the ' +
      'shaking stops. If you are outside, move to open ground away from buildings, walls and power lines. Do not use ' +
      'lifts. Expect aftershocks. Check for gas leaks and structural cracks before re-entering any building.'],
    cyclone: ['Cyclone — what to do',
      'Move to a designated cyclone shelter before the wind rises, not during the storm. Secure or bring in loose ' +
      'roofing sheets and anything that can become a projectile. Keep away from the coast: storm surge, not wind, ' +
      'causes most cyclone deaths. The calm of the eye is not the end of the storm, and the wind returns from the ' +
      'opposite direction.'],
    heatwave: ['Heatwave — what to do',
      'Avoid being outdoors between noon and four. Drink water often even when you are not thirsty, and add salt and ' +
      'sugar or ORS if you are working outside. Cover your head. Check on elderly neighbours, infants and anyone ' +
      'working in the open. Cramps, a headache, or confusion with hot dry skin is heat stroke and it is a medical ' +
      'emergency: cool the person immediately and get help.'],
    lightning: ['Lightning — what to do',
      'Go indoors as soon as you hear thunder, because if you can hear it you are already within range. Avoid open ' +
      'fields, water bodies and isolated trees, which is where most lightning deaths in India happen. If you are ' +
      'caught outside, crouch low with your feet together and do not lie flat. Stay indoors for thirty minutes after ' +
      'the last thunder.'],
    drought: ['Drought — what to do',
      'Follow the district water rationing schedule and report failed handpumps to the block office so the tanker ' +
      'schedule can be updated. Prioritise drinking water over all other uses. Register for the fodder and employment ' +
      'guarantee support the district announces rather than selling livestock at distress prices.'],
    wildfire: ['Forest fire — what to do',
      'Do not enter closed forest blocks. Report smoke to the range office immediately with the location. Move away ' +
      'from the fire at right angles to the wind rather than ahead of it, and downhill rather than up, because fire ' +
      'climbs faster than a person can. Clear dry litter from around the settlement before the fire season.'],
    tsunami: ['Tsunami — what to do',
      'Strong shaking near the coast is itself the warning; do not wait for a bulletin. Move inland and to higher ' +
      'ground on foot, since roads jam. The sea withdrawing far beyond the normal low line means a wave is coming. ' +
      'The first wave is often not the largest, and waves continue for hours. Do not return to the shore until the ' +
      'all-clear is issued by INCOIS or the district administration.']
  };
  for (const h in SAFETY) add('safety.' + h, 'safety', SAFETY[h][0], SAFETY[h][1], 'Public safety guidance · NDMA');

  /* past disasters, for the memorial and for questions about them */
  for (const p of PAST_EVENTS) {
    add('past.' + p.id, 'history', `${p.name} (${p.year})`,
      `${p.what} ${p.toll} ${p.lesson}`, `Historical record · ${p.name}, ${p.year}`);
  }

  /* the hazard catalogue, generated from the backend */
  for (const k of HAZ_ORDER) {
    const h = HAZ[k];
    add('haz.' + k, 'catalogue', `${h.name} — data sources`,
      `${h.name} is fed by ${(h.sources_live || []).join(', ') || 'no configured source'}. ` +
      `Tier: ${h.tier}. Fidelity: ${h.fidelity}. ` +
      `Update cadence about ${Math.round((h.cadence_s || 900) / 60)} minutes, forecast horizon ${h.horizon_h || 24} hours. ` +
      (h.coastal_only ? 'This is a coastal hazard and is not scored for landlocked districts. ' : ''),
      `Hazard catalogue · ${h.name}`);
  }

  return D;
}

/* Live records — rebuilt from the store. */
function liveCorpus() {
  const D = [];
  const add = (id, kind, title, text, ref, when) => D.push({ id, kind, title, text, ref, when });
  const stName = S.focus ? S.states[S.focus].name : 'India';

  for (const st of Object.values(S.states)) {
    const top = Object.entries(st.hz).sort((a, b) => b[1] - a[1]);
    add('st.' + st.id, 'state', `${st.name} — current situation`,
      `${st.name}: ${st.dis}. ${st.note} Current risk scores: ` +
      top.map(([h, v]) => `${HAZ[h].name} ${v} out of 100`).join(', ') + '. ' +
      `Population ${st.pop}. Event declared at ${st.since} IST. ` +
      (st.reg === 'sdma' ? 'Shelter and road registers are SDMA-integrated for this state.'
        : 'Shelter and road registers for this state are provisional pending its SDMA feed.'),
      `Live state record · ${st.name}`, st.since);
  }

  for (const c of S.cells) {
    const rs = Object.entries(c.risk).filter(([, v]) => v >= 0);
    if (!rs.length) continue;
    add('cell.' + c.id, 'cell', `Zone ${c.id} · ${c.name}`,
      `Zone ${c.id} ${c.name} in ${stName}. ` +
      rs.map(([h, v]) => `${HAZ[h].name} risk ${v} out of 100, ${PRI[lvl(v)].n.toLowerCase()} band, ` +
        `confidence ${Math.round((c.confidence[h] || 0) * 100)} percent`).join('. ') + '. ' +
      `Population ${nf(c.pop)}. Elevation ${c.elevation_m} metres, slope ${c.slope_deg} degrees, ` +
      `height above nearest drainage ${c.hand_m} metres. Rainfall in the last 24 hours ${c.rainfall_24h} millimetres. ` +
      (c.river_ratio != null ? `River level ratio to danger level ${c.river_ratio}. ` : 'No river gauge covers this cell. ') +
      (c.degraded.length ? `Degraded input: ${c.degraded.join(', ').toUpperCase()} unavailable, confidence reduced.` : ''),
      `Live risk cell · ${c.id} ${c.name}`, hm());
  }

  for (const a of S.alerts) {
    add('alert.' + a.id, 'alert', `Official warning · ${a.event}`,
      `Official warning issued by ${a.auth}. ${a.head}. Severity ${a.sev}, urgency ${a.urg}, certainty ${a.cert}. ` +
      `Area: ${a.area}. Issued ${a.t} IST, in force until ${a.exp}. Instruction: ${a.inst}`,
      `Official CAP alert ${a.id} · ${a.auth}`, a.t);
  }

  for (const sh of S.shelters) {
    add('sh.' + sh.shelter_id, 'shelter', `${sh.shelter_id} · ${sh.name}`,
      `${sh.name}, shelter ${sh.shelter_id} in zone ${sh.zone}. ` +
      `${sh.operational ? `Open with ${nf(sh.effective_capacity)} effective places available`
        : 'Not usable at present'}. ` +
      `Occupancy ${nf(sh.current_occupancy)} of ${nf(sh.max_capacity)} rated capacity. ` +
      `Limited by ${sh.binding_constraint}. Water ${sh.water_days} days, food ${sh.food_days} days, ` +
      `${sh.medical_staff} medical staff. Last reported ${sh.reported} IST.`,
      `Shelter register · ${sh.shelter_id}`, sh.reported);
  }

  for (const r of S.roads) {
    add('road.' + r.road_id, 'road', `Road · ${r.name}`,
      `${r.name} is ${ROAD_STATE[r.state][0].toLowerCase()}. ${r.reason}. ` +
      `Reported by ${r.by} at ${r.t} IST with confidence ${r.confidence}. ` +
      (r.state === 'open' ? 'This segment is available to the routing engine.'
        : 'The routing engine excludes or penalises this segment.'),
      `Road status · ${r.name}`, r.t);
  }

  for (const s of S.sources) {
    add('src.' + s.key, 'source', `Data source · ${s.authority}`,
      `${s.authority}, key ${s.key}, is ${s.status === 'nc' ? 'not configured' : s.status}. ` +
      (s.age_seconds != null ? `Last delivered ${Math.round(s.age_seconds / 60)} minutes ago. ` : '') +
      (s.quality_score != null ? `Quality score ${s.quality_score}. ` : '') +
      `Access mode ${s.mode}. ${s.is_primary ? 'This is a primary Indian authority source.' : 'This is a supplementary open source.'}`,
      `Source register · ${s.key}`, hm());
  }

  for (const z of S.priorities.slice(0, 10)) {
    add('pri.' + z.cell_id, 'priority', `Priority rank ${z.rank} · ${z.name}`,
      `${z.name} is ranked ${z.rank} for relocation with a priority score of ${z.priority_score}. ` +
      `Expected exposed population ${nf(z.expected_exposed)}. Band ${z.band}. ` +
      `Top contributing factors: ${(z.contributions || []).slice(0, 3).map(c => `${c.label} ${c.contribution}`).join(', ')}.`,
      `Priority ranking · rank ${z.rank}`, hm());
  }

  for (const m of S.models) {
    add('mdl.' + m.model_version, 'model', `Model ${m.model_version}`,
      `Model ${m.model_version} for ${m.hazard}, algorithm ${m.algorithm}, horizon ${m.horizon_hours} hours. ` +
      `ROC AUC ${m.roc_auc}, PR AUC ${m.pr_auc}, recall ${m.recall}, precision ${m.precision}, ` +
      `expected calibration error ${m.ece}. ${m.is_active ? 'Currently active.' : 'Not active.'}`,
      `Model registry · ${m.model_version}`, hm());
  }

  /* What people on the ground have sent in. Carried as what it is — an
     unverified account from a member of the public until an operator says
     otherwise — so the assistant can find it without ever presenting it
     as a measurement. */
  for (const r of S.reports.slice(0, 20)) {
    add('rep.' + r.id, 'report', `Field report ${r.id} · ${r.cat}`,
      `Report ${r.id} from ${r.loc}: ${r.desc} Category ${r.cat}. Received ${r.t} IST. ` +
      (r.st === 'verified'
        ? `Verified by ${r.by || 'an operator'}; it corroborates the surrounding cell.`
        : r.st === 'rejected'
        ? 'Reviewed and rejected by an operator. It raises no score and moves no ranking.'
        : 'Not yet verified. An unverified report raises no score and moves no ranking.'),
      `Field report · ${r.id} (${r.st})`, r.t);
  }

  if (S.latest) {
    add('latest.now', 'state', 'The most severe situation in India right now',
      `The most severe situation in the country at this moment is ${S.latest.name}, ` +
      `${HAZ[S.latest.hazard].name.toLowerCase()} at ${S.latest.score} out of 100, ` +
      `${PRI[lvl(S.latest.score)].n.toLowerCase()} band.`,
      'Live national picture', hm());
  }

  return D;
}

/* ── Index ──────────────────────────────────────────────────────── */
function buildIndex() {
  RAG.chunks = [...docCorpus(), ...liveCorpus()].map(c => ({
    ...c,
    tokens: tokenise(c.title + ' ' + c.text),
    titleTokens: new Set(tokenise(c.title))
  }));
  RAG.df = new Map();
  let total = 0;
  for (const c of RAG.chunks) {
    total += c.tokens.length;
    for (const t of new Set(c.tokens)) RAG.df.set(t, (RAG.df.get(t) || 0) + 1);
  }
  RAG.avgLen = total / Math.max(RAG.chunks.length, 1);
  RAG.dirty = false;
  return RAG.chunks.length;
}
function markRagDirty() { RAG.dirty = true; }

/** Okapi BM25. */
function bm25(queryTokens, chunk) {
  const N = RAG.chunks.length;
  const tf = new Map();
  for (const t of chunk.tokens) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const f = tf.get(q); if (!f) continue;
    const df = RAG.df.get(q) || 0.5;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    let contribution = idf * (f * (RAG.k1 + 1)) /
      (f + RAG.k1 * (1 - RAG.b + RAG.b * chunk.tokens.length / RAG.avgLen));
    /* A term in the title is a stronger signal of what a passage is about
       than the same term buried in its body. */
    if (chunk.titleTokens && chunk.titleTokens.has(q)) contribution *= 1.8;
    score += contribution;
  }
  return score;
}

/* What the question is asking for changes which kind of passage answers
   it. "What should I do" wants the safety guidance, not the model
   registry, even though both mention the hazard. This is routing, not
   invention: the passages still come from real retrieval and are still
   cited, they are merely ranked with the question's shape in mind. */
const INTENT_BOOST = {
  guidance: { safety: 2.2, policy: 1.2, history: 1.1 },
  explain:  { method: 2.0, policy: 1.6, catalogue: 1.3 },
  latest:   { state: 1.9, alert: 1.7, cell: 1.3 },
  locate:   { cell: 1.6, shelter: 1.6, state: 1.4, road: 1.3 },
  quantity: { shelter: 1.5, cell: 1.4, priority: 1.4 }
};

/* Some kinds are simply not an answer to some questions. Someone asking
   what to do in a flood is not helped by the model registry entry for
   the flood model, however many times it says the word "flood". These
   are dropped only while something better is available. */
const INTENT_EXCLUDE = {
  guidance: ['model', 'catalogue', 'source', 'priority', 'report'],
  latest:   ['model', 'method'],
  locate:   ['model', 'method', 'policy', 'history'],
  /* An unverified account of one street is not an answer to "how many". */
  quantity: ['policy', 'history', 'model', 'method', 'report'],
  explain:  ['report']
};

/** Maximal marginal relevance — relevant passages that are not near-duplicates. */
function mmr(scored, k, lambda = 0.72) {
  const chosen = [];
  const pool = scored.slice(0, 40);
  const sim = (a, b) => {
    const A = new Set(a.chunk.tokens), B = new Set(b.chunk.tokens);
    let inter = 0; for (const t of A) if (B.has(t)) inter++;
    return inter / Math.max(1, Math.min(A.size, B.size));
  };
  while (chosen.length < k && pool.length) {
    let best = null, bestVal = -Infinity;
    for (const cand of pool) {
      const redundancy = chosen.length ? Math.max(...chosen.map(c => sim(cand, c))) : 0;
      const val = lambda * cand.score - (1 - lambda) * redundancy * scored[0].score;
      if (val > bestVal) { bestVal = val; best = cand; }
    }
    chosen.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  return chosen;
}

/** The retrieval step, exposed so it can be tested and inspected. */
function ragRetrieve(query, k = 5, intent) {
  if (RAG.dirty) buildIndex();
  const q = tokenise(query);
  if (!q.length) return { passages: [], q, matchable: 0 };

  /* How many of the question's words the corpus knows at all. A question
     built entirely of words this platform has never seen cannot be
     answered from it, and that is the honest signal to refuse on. */
  const matchable = q.filter(t => RAG.df.has(t)).length;
  const boost = INTENT_BOOST[intent] || {};

  let scored = RAG.chunks
    .map(chunk => ({ chunk, score: bm25(q, chunk) * (boost[chunk.kind] || 1) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { passages: [], q, matchable, top: 0 };

  const drop = INTENT_EXCLUDE[intent];
  if (drop) {
    const kept = scored.filter(r => !drop.includes(r.chunk.kind));
    /* Never filter down to nothing — but one passage that answers the
       question asked beats five that answer a different one. */
    if (kept.length) scored = kept;
  }

  return {
    passages: mmr(scored, Math.min(k, scored.length)),
    q, matchable, top: scored[0].score,
    perTerm: scored[0].score / Math.max(matchable, 1)
  };
}

/* ── Intent ─────────────────────────────────────────────────────────
   Not a classifier — a small set of patterns that change how the
   retrieved passages are framed, and one that refuses. */
function intentOf(query) {
  const s = query.toLowerCase();
  if (/\b(am i|are we|is my (house|home|family|village)|will i|should i (leave|evacuate|go))\b/.test(s))
    return 'personal';
  if (/\b(latest|newest|right now|current(ly)?|what.?s happening|most severe|worst)\b/.test(s)) return 'latest';
  if (/\b(what should|what to do|how to (stay|be) safe|prepare|precaution|safety)\b/.test(s)) return 'guidance';
  if (/\b(how many|how much|count|number of|total|have space|available|open now)\b/.test(s)) return 'quantity';
  if (/\b(why|how (does|is|are|do))\b/.test(s)) return 'explain';
  if (/\b(where|nearest|which (state|district|zone|shelter|road|cell)s?)\b/.test(s)) return 'locate';
  return 'general';
}

/* ── Answer composition ─────────────────────────────────────────────
   Grounded strictly in the retrieved passages: each sentence is drawn
   from a passage and carries the record it came from. Nothing is added
   from outside the retrieval set. */
function ragAnswer(query) {
  const intent = intentOf(query);
  const { passages, perTerm, matchable } = ragRetrieve(query, 5, intent);

  if (intent === 'personal') {
    const near = passages.filter(p => ['cell', 'alert', 'shelter', 'state'].includes(p.chunk.kind)).slice(0, 3);
    return {
      refused: true, intent,
      answer: 'I cannot tell you whether you personally are safe. That depends on exactly where you are, ' +
        'and it is a judgement for the authorities and the responders on the ground — not for a model. ' +
        'What I can do is show you what the platform holds for your area, and repeat the official instruction. ' +
        (near.length ? 'Those records are below.' : '') +
        '\n\nIf you are in immediate danger, call 112. The district control room is 1077.',
      passages: near
    };
  }

  if (!passages.length || !matchable || (perTerm || 0) < RAG.minPerTerm) {
    return {
      refused: true, intent,
      answer: 'I do not have a record that answers that. I only answer from this platform\'s own data — ' +
        'risk cells, official alerts, shelters, roads, sources and models — and from its documented methods. ' +
        'Nothing in there matched your question closely enough for me to answer it honestly.\n\n' +
        'Try naming a state, a zone, a shelter, or a hazard, and I will show you what is held for it.',
      passages: []
    };
  }

  const lines = [];
  const cite = [];
  const seen = new Set();

  /* the framing sentence, per intent */
  if (intent === 'latest' && S.latest) {
    lines.push(`The most severe situation in India right now is **${S.latest.name}** — ` +
      `${HAZ[S.latest.hazard].name.toLowerCase()} at ${S.latest.score}/100, ` +
      `${PRI[lvl(S.latest.score)].n.toLowerCase()} band. Assessed ${clk()} IST.`);
  } else if (intent === 'guidance') {
    lines.push('Here is what the official guidance says, and what the platform currently holds for it.');
  }

  for (const p of passages) {
    if (seen.has(p.chunk.ref)) continue;
    seen.add(p.chunk.ref);
    lines.push(sentencesFor(p.chunk, query));
    cite.push({ ref: p.chunk.ref, kind: p.chunk.kind, title: p.chunk.title,
                score: +p.score.toFixed(2), when: p.chunk.when });
  }

  /* the standing caveat, wherever a model number was quoted */
  const usedModel = passages.some(p => ['cell', 'priority', 'model', 'state'].includes(p.chunk.kind));
  const usedAlert = passages.some(p => p.chunk.kind === 'alert');
  let footer = '';
  if (usedModel && !usedAlert)
    footer = 'These are AI-based estimates for decision support, not official warnings.';
  else if (usedModel && usedAlert)
    footer = 'The warning above is official and takes precedence. The scores are model estimates.';

  return { refused: false, intent, answer: lines.join('\n\n'), passages, cite, footer };
}

/** Pull the answering sentences out of a passage, verbatim.

    Order matters differently by kind. Safety guidance is written in the
    order you should act — move first, then what not to do — so ranking
    its sentences by term overlap can put the third instruction first and
    drop the one that saves you. Those passages are quoted in their own
    order; everything else is ranked by relevance to the question. */
function sentencesFor(chunk, query) {
  const sents = chunk.text.split(/(?<=\.)\s+/).filter(s => s.trim().length > 12);
  if (!sents.length) return `**${chunk.title}** — ${chunk.text}`;

  if (chunk.kind === 'safety' || chunk.kind === 'history') {
    return `**${chunk.title}** — ${sents.slice(0, 3).map(s => s.trim()).join(' ')}`;
  }

  const q = new Set(tokenise(query));
  const ranked = sents.map((s, i) => {
    const t = tokenise(s);
    let hit = 0; for (const w of t) if (q.has(w)) hit++;
    return { s, i, hit: hit / Math.max(t.length, 1) * Math.log(1 + hit) };
  }).sort((a, b) => b.hit - a.hit);
  const keep = ranked.slice(0, 2).filter(r => r.hit > 0);
  /* restore document order among the sentences kept, so a two-sentence
     answer never reads back to front */
  const body = (keep.length ? keep : ranked.slice(0, 1))
    .sort((a, b) => a.i - b.i).map(r => r.s.trim()).join(' ');
  return `**${chunk.title}** — ${body}`;
}

/* ── Chat surface ───────────────────────────────────────────────── */
const SUGGEST = {
  gov: ['What is the most severe situation right now?',
        'Which zones are critical and why?',
        'How is shelter capacity calculated?',
        'Which data sources are stale?',
        'Why is that zone ranked first for relocation?'],
  citizen: ['What is happening near me right now?',
            'Which shelters have space?',
            'What should I do in a flood?',
            'Is this an official warning?',
            'Where do these risk numbers come from?']
};

function paintChatSuggest() {
  const el = $('chp'); if (!el) return;
  el.innerHTML = (SUGGEST[S.role === 'gov' ? 'gov' : 'citizen'])
    .map(q => `<button onclick="askAssistant(${JSON.stringify(q).replace(/"/g, '&quot;')})">${esc(q)}</button>`).join('');
}

function bubble(html, cls) {
  const cb = $('cb'); if (!cb) return;
  const d = document.createElement('div');
  d.className = 'bub ' + cls;
  d.innerHTML = html;
  cb.appendChild(d);
  cb.scrollTop = cb.scrollHeight;
  return d;
}

const mdBold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

function askAssistant(q) {
  const text = (q != null ? q : ($('cbi') ? $('cbi').value : '')).trim();
  if (!text) return;
  if ($('cbi')) $('cbi').value = '';
  bubble(esc(text), 'bu');
  RAG.history.push({ role: 'user', text });

  const thinking = bubble('<span class="dots"><i></i><i></i><i></i></span>', 'bt');
  /* a beat, so the retrieval is visibly a step rather than a lookup table */
  setTimeout(() => {
    const r = ragAnswer(text);
    let html = `<div class="ans">${mdBold(r.answer)}</div>`;
    if (r.footer) html += `<div class="ansfoot">${esc(r.footer)}</div>`;
    if (r.cite && r.cite.length) {
      html += `<div class="cites"><div class="cl">Answered from ${r.cite.length} record${r.cite.length === 1 ? '' : 's'}</div>` +
        r.cite.map(c => `<span class="ct" title="relevance ${c.score}${c.when ? ' · ' + c.when + ' IST' : ''}">
          <i class="k-${esc(c.kind)}"></i>${esc(c.ref)}</span>`).join('') + `</div>`;
    }
    thinking.className = 'bub bt';
    thinking.innerHTML = html;
    $('cb').scrollTop = $('cb').scrollHeight;
    RAG.history.push({ role: 'assistant', text: r.answer, refused: r.refused });
    say('Assistant replied');
  }, 260);
}

function toggleChat() {
  S.chat = !S.chat;
  $('chat').classList.toggle('on', S.chat);
  if (S.chat) {
    paintChatSuggest();
    if (RAG.dirty) buildIndex();
    setTimeout(() => { const i = $('cbi'); if (i) i.focus(); }, 120);
  }
}
