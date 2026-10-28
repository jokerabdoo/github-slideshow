# Tab Relay 0.3.2 review

## Changes

Replaced the configuration UI with two tab selectors, a swap control, Start Sharing, Stop Both Chats and status. Starts from an existing latest reply and chooses B if A has none. Mixed text/images/files remain automatic; no content-mode choice is exposed. Added a teal application icon.

The new page detector runs before reads. It identifies semantic assistant containers, excludes search/user-message areas, ranks composer/send controls, and locates native file inputs, filename previews and progress elements. It declines tied/ambiguous composer matches. Existing stored selector profiles are ignored by automatic operation. Stop cancels queued page-side sends and attempts to click detected generation-stop controls on the selected tabs. Additional file-host permissions can be approved with Start, which resumes the paused run.

## Evidence

Six unit tests passed. Browser fixtures exercise alternating submission and message ceiling; drafts; streaming and Stop; navigation and ambiguous delivery; repeats; rich-editor plain text; cancellation; recipient changes; non-editable/ambiguous inputs; simulated startup; duplicate Start; image-only PNG/PDF/blob transfer with byte comparisons and no binary storage; upload waiting/cancellation; human drafts during upload; disappearing files; wrong filenames; unsupported internal links; both generation-stop buttons; semantic detection ignoring search/user content; automatic starting from B with no saved configuration; and the simple popup's Start/Stop with no configuration fields.

All browser fixtures use real Chromium DOM/editors and actual extension code, with Chrome APIs simulated. This environment prohibits unpacked extensions. Native permission prompts and service-worker lifecycle have not been verified. Muse public-page retrieval returned HTTP 403, and no signed-in Muse or ChatGPT session was available. Automatic detection must still be verified against those live websites.

## Remaining limitations

This is an automatic prototype, not a production-readiness or independent security-audit claim. Recognizable DOM semantics/native upload controls are required. Private downloads, custom widgets and unnamed attachment previews can need provider-specific code updates. Unknown controls cause a pause, not a CSS setup request. Completion, upload readiness, and composer clearing are heuristics. Source contents can change during a long recipient upload. Stop cannot undo sent messages or guarantee provider cancellation. Browser access permissions remain required. Size and timeout limits are documented in INSTALL.md.

## Return-reply diagnosis update

The reported screenshot showed one A-to-B submission and a wait for B. That does not establish a single root cause: current-site permission UI does not prove the permission state of the other site, and the local ChatGPT page can differ from the standard reader layout. Version 0.3.1 checks both-site permission and adds role/turn attributes plus assistant-feedback-marked markdown reading. Copy-only/user-message controls do not qualify as an assistant reply. Role and feedback candidates are combined in document order to avoid an older semantic message hiding a newer local-style answer. Hidden feedback toolbars can identify visible response content without being clicked.

Added fixture regressions cover a denied site, a complete A-to-B-to-A round trip with a local-style response lacking author-role attributes, and a missing-reply state that reports its reason and pauses. This reproduces a possible failure shape, not a confirmed inspection of the user’s live DOM. Live ChatGPT/Muse access and provider behavior still require verification in the user’s browser.

## Permission clarification and update identification

The latest user screenshots show Chrome still loading version 0.3.0, with both selected domains listed and the automatic-access master switch on. Those screenshots do not establish missing Muse permission. Version 0.3.2 retains the tested return-reply reader and precise wait status from 0.3.1, removes the incorrect instruction to select a disabled global-access option, and displays the version in the popup footer. Installation instructions explicitly replace/remove the old loaded folder and reload both chat tabs. No claim is made that the live failure is fully diagnosed or resolved until the new reader is tested there.
