# `@mrpl/dsh-workbench-admin-console`

**Priority: 🟠 Important**

The admin and policy console: dashboard counters, the live security-events
feed, and the per-role override table `wb-policy` reads.

A leaf client plugin. It provides no `ctx` service and nothing depends on it.

## The one write path

§6.11 allows exactly one, and this package keeps to it: edits go through
`ctx.wbPolicy.setRoleOverride()`, into `wb-policy`'s own override table — the
same one `evaluate()` consults. There is **no local copy of policy state
anywhere in this package**, so there is no way for what the console shows to
drift from what is enforced, and no second decision path.

`governance()` returns a deep copy for rendering; mutating it changes nothing.
A test covers that specifically.

Every committed edit publishes `wb/policy/override-changed`, which `wb-audit`
records as a `policy_override` entry. A governance change is as observable as
a decision — §9 invariant 4 does not stop at decisions.

## Data sources

| Panel | Source |
|---|---|
| Counters | `ctx.wbAudit.query({})` |
| Security events | the same entries, filtered to `policy_decision` and `policy_override` |
| Override table | `ctx.wbPolicy.governance()` |

### Counter definitions

Counters are computed by pure functions in `dashboard-model.ts`, kept out of
the React tree because this is where a defect misstates the security posture —
an undercounted "Blocked Requests" reads as a quiet system rather than a
broken one.

| Counter | Definition |
|---|---|
| Users | distinct `userId` across all entries |
| Active agents | distinct `sessionId` across all entries |
| Documents | distinct `documentId` on `ingestion_completed` entries |
| Policy decisions | count of `policy_decision` entries |
| Blocked requests | `policy_decision` entries whose decision is `DENY` |

Users and agents count **distinct ids**, so one busy session does not read as
many agents. Both exclude the `unattributed` placeholder `wb-audit` records
for events §7.4 does not attribute — counting it would invent a user and an
agent that never existed.

Only `DENY` counts as blocked. `REQUIRE_APPROVAL` and the two partial allows
are not denials and are not counted as such, though they appear in the feed.

## Reading live data

`AdminConsoleContainer` polls `wb-audit` every 4 seconds. `WbAuditService`
(§7.3) exposes `record` and `query` only, with no change notification, and
adding a second event stream here would be exactly the parallel path §6.11
forbids. A push subscription belongs on the audit seam if it is wanted — see
Known Limitations.

A missing `wbAudit` renders an empty console rather than crashing the
surrounding UI; a missing `wbPolicy` renders nothing, since the console's
whole purpose is editing policy.

## Contract additions this plugin required

All three were proposed and are recorded in `DESIGN.md` §12.

1. **`WbPolicyService.governance()` and `setRoleOverride()`** (§7.3). §6.11
   specifies editing `wb-policy`'s config surface, but the frozen interface
   exposed only `evaluate()`, so there was no write path at all.
2. **`WbCapability`, `WbPolicyMatrix`, `WbRoleOverrides` moved into §7.2.**
   They lived in `wb-policy`, and §7 forbids importing a sibling's package.
3. **`wb/policy/override-changed` (§7.4) and the `policy_override` audit
   kind** (§7.2), so a governance edit is recorded.

## Deviations

- **No "Active Agents" liveness.** The counter is distinct sessions in the
  audit log, which is every session that has ever acted, not the ones running
  now. Liveness needs a session-state read that §7.3 does not offer.
- **The user table is derived from audit entries**, not from `wb-identity`.
  `WbIdentityService.current()` is a per-session lookup with no enumeration, so
  the console can only report users it has seen act. A directory listing would
  need §7.3 to grow one.

## Known Limitations and Deferred Work

- **Polling, not subscription.** Four seconds of latency on the feed, and a
  query per tick that re-reads the JSONL log. Fine for the demo's volumes;
  a `subscribe`/`watch` on `WbAuditService` is the durable fix.
- **No pagination.** The feed caps at 50 rows and the counters read the whole
  log each tick. `query()` takes no limit or time range, so a large deployment
  needs §7.3 to grow one before this scales.
- **No component-render tests.** Coverage is on the model and the write path;
  rendering assertions need a DOM environment this package does not configure,
  matching `wb-ui`'s position.
