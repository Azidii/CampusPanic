# Campus Map

`/map` uses the schematic catalog in `js/map-data.js`. It reuses the authenticated `/api/live` snapshot and `campus:state` / `campus:offline` events from `common.js`, including the complete `activeAlerts` array. It does not infer active emergencies from node status or the limited recent-alert list.

## Location mapping

No database migration is required. The existing `building` and `room` fields on nodes and alerts identify one room in the catalog. Matching ignores case and repeated whitespace, but does not infer locations from node names, coordinates, or room-number patterns. Catalog keys use `building-id/floor-id/room-id`, e.g. `rg-birrey/1/r201` and `rsy/2/c201`.

In **Devices / Security nodes**, Add location and Edit location use ordered **Building → Floor → Room / Location** dropdowns. Selecting a building enables only its floors; selecting a floor enables only its rooms. Changing either upstream selection clears downstream choices. The same controls are used when editing from Cameras or Incident Review. Coordinate inputs have been removed.

Mapped records open with all three selections filled. Unmapped records show their saved location and require an explicit correction; no room is guessed. The building must be `RG Birrey` or `RSY`, with these room labels:

| Building | Floor | Rooms, in diagram order |
| --- | --- | --- |
| RG Birrey | First | Main Hall; R101; R201; R301; R401; R501; R601; R701 |
| RG Birrey | Second | Main Hall (2nd Floor Faculty Room); R602 |
| RG Birrey | Third | Main Hall (3rd Floor Faculty Room) |
| RSY | First | C101–C110; separate centered row: Cafeteria; Treasury, Admissions, Registrar; Faculty |
| RSY | Second | C201–C210; separate centered row: Learning Commons; AVR; Library |

`Treasury, Admissions, Registrar` is one space. RG Birrey's `R201` is on the first floor. Do not shorten the second- and third-floor Main Hall names to `Main Hall`.

Unmatched nodes and active alerts appear under **Unmapped nodes and alerts**. Building badges include unmatched-room alerts whose building is recognized; a floor badge counts only alerts with a mapped room. Unknown-building alerts remain in the list. Existing records are not reassigned automatically. Alerts use their own recorded location, so editing or deleting a node does not relocate or hide an incident.

The authenticated node POST/PUT API requires `name`, `building`, `floor` and `room`. `floor` is the catalog string ID (`"1"`, `"2"`, or `"3"`); `room` is the canonical room label. The server validates the complete combination against `js/map-data.js`, which is shared with the Map and form. Floor is derived from the existing building/room fields when reading saved records, so no additional database field is necessary. Existing coordinates remain stored for legacy consumers, but these endpoints no longer accept coordinate edits; new nodes receive the model's null coordinate defaults.

## Emergency and connection state

The existing lifecycle is authoritative: any alert whose `status` is not `resolved` remains active, including acknowledged and old incidents. The existing Resolve action clears indicators on the next successful snapshot. There is no map-specific alert timeout.

Online means the existing service reports `video.cameraConnected` or `audio.connected`. Offline means a configured camera or paired ESP32 is explicitly reported disconnected. Unknown means that evidence is unavailable, including interrupted updates. A database `online` or `active` string alone is not proof of connectivity. Last-seen times come from the existing node / ESP32 data; unavailable timestamps are labeled.

The freshness watchdog marks display data disconnected after 12 seconds without a complete snapshot. This changes connection markers to Unknown and retains all last-known emergencies; it is not a new heartbeat or incident expiration rule. Failed or incomplete requests retain the previous snapshot and expose Retry.

**View live feed** opens `/cam-view?nodeId=...` through the existing authenticated route, only when that node has configured, connected, fresh video. Otherwise the action is disabled and explains why. It never selects another node's feed.

## Verification

`tests/map.test.mjs` uses `tests/fixtures/map.mjs`, which production code never imports. `tests/node-listing.test.mjs` also exercises the real authenticated snapshot and Resolve API using disposable MongoDB. Existing security/theme tests cover the schematic route and the retained Leaflet threat-map route.

Run focused checks from `DSP-Website`:

```sh
node --test tests/map.test.mjs tests/node-listing.test.mjs tests/theme-ui.test.mjs tests/client-scripts.test.mjs tests/security-hardening.test.mjs
```

For a local fixture-only preview, run `node tests/map-preview.mjs`, then open `http://127.0.0.1:5129/map`. This preview binds only to loopback, labels its synthetic data, and does not connect to a campus database. Never run it as the production server.

No dependencies were added. Leaflet stays available for the separate Active Threats map, which still uses it; `/map` does not load Leaflet or external tiles. Existing coordinates are preserved.
