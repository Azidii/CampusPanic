# Dashboard and database maintenance

The dashboard shows every matching open incident without a fixed record cap. Its
resolved history is a separate, collapsible, paginated list of ten incidents.
Totals cover the selected building across all history, including cleared records.
Type, open-status and literal text search combine with the building filter.
The URL preserves the selection during polling and refresh. Notifications remain
campus-wide, and the dashboard reports how many open incidents are outside its scope.

**Clear resolved** adds the authenticated user's ID to private incident display
state. It cannot hide an unresolved incident or affect another operator. **Show
cleared** includes those resolved records again. Incident links continue to work.
Building filters are display controls, not access permissions.

New or edited nodes require a trimmed, nonempty, globally unique name and one of
`RSY` / `RG Birrey`. A normalized name key has a database unique index, installed
and verified before startup accepts requests. Startup refuses an unresolved name
inventory rather than deleting or renaming old nodes. Existing unsupported building
values remain visible under All buildings and need an explicit correction when edited.
Camera views use current node metadata; historical incidents keep their recorded
building and room. A map pin is not placed at a node's new location for an old
incident with a different recorded building or room. Never invent coordinates.

## Alert reset

Only an active administrator can preview or delete all alerts. Settings displays
the current count and requires `DELETE ALL ALERTS`. The server binds a short-lived
confirmation to that administrator and the incident fingerprint; changed data
requires a new preview. Same-origin checks, restrictive CORS, a custom action
header and JSON input protect the cookie-authenticated deletion route.

Snapshots are removed before their records. A failed deletion retains its incident
reference and is reported as a partial reset (HTTP 207). Retention follows the same
rule and skips referenced files during orphan cleanup. Missing files are treated
as already removed. Review failed incident IDs and retry after correcting filesystem
permissions. Users, nodes, cameras, ESP32 devices, pairings and configuration survive.
Nodes without remaining incidents return to an offline baseline; live connections
are projected from fresh camera sessions and ESP32 heartbeats. Detection keys are
removed with their incidents. Continuing detections may create new incidents.

The `maintenance` collection coordinates ingestion, detection, retention and reset
across gateway processes. A reset refuses to start while a writer is active; writers
refuse while it holds the reset guard. This is deliberately fail-closed after a
process crash. For recovery, stop **all** gateway/device writers, verify no operation
is still running, inspect `maintenance._id = "alerts"`, then clear only its stale
`writers` array and set `resetting` to false. Restart the gateway afterwards. Never
clear a guard while a writer may still be running.

## Consolidation into mainDB

No seed command is part of migration. `seed.js` refuses ordinary databases and
requires an explicitly isolated `campuspanic_*_seed` database under NODE_ENV=test.
New installations and pathless URIs default to mainDB; test suites use disposable
MongoDB processes with explicitly named isolated databases.

`scripts/consolidate-main-db.mjs` has three maintenance phases. The private backup
directory is outside the repository and must be retained after migration. It contains
credential-bearing BSON records; never commit or publish it.

1. Stop the website and all its model/device writers, including any watchers that
   could restart it. Verify its listening port is closed.
2. Run `node scripts/consolidate-main-db.mjs prepare PRIVATE_BACKUP_DIRECTORY`.
   This inventories every collection in test, campuspanic and mainDB; writes BSON
   data, indexes and collection settings; verifies checksums; restores each archive
   into an isolated local MongoDB; and verifies the proposed merged database there.
   Review `dry-run.ejson`. Existing mainDB collections block writing until reviewed.
3. Resolve all conflicts before `copy`. The agreed policy for this migration is to
   retain test user accounts on conflicts. The unique campuspanic account is added;
   its conflicting account is retained unchanged in `migration_user_conflicts`,
   outside the active users collection. Other ID, unique-key, index or setting
   conflicts fail preflight. No historical building mappings or node renames are assumed.
4. Run `node scripts/consolidate-main-db.mjs copy PRIVATE_BACKUP_DIRECTORY`.
   The script rechecks frozen source contents, restores the merged mainDB into an
   empty destination, and checks every document, index and setting. Both sources remain.
5. Back up the existing `.env` privately. Change only MONGODB_URI's database path to
   `/mainDB`, preserving credentials, connection options and every unrelated key.
   Start the website. Verify login, incident history, node/camera pages and ESP32
   records; verify `unique_node_name` is installed. No real incident reset is needed.
6. Record the actual application checks in `application-verified.json` in the private
   backup directory: deployment, database (`mainDB`), login, views, pairingRecords
   and nameConstraint. Only set each boolean after the corresponding check succeeds.
7. Only then run `node scripts/consolidate-main-db.mjs cleanup PRIVATE_BACKUP_DIRECTORY`.
   It rechecks the exact deployment, named target, unchanged sources, complete target,
   expected new maintenance state and additional application indexes. It can delete
   only test and campuspanic. It verifies their removal and writes `completed.ejson`.

On any failure, retain the sources and backups. Do not run cleanup. Restore a backup
with the exported `readBackup`, `restore` and `verify` functions into an **empty**
isolated database before selecting it as an application recovery target. Never
overwrite a nonempty destination. If copying failed halfway, inspect the partial
mainDB before retrying; the script will refuse to overwrite it.

The BSON format uses the installed MongoDB driver's serializer. Collection metadata
uses [canonical Extended JSON](https://www.mongodb.com/docs/drivers/node/current/data-formats/extended-json/)
to preserve BSON types. The archive self-test covers 64-bit integers, doubles, binary
data, empty collections, validation settings, collation and unique partial indexes.

Automated website tests exercise isolated databases and virtual devices. They do
not establish real-phone behavior, physical ESP32 operation or model accuracy.
