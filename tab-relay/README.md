# Tab Relay 0.2.1

A Chrome 120+ / Chromium Manifest V3 extension that relays assistant replies between two chat tabs in your own browser: **text, images, and downloadable file attachments**, including replies with no text. It uses your signed-in website sessions, with no API key or extra server.

This is a first version with ChatGPT text-control presets and configurable controls for Muse or another chat site. Live ChatGPT/Muse attachment integration has not been verified. Websites with private download protocols or custom upload widgets may need a site-specific adapter.

## Install

1. Extract `tab-relay-extension.zip`.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, and click **Load unpacked**.
3. Select the extracted **tab-relay-extension** folder containing `manifest.json`.
4. Pin **Tab Relay** from the browser Extensions menu. For an existing installation, replace its files and click **Reload** on the Extensions page, then reload the two chat tabs.

Install this in your own browser. This cloud workspace cannot connect to your personal tabs or install it remotely. Managed browsers may block unpacked extensions.

## Connect two chats

1. Open dedicated ChatGPT and Muse conversations in the same browser profile. Sign in yourself.
2. Choose **Tab A** and **Tab B** in Tab Relay, then **Allow selected sites**.
3. Configure each tab. ChatGPT has text presets; other sites require page controls.
4. Test read access on both tabs. Verify that the latest reply sample includes the correct assistant text and lists its images/files.

Controls are CSS selectors, saved per site origin. **Pick on page** lets you select a visible element, then reopen the extension to continue. Select repeated assistant-only containers that also match future replies, rather than one paragraph or one historical message. CSS is editable when a picker result is too broad or too narrow.

| Control | What it selects |
| --- | --- |
| Message box | Exactly one editable text composer. |
| Assistant replies | Repeated containers for assistant replies, including the images/file links inside them. |
| Send button | Exactly one enabled submission button. |
| Stop button | The stop-generating button while a reply is streaming. Strongly recommended. |
| Reply images / download links | Optional selector **inside** the latest reply. Blank uses automatic detection. Can select `img`, `a[href]`, and `svg` elements. |
| File-upload input | The receiving site's actual `input[type="file"]`. Usually hidden, so enter CSS. The default works only if exactly one such input exists. |
| Completed upload previews | One preview/chip per attached file after the website stages it in the composer. Required to relay images/files. Pick a repeated per-file container. |
| Upload-progress indicator | Visible indicator while a file is uploading. Required to relay images/files. Configure it while an upload is in progress; it should disappear when ready. |

Website upload controls are not standardized. Both completed-preview and upload-progress selectors must be configured on each receiving site. The extension waits for the exact preview count, matching filenames in preview text/accessibility labels, no progress indicators, and a 1.5-second quiet period before inserting text and checking Send. Preview selectors must include a visible or accessible filename for every file. Sites with unnamed thumbnails need an adapter. Immediately before Send the files are checked again. Text typed by you during the upload wait is preserved and stops the submission. Incorrect selectors can still misidentify readiness; verify them with a small file first. This is page-state confirmation, not a server-side receipt.

## Images and file transfer

- Images and downloadable files are transferred as **actual file bytes**, not just link text. Text accompanying the reply is sent in the same message. Image-only and file-only replies are supported.
- Automatic detection includes visible images around 96 pixels or larger, large inline SVG diagrams, download links, and links whose URL or visible label has a recognized file extension. Tiny icons are skipped. Image bytes come from the displayed source unless an explicit download link is available; that source may be a preview rather than the original resolution. The optional attachment selector can narrow or override this detection.
- Supported sources: accessible same-site HTTP(S) file URLs, `blob:` files, and inline/data images/files. Same-site reads use that page's existing authentication.
- Cross-site/CDN files require **Check attachments**, then **Allow file hosts**. This grants permission only to the displayed hosts. The extension fetches those files without cookies or HTTP credentials. Signed URLs can work; third-party files requiring cookie login may not. New hosts appearing later pause the run until permitted.
- Limits: **5 attachments per reply, 10 MB per file, 20 MB total**. Over-limit replies pause instead of being truncated. Each download has a 20-second timeout; upload readiness has a 60-second timeout.
- File bytes are held temporarily in memory during transfer. They are not written to extension storage or your Downloads folder. Settings, current reply metadata/text, and a short activity log are stored locally; duplicate history is hashed. Remove the extension or clear its storage to erase retained state.
- A failed download, failed image, login-page response, unsupported private link such as `sandbox:/...`, unresolvable custom download button, or unavailable uploader pauses the relay. It does **not** silently send only the text. Some downloads need an adapter for that website.
- It does not execute relayed files. The receiving site decides which file formats and sizes it accepts. Canvas-only images, closed shadow roots, cross-origin upload frames, and file-picker-only widgets may require an adapter. Attachments cannot be promised on every website.

## Run a conversation

Give an **Opening message**, or select **Start with tab A's latest assistant reply** to relay the latest existing answer, images, and files first. Choose a small **Message limit**, then **Start relay**.

The opening message counts toward the limit. Every A → B or B → A submission counts as one message, including all of that reply's attachments.

The extension waits for a new reply, no busy signal, loaded images, and at least eight seconds of unchanged text/attachment metadata. It reads attachments, verifies the source is still the same, stages files in the recipient, waits for upload readiness, and sends once. Text may continue to stream after a long quiet gap if the stop selector is absent or wrong: completion remains a heuristic.

Checks run roughly every two seconds while the popup is open and every thirty seconds after it closes. Sleeping/discarded tabs or a sleeping computer delay this. Closing the popup does **not** stop the relay. Press **Stop** to stop future sends; it cannot undo a submission already clicked, cancel a website's generation, or guarantee cancellation of an upload already started. Unsent drafts/files may remain after a stop or error: inspect and clear them yourself before restarting.

The relay pauses on drafts or pre-existing attached files, navigation, repeated replies, unsupported attachments, missing controls, uncertain delivery, or a ten-minute response timeout. It never retries an uncertain submission automatically. Use stable existing conversation URLs; if sending the first message creates a new URL, let it finish and restart using the latest reply on that URL. Closing/reopening the browser pauses the relay.

## Permissions and sharing

`tabs` lists tab titles/URLs; `scripting` runs the selected-tab adapters; `storage` retains settings/state; `alarms` schedules background checks. Website access is optional and requested for selected sites and any explicitly approved file hosts. Content from the chosen chats is deliberately shared with the other chosen chat service and may consume your account's message/upload limits. There is no extension backend, analytics, remote code loading, or credential API.

The extension is a two-tab chat relay, not native ChatGPT work mode or a general browser-control tool.

## Development and tests

No build step or runtime package dependencies are needed. Load `extension/` directly.

```sh
npm test
npm run test:browser
```

Browser tests need Playwright in Node's module search path and Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`). They run real Chromium DOM/editors with the shipped background and page code, using simulated Chrome APIs because this managed browser blocks unpacked extensions. Tests include actual PNG/PDF/blob-file byte transfer, file-only replies, upload waiting/cancellation, and unsupported-file reporting, as well as the text relay protections. Native extension loading, permission prompts, service-worker lifecycle behavior, and actual ChatGPT/Muse integration remain unverified here.
