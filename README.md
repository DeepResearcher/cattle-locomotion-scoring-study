# Cattle Locomotion Scoring

Invitation-only video assessment interface, with German as the default and English available from the language selector. The public repository contains application code only. Video files, participant codes, source mappings, existing clinical scores and collected ratings must never enter this repository.

## Architecture

- GitHub Pages: static interface.
- Cloudflare Worker: access control, scoped participant sessions and central rating API.
- Private R2 bucket: video and poster files. No public bucket URL.
- D1 database: pseudonymous participants, current ratings and revision history.
- Server-checked common study code with a separate browser participant key; no password embedded in browser JavaScript.

Invited raters see anonymous recordings in a participant-specific, reproducible random order. They cannot see cow IDs, source filenames, existing clinical scores, model predictions or another participant's scores. LCS choices are 1 through 5, with a separate unable-to-score option. An unavailable or unsuitable recording must not force a clinical score.

Language preference is retained on the device. Switching languages updates the labels without recreating the video or clearing an unsaved score, notes or consent fields. Stored role, confidence and reason values remain in their existing canonical format regardless of the interface language.

Selecting a valid LCS enables saving immediately. Playback time remains part of the rating record, but no minimum playback percentage is enforced. The earlier silent 80-percent playback gate was removed on 22 October 2026. An unable-to-score response still requires a reason, and a successful server acknowledgement remains necessary before advancing.

## Local Preview

```powershell
npm ci
node tools/admin.mjs init
npm run api:local
# In another terminal:
npm run dev
# Once the API is ready:
node tools/admin.mjs invite 1 --test
```

Open http://127.0.0.1:5178/. The preview access code is written outside the repository, to `../private/invitations-preview.local.json`. The local preview imports only verified exported clips. It never uploads them. Its SQLite data and media copies remain outside this repository.

```powershell
npm test
npm run build
```

## Production

Use the `cf` CLI with `backend/cloudflare.config.ts`. The R2 service must first be enabled by the account owner. An EU-jurisdiction D1 database has been allocated; the intended private R2 bucket is also EU-jurisdiction.

Production is hosted in Serhan's Cloudflare account. The local `posemetric` auth profile is bound to this project in addition to its existing bindings. Confirm the account with `cf auth whoami` before deployment. The default login belongs to a different account and must not be used for this study. Explicit deployment commands may use `--profile posemetric`.

The production API is `https://paper3-lcs-rating-api.serhan-narli.workers.dev`. The earlier `aaaf-ev` deployment is not the active study. Video uploads use an explicit account and an account-specific hash ledger so a completed upload in another account cannot be mistaken for this account's inventory.

`STUDY_OPEN` defaults to false. Do not open recruitment until the entire manifest, all media, permissions, study information and browser playback have been checked. `LCS_WITH_MEDIA=true` binds the private bucket; `LCS_STUDY_OPEN=true` opens participant access at deployment. Never open the study with a partial or changed manifest.

Credentials are generated in `../private/server_credentials.local.json`; deploy these as Worker secrets, not environment variables embedded in the frontend. The backend and frontend have separate builds.

Once deployed, set `LCS_API_URL` in the GitHub repository Actions variables to the HTTPS Worker origin. GitHub Actions publishes only `dist/`.

After R2 activation, create the private EU bucket and upload the final verified web copies with `tools/upload-media.ps1 -SharingPermissionConfirmed`. This tool uses the `cf` CLI and records uploaded hashes privately. It does not enable public R2 access. The frontend Content Security Policy must match the API origin if deployment moves to another account or domain.

## Administration

Open `/admin.html` for the German/English results page. Owner access details are generated outside this repository by `node tools/prepare-admin-access.mjs`, in `../private/Admin_Access.local.json`. The participant code cannot access results. The administrator key is exchanged for a one-hour read-only token, kept only in page memory; signing out or reloading requires signing in again. No credentials are placed in URLs or browser storage.

The page shows participant progress, submitted ratings (including unable-to-score responses), completed assessments and coverage per clip. CSV and JSON downloads follow the current participant filter. Test participants, ratings and revision history are excluded by default. The explicit test-data checkbox includes them and marks the download filename accordingly. JSON also preserves revision history; CSV has one row per current participant/clip assessment, not one row per revision. Participant counts are browser enrolments, not verified unique people; clip counts must not be interpreted as cow counts. No accuracy or agreement statistic is inferred without a clinical reference and the private cow/clip mapping. Refresh retrieves the latest central records without modifying them.

Set `LCS_API_URL` in your local shell to the deployed API origin before these commands. Without it, administration targets the local preview, not production.

```powershell
node tools/admin.mjs seed
node tools/admin.mjs invite 12
node tools/admin.mjs export
node tools/admin.mjs revoke <participant-id>
```

Run `node tools/admin.mjs shared-code` once to prepare the common study code in `../private/Shared_Study_Access.local.json`. Share that code only with authorised raters. Each browser retains a separate random participant key: the common code does not merge ratings. Use the same browser to resume; another device or cleared browser storage creates another participant. On a shared device, choose "New participant" before a different person scores. This loses that browser's previous participant access, not the centrally saved ratings. A shared code cannot establish a unique real-world person or prevent duplicate enrolment. Revoking one participant does not stop that person enrolling again with a new browser key and the still-valid common code. Individual invitations and the separate owner preview code remain supported. Never share the administrator secret. Preview ratings are test data and excluded from research CSV exports.

## Study Interpretation

The clips include the previously selected kinematic intervals. The seven intervals shorter than one second are expanded to approximately five seconds of actual surrounding footage for human rating; the analysis intervals and measurements remain unchanged. This viewing context is mapped separately in `Rating_Clip_Source_Mapping.csv`. Some contexts overlap within the same source video and must not be treated as independent observations. The five-point guide adapts the reference for walking clips; standing posture may be unavailable. Review the study protocol with the clinical team before recruitment. Preserve unscorable responses and reasons instead of excluding them silently. Repeated clips from the same cow are correlated; subsequent agreement analyses must retain the private cow/clip mapping and account for clustering. These new ratings do not by themselves make the reference perfectly objective.

Authentication limits access but cannot prevent an authorised participant from screen recording or redistributing a clip. Retain data-owner permission and give access only to authorised raters.

## Sources

- [Cornell locomotion scoring reference](https://www.vet.cornell.edu/animal-health-diagnostic-center/programs/nyschap/modules-documents/locomotion-scoring-management-tool)
- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Cloudflare programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
