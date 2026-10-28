# Tab Relay 0.3.2 — Automatic sharing

Choose two chat tabs, click **Start Sharing**, and click **Stop Both Chats** when finished. There are no configuration fields, opening-prompt boxes, reply-type switches, or manual attachment selectors.

## Install or update

1. Extract `TabRelay-v0.3.2.zip`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the newly extracted `tab-relay-extension` folder containing `manifest.json`.
4. To avoid loading the old 0.3.0 folder again, remove the previous Tab Relay entry before loading this new folder. Alternatively replace the contents of the exact folder Chrome lists under “Loaded from”, then click Reload. Confirm version **0.3.2** in Chrome Details and the popup footer. Reload both chat tabs so their page adapters update.
5. Pin Tab Relay using Chrome's puzzle-piece menu.

Requires Chrome/Chromium 120+. The browser may require you to approve access to the two sites. This is a browser permission, not extension configuration.

## Site access and return-reply fix

Chrome must allow access to both selected sites. Click Start Sharing and approve access to the selected domains when Chrome asks. In Chrome Details → Site access, both `chatgpt.com` and `muse.ai` should be listed. If “Automatically allow access on the following sites” is on, individual site switches can be grey because the master setting controls them; grey alone is not proof that access is denied. “On all sites” can be disabled because broad hosts are optional and the extension requests only selected domains. You do not need that global option to relay between two allowed sites. The extension now names the missing site or reports a page-reading problem separately.

Versions 0.3.1 and 0.3.2 recognize assistant feedback controls around markdown output on ChatGPT local-style pages when the normal assistant-role marker is absent. The status distinguishes generating, loading images, waiting for a new reply, and a reply that could not be detected. Missing-reply detection pauses after 30 seconds idle rather than silently showing a successful-looking sharing status.

## Use

1. Open ChatGPT and Muse in the same browser profile and sign in yourself.
2. Select the two tabs. Muse and ChatGPT are preselected when recognizable tabs are available. The small arrows swap their order.
3. Click **Start Sharing**. It uses Chat A's latest assistant reply, or Chat B's if only B has a reply. If the first reply is still generating, it waits.
4. Replies continue alternating automatically. Text, images and files are detected together, including replies with no text. You do not choose a mode or select every attachment.
5. Click **Stop Both Chats** to cancel future relay submissions and attempt to click both websites' generation-stop controls. The status reports whether stop controls were found. This cannot undo a sent message or guarantee cancellation of a provider's upload/generation.

Use dedicated conversations and keep their message boxes empty. A draft or pre-existing attachment pauses the relay. Typing while an upload is in progress is preserved instead of overwritten.

An internal ceiling pauses each run after 100 submissions. Replies must settle for eight seconds before relay; popup checks run about every two seconds and background alarm checks about every thirty seconds. The popup can close without stopping sharing. Stop it explicitly before leaving. Sleeping/discarded tabs or a sleeping computer delay checks. Browser startup pauses an existing run.

## Automatic detection

A site-aware adapter recognizes ChatGPT's established message attributes and searches Muse/other chat pages for assistant-role containers, semantic message boxes, forms, labelled Send/Stop buttons, native file inputs, filename previews, and upload indicators. Detection refreshes at each page read to accommodate rerendering. Search boxes and user messages are excluded; ambiguous controls stop the run rather than being guessed.

Saved selector configuration from older versions is not used by the new automatic flow. There is no setup screen. If a website does not expose recognizable controls, the extension reports that it cannot identify them automatically. A code adapter update may be needed; the user is not asked to write CSS.

**Live ChatGPT/Muse compatibility is not guaranteed.** The environment could not inspect Muse's public page (HTTP 403), and cannot access your signed-in browser tabs. This release is validated against local browser fixtures, including a semantic chat layout and a mixed-file conversation. Actual Muse and ChatGPT layouts still need a supervised live run.

## Images and files

- Transfers actual accessible file bytes with the text from that reply, not just pasted links.
- Automatically detects visible images roughly 96px or larger, large SVG diagrams, download links, and recognized file-extension links. Small icons are ignored. Displayed images may be previews rather than full-resolution originals.
- Reads same-site authenticated file URLs, blob files and inline/data images. Cross-site/CDN files require an optional permission for the file host. If needed, sharing pauses; click **Start Sharing** again to approve that host and continue the same run.
- External file requests omit cookies and do not follow redirects. Files requiring third-party authentication, redirects, internal `sandbox:` links or custom-only download buttons can require a site adapter.
- Uploads through the site's native file input, and waits for matching filenames in previews and no recognized progress indicator before submitting. Controls are checked again before Send.
- Limits: 5 files per reply, 10 MB each, 20 MB total; 20-second download and 60-second upload-readiness timeouts. Over-limit or inaccessible files pause the whole reply rather than silently dropping attachments.
- Files are held temporarily in memory, not saved to your Downloads folder or extension storage. They are not executed by the extension.

Some custom upload widgets, canvas-only images, unnamed thumbnails, closed shadow roots and cross-origin frames are not supported automatically. Source replies are not continuously monitored while a long recipient upload runs; completion/readiness and composer clearing are page-state heuristics, not server-side receipts. Unsupported files or changing URLs pause the relay. Inspect both chats before restarting after uncertain delivery; the extension never retries such a send automatically.

## Permissions and privacy

`tabs` lists tab titles/URLs; `scripting` runs the selected-tab adapters; `storage` retains local settings/reply state; `alarms` schedules checks. Optional site access is requested for selected sites and approved file hosts. No backend, telemetry, remote script loading or credential API is used. Relayed content is deliberately sent to the two chat services and consumes their normal account limits. Remove the extension or clear its local storage to delete retained relay state.

## Development

No build step or runtime package dependencies. Load `extension/` directly.

```sh
npm test
npm run test:browser
```

The browser test requires Playwright in Node's module search path and Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`). It uses real Chromium pages and shipped detector/page/background code with simulated Chrome APIs because this managed browser prohibits unpacked extensions. Native permission prompts, actual service-worker lifecycle, and real ChatGPT/Muse integration are not validated by those tests.
