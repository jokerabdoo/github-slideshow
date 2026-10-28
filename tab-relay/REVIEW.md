# Tab Relay 0.2.1 review

Added attachment detection, bounded byte downloads, native File/DataTransfer upload staging, upload readiness checks, and media-aware completion/change/duplicate detection. Existing text protections remain.

Functional validation uses real Chromium pages and shipped code with Chrome APIs simulated. The managed browser prohibits unpacked extensions; live ChatGPT/Muse integration, native permission prompts, and service-worker lifecycle behavior are not validated.

Checks cover:

- Alternating submissions, limits, draft protection, streaming, Stop, navigation, repeat detection, uncertain delivery, page picker, rich editors, plain-text insertion, cancellation before click, changing tab/idle state, non-editable/ambiguous controls, duplicate Start, popup controls.
- A no-text reply containing an inline PNG image, a same-origin PDF, and a blob text file is downloaded and staged in the recipient. Tests compare the actual received bytes with each source.
- Upload-in-progress blocks submission, and Stop cancels the wait. Internal website links are reported as unsupported instead of dropped.
- Unit tests cover image-only completion/change detection, explicit cross-host permission, cookie-free/redirect-free cross-host fetches, oversize rejection, and login-page responses.

Attachment bytes are held in memory and not persisted in extension storage. Inline source bytes are referenced by small identifiers in stored reply metadata. Cross-site files require explicit optional host grants and are fetched without cookies; same-site reads use the source page's existing session. No browser download interception, credential extraction, backend, or telemetry is used.

The receiving site must expose a usable native file input plus verifiable upload preview/progress elements. Private download protocols, custom-only buttons, cross-origin widgets, unsupported formats, login requirements, size limits, and changing websites can prevent a transfer. Page-state readiness and composer clearing are heuristics, not proof of server-side acceptance. No independent security audit is claimed.

## Second attachment review

Found and fixed two defects: text typed during the upload wait could be overwritten, and uploaded attachments were not rechecked immediately before Send. Readiness now also requires exact preview count and matching filenames, and retained native file selections are checked for names/sizes. Browser-startup handling sets a stop flag before the queued pause.

Validation: six unit tests and 21 Chromium fixture scenarios passed. Added regressions cover human drafts during upload, attachments disappearing after initial readiness, incorrect filenames despite a correct preview count, and simulated startup ordering. Native service-worker lifecycle behavior remains unverified because the test uses simulated Chrome APIs.

Remaining material limitations: actual ChatGPT/Muse upload/download selectors are not validated; private internal download links and custom widgets may require adapters; thumbnail-only previews without filenames intentionally fail verification; completion/upload acceptance still relies on site DOM signals. A response can change after the last source snapshot while a long upload is in progress, and the current version does not monitor the other tab continuously during that upload. Use supervised short runs until those live-site flows are verified. The extension is a prototype, not a production-readiness or security-audit claim.
