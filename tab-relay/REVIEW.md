# Tab Relay 0.3.0 review

## Changes

Replaced the configuration UI with two tab selectors, a swap control, Start Sharing, Stop Both Chats and status. Starts from an existing latest reply and chooses B if A has none. Mixed text/images/files remain automatic; no content-mode choice is exposed. Added a teal application icon.

The new page detector runs before reads. It identifies semantic assistant containers, excludes search/user-message areas, ranks composer/send controls, and locates native file inputs, filename previews and progress elements. It declines tied/ambiguous composer matches. Existing stored selector profiles are ignored by automatic operation. Stop cancels queued page-side sends and attempts to click detected generation-stop controls on the selected tabs. Additional file-host permissions can be approved with Start, which resumes the paused run.

## Evidence

Six unit tests passed. Browser fixtures exercise alternating submission and message ceiling; drafts; streaming and Stop; navigation and ambiguous delivery; repeats; rich-editor plain text; cancellation; recipient changes; non-editable/ambiguous inputs; simulated startup; duplicate Start; image-only PNG/PDF/blob transfer with byte comparisons and no binary storage; upload waiting/cancellation; human drafts during upload; disappearing files; wrong filenames; unsupported internal links; both generation-stop buttons; semantic detection ignoring search/user content; automatic starting from B with no saved configuration; and the simple popup's Start/Stop with no configuration fields.

All browser fixtures use real Chromium DOM/editors and actual extension code, with Chrome APIs simulated. This environment prohibits unpacked extensions. Native permission prompts and service-worker lifecycle have not been verified. Muse public-page retrieval returned HTTP 403, and no signed-in Muse or ChatGPT session was available. Automatic detection must still be verified against those live websites.

## Remaining limitations

This is an automatic prototype, not a production-readiness or independent security-audit claim. Recognizable DOM semantics/native upload controls are required. Private downloads, custom widgets and unnamed attachment previews can need provider-specific code updates. Unknown controls cause a pause, not a CSS setup request. Completion, upload readiness, and composer clearing are heuristics. Source contents can change during a long recipient upload. Stop cannot undo sent messages or guarantee provider cancellation. Browser access permissions remain required. Size and timeout limits are documented in INSTALL.md.
