# Local security and interface review

Reviewed 4 November 2026. This records specific checks; it is not a guarantee of security or a public deployment approval.

The website is a server-rendered Express/EJS application with MongoDB and custom JWT sessions, plus private Python inference workers. It uses server-side authorization (the server lane, with Python worker services); it is not a browser-to-Firebase/Supabase application. Before this review the data inventory was absent (Stage 0 incomplete); the application had feature-level tests (Stage 4) and is being prepared for source publication (Stage 5). No public deployment was supplied or tested.

## Findings addressed

| ID | Verified path | Change |
| --- | --- | --- |
| AUTHZ-11 | Anonymous requests could fetch incident files under `/uploads` | Require an active authenticated account and send private, no-store cache headers. |
| INJECT-10 | Reflected browser origins with credentialed CORS | Exact same-origin/configured-client matching; reject foreign browser-origin mutations. Native authenticated devices can continue sending requests without an Origin header. |
| UPLOAD-01 | Base64 data URLs could select an active image format such as SVG; file extensions/MIME were trusted | Bound decoded image sizes, accept raster signatures only, choose the server-side extension, and validate both multipart and base64 inputs. |
| INFRA-09 | Content Security Policy disabled | Enable a self-only script policy, disallow inline handlers and embedded objects, self-host fonts, preserve required inline styles and blob video. |
| AUTH-01 | Login shared the generous general API quota | Add a separate failed-login quota. |
| SUPPLY-01 | Outdated upload/dependency tree and unused native bcrypt | Upgrade Multer and EJS, refresh patched transitive dependencies, retain bcryptjs, disable dependency install scripts. `npm audit` reported zero advisories on the final lockfile. |
| INPUT-01 | Unbounded alert list parameters and implicit acknowledgement of unknown actions | Validate pagination and supported incident actions. |
| REPO-01 | Root upload ignore paths missed the actual runtime directory | Ignore runtime snapshots, private tooling configs, key stores and generated Android packages. Existing model files over 100 MB are already represented by Git LFS pointers. |

The response spread in `phoneRoutes.js` flagged by the static scanner is a response object, not an unvalidated database write. npm cache entries flagged as logging are excluded local review artifacts. Neither is an application exploit. Gitleaks flagged one historical audio-test fixture; its exact fingerprint is documented in `.gitleaksignore`, without suppressing the test directory.

## Validation

- Admin/operator/anonymous HTTP tests verify node mutation boundaries, incident image access, CSP/CORS, cache policy, pagination and retired map redirects.
- Existing gateway, pairing, camera/HUD, real video model and database tests were run against isolated databases. Node save success/error and notification tests cover the UI regressions.
- Real-browser tests against both a UI fixture and the actual Express app verify node saving and the affected-node notification link. Nine screens were checked at 1440, 768 and 390 pixels with no page overflow or JavaScript exceptions.
- Taste inspector: original dashboard 8 failures / 3 warnings; final dashboard and node setup 0 failures / 0 warnings. Notifications have no failures; sparse genuine data leaves an intentional empty area, reported as a visual warning.
- Browser assets were scanned with the bundled security scanner. Git history was scanned with Gitleaks, with a separate comparison of five currently configured sensitive values against 268 historical source blobs; no current value matched.

## Before a GitHub push

Run `git status --short`, `git diff --check`, `git lfs fsck`, `npm ci --prefix DSP-Website --ignore-scripts`, and `npm audit --prefix DSP-Website`. Review the staged diff. Local `.env` files, uploads, virtual environments and generated app binaries must remain untracked. Keep Git LFS enabled when publishing the model checkpoints. No commit, history rewrite or push was performed by this review.

For a clean laptop, copy `DSP-Website/.env.example` to `.env` and fill independent random secrets. Preserve an existing `.env`. For HTTPS reverse proxies, set `NODE_ENV=production` and `CLIENT_URL` to the exact public origin; the console's browser-origin protections depend on that configuration.

## Not verified

- Audio inference integration: the original laptop has no prepared audio Python environment with TensorFlow. Run `Audio-Live/Setup-Audio.ps1`, then `npm run test:audio --prefix DSP-Website` before relying on audio detection. The audio worker/model code was not changed.
- Physical ESP32 buttons, smoke sensors, phone camera hardware and alarm audibility.
- Public TLS, reverse-proxy configuration, deployment exposure, database account/network permissions, backups, GitHub MFA/push protection, LFS upload quotas, or a live incident response exercise.
- Complete Python/Android transitive dependency advisory audits; dependency update manifests were added, but those runtime environments were not upgraded.
- Separate tenant/building isolation: this application's current policy is a shared campus operator console. `assignedBuilding` is profile metadata, not an access boundary.

Use the campus LAN for device traffic until a deployment-specific HTTPS and device-transport review is complete.
