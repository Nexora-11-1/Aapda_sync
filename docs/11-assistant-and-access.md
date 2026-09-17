# 11 · The assistant, and the bridge into Command

Two subsystems added after the core platform, both of which touch things
that go wrong quietly if they are built casually.

---

## The credential bridge

The public portal and District Command are not two tabs of one application.
They are two trust levels, and crossing between them is an authentication
event.

### What is enforced

| Rule | Where |
|---|---|
| Command is unreachable without a verified credential — no toggle, no query parameter, no console call | `src/auth.js: grantSession`, `views.js: go/render` |
| Leaving Command drops the session; returning requires signing in again | `requestSignOut`, `endSession` |
| Passwords are never stored or compared in plaintext — PBKDF2-SHA-256, 210 000 iterations, per-account salt, constant-time comparison | `deriveKey`, `timingSafeEqual` |
| A wrong operator ID costs the same time as a wrong password | `verifyCredential` derives against a probe salt for unknown accounts |
| Five failed attempts lock the account, backing off from one minute to a fifteen-minute ceiling | `core/lockout.py: LoginGuard` |
| A separate per-address limit catches enumeration across many accounts | `LoginGuard.address_blocked` |
| Sessions expire twice: 15 min idle with a warning, 8 h absolute | `startSessionWatch` |
| Privileged writes require re-entering the password, valid ten minutes | `requirePrivilege`, `core/lockout.py: StepUp`, `routes.py: require_step_up` |
| Scope is checked per asset — a shelter operator may update their own shelter and no other | `saveShelter`, `Operator.may_touch_shelter` |
| Every authentication event is appended to a log the operator can read | Security & Access screen, `audit_log` table |

### Two decisions worth explaining

**The lockout has a ceiling.** Uncapped exponential backoff locks an operator
out for the rest of the shift after a dozen mistyped passwords. During a flood
that is a denial of service against the disaster response itself, which is
worse than the guessing it prevents. Fifteen minutes is slow enough that
guessing is pointless and short enough that nobody is shut out of an emergency.

**A success does not clear the address counter.** Per-account throttling alone
never sees the attack that matters: one password tried against two hundred
usernames trips no account counter at all. The address window catches that, and
reaching one valid credential by guessing is not a reason to forget the
guessing.

**A refused action is refused, not hidden.** Attempting something outside your
role produces a logged denial rather than a greyed-out button, so the boundary
is visible to whoever reviews the log — and so an operator learns where the
boundary is rather than wondering why a control does nothing.

### The offline build

`frontend/dist/aapdasync.html` has no API to authenticate against, so it
verifies locally against PBKDF2 verifiers embedded in `auth.js`. This is a real
check running the real flow — throttling, lockout, step-up, expiry — not a
bypass. Setting `window.AAPDA_API_URL` switches authentication to
`POST /api/auth/login` and the local directory is never consulted again.

---

## The assistant

Retrieval-augmented answering over the platform's own records. The retrieval
is real: BM25 with a title boost over a corpus rebuilt from live state, MMR to
keep the passages from being five copies of each other, and intent-aware
routing. Every answer shows the records it came from.

```
question → tokenise → BM25 (+ title boost) → intent routing → MMR → compose → cite
                                                                  ↓
                                                    refuse, if nothing cleared threshold
```

### Three rules it does not break

1. **Nothing retrieved ⇒ it says so.** No fallback to general knowledge. A
   fluent invented answer is worse than an admission of ignorance, because at
   the moment it matters the two are indistinguishable.
2. **A model estimate is never phrased as a warning.** `caveat_for()` applies
   this mechanically from the kinds of passage used, rather than leaving it to
   a prompt that can be argued around.
3. **No personal safety adjudication.** "Am I safe?" returns the records and
   the official instruction and the emergency number — never a yes or a no.
   That judgement belongs to the authorities and the responder on the ground.

### Why lexical, not embeddings

The corpus is a few thousand short operational records that turn over every few
minutes. An embedding index would be stale before it finished building, and
lexical match is what actually retrieves `SH-206` and `Nandprayag` — the tokens
an operator types.

### The threshold, and the bug it fixes

The refusal test is **score per matchable term**, not an absolute floor. BM25
scales with how many words of the query the corpus knows, so a fixed floor
silently refuses every short question: *"what should I do in a flood"* has
exactly one content word once the stopwords are gone and can never clear a
floor calibrated for a five-word query. The corpus is also asked how many of
the question's words it has ever seen — a question built entirely of unknown
words cannot be answered from these records, and that is the honest signal to
refuse on.

### Server side

`POST /api/assistant/query` runs the same retrieval over the database and
returns the passages plus the constraints any generator must honour. The
generation step never sees more than that set, so the rules above are decided
before a language model is involved rather than requested of it. The corpus is
scoped to what the caller may already read — the assistant is not a quieter
path to data the endpoints would refuse.

Covered by `backend/tests/test_assistant.py`.
