# Stepsmith — Chrome Web Store submission pack

Paste each item into the Developer Dashboard. The store title is the manifest
`name` and the short description is the manifest `description`; the API cannot
edit listing text, screenshots or the privacy form.

## Name (≤75)
`Stepsmith: Step-by-Step Guide Maker`

## Short description (≤132, equals the manifest description)
`Record the steps you take on a website and turn them into a step-by-step guide with screenshots, kept on your device.`

## Category
Productivity → Tools

## Detailed description
```
Stepsmith turns a task you do in the browser into a step-by-step guide with screenshots, and keeps the guide on your device.

HOW IT WORKS
1. Open the website you want to document and click "Record this tab".
2. Do the task as you normally would. Each click becomes a step with a screenshot, the clicked spot highlighted, and a caption such as "Click Save".
3. Press Stop, tidy the captions, reorder or delete steps, and export.

PRIVATE BY DESIGN
• Guides and screenshots are stored in your browser. They are never uploaded.
• The free version makes no network requests. Buying Pro opens ExtensionPay's checkout, and that is the only time Stepsmith contacts a server.
• What you type is never saved: a step says "Type in Email", not what you typed.
• Password, one-time-code and card fields are never read and are blurred in screenshots automatically.
• Stepsmith only touches the one tab you record, and only while you record. No analytics, no ads, no account.

FREE
• Record across page loads in a tab
• A screenshot per step with the clicked spot highlighted
• Automatic captions you can edit
• Reorder, delete, and add text-only steps
• Unlimited guides, stored on your device
• Export a single self-contained HTML file
• Copy the steps as Markdown

PRO (one-time unlock, no subscription)
• Export to PDF, generated on your device
• Redact and annotate screenshots: blur, black out, box, arrow, text, crop
• Automatic blurring of email addresses and long numbers in text fields
• Your logo, accent colour and footer on exports
• Markdown export as a .zip with the image files

WHO IT IS FOR
Support and IT staff, trainers, people writing SOPs and onboarding docs, QA testers writing bug-reproduction steps, and freelancers documenting work for clients.

PERMISSIONS
Stepsmith asks for access to websites once, with Chrome's own prompt, the first time you start a recording. It is needed to keep recording after a click opens a new page and to take the screenshots. Without it nothing is recorded.

LIMITS
Browser pages (chrome://), the Chrome Web Store and the built-in PDF viewer cannot be recorded. Clicks inside embedded frames are not captured yet. If a click navigates away before the screenshot is read back, that step is kept without an image.
```

## Single purpose
Record the steps a user takes on a website and turn them into a step-by-step guide with screenshots, kept on the user's device.

## Permission justifications (each ≤1,000)

**storage**
Keeps the user's Pro unlock status, their export branding choices (accent colour, footer, logo) and the state of a recording in progress (in memory-only session storage). Guides and screenshots themselves are kept in IndexedDB, which needs no permission.

**scripting**
Injects the step recorder (a bundled file, no remote code) into the single tab the user chose to record, using chrome.scripting.executeScript. The recorder reports the visible label of what was clicked and the name of fields typed into. It is re-injected after that tab loads a new page. It is never injected anywhere else and is not declared as a content script.

**Host access: optional `<all_urls>` (optional_host_permissions)**
Requested only when the user starts their first recording, from Stepsmith's own page, through Chrome's permission prompt. It is needed for two things on the recorded tab only: re-attaching the recorder after a click opens a new page or origin (activeTab expires on navigation), and capturing a screenshot of the tab with tabs.captureVisibleTab. The sites a user records cannot be known in advance, so a narrower pattern is not possible. If the user declines, nothing is recorded. Nothing read this way is transmitted.

**Content script on https://extensionpay.com/\* (declared host match)**
ExtensionPay's bundled script runs only on extensionpay.com pages, so the extension learns that a Pro purchase completed. It is the only declared content script. It never runs on any other site.

## Remote code
No, all code is bundled. ExtPay.js ships unmodified inside the package and is never fetched at runtime.

## Privacy practices form
- Single-purpose, permission and remote-code answers: as above.
- Data handled: guides contain screenshots and the visible labels of what the user clicked, so the form should declare **Website content** and **User activity (clicks)** as handled. Answer that this data is processed and stored locally on the device only, is not transmitted, sold or shared, and is not used for anything beyond the single purpose. (Nothing leaves the device, so you may judge that "collected" does not apply; declaring it is the cautious choice. Maintainer's call, this is a judgement about the form's wording.) Payment details and email go to ExtensionPay/Stripe on their own pages, not through the extension.
- Tick all three certifications: no sale of user data to third parties, no use unrelated to the single purpose, no use for creditworthiness or lending.

## Links
- Privacy policy: https://dookofcards.github.io/stepsmith/privacy-policy.html
- Homepage: https://dookofcards.github.io/stepsmith/
- Support: https://github.com/dookofcards/stepsmith/issues

## Assets (`store-assets/`)
- Icon 128×128: `src/icons/icon128.png` (also `docs/icon128.png`)
- Screenshots 1280×800: `screenshot-1-library.png`, `screenshot-2-editor.png`, `screenshot-3-redact.png`, `screenshot-4-popup.png`, `screenshot-5-permission.png` (real UI; Pro is switched on in 2 and 3, which the description labels as Pro)
- Small promo tile 440×280: `promo-440x280.png`
- Marquee 1400×560: `promo-1400x560.png`
- (GitHub social preview 1280×640: `github-social-1280x640.png`, not for the store)

## Reviewer test instructions
```
Stepsmith records the steps a user takes in one browser tab. It has no remote code and the free version makes no network requests.

To test:
1. Open any ordinary website (for example https://example.com) in a tab.
2. Click the Stepsmith toolbar button, then "Record this tab". A Stepsmith page opens and explains the permission; click "Allow and start recording" and accept Chrome's prompt. (This optional "all sites" permission lets the recorder follow the tab to new pages and take screenshots; it only touches the tab being recorded.) Chrome returns you to the tab.
3. Click a few links or buttons, and type in a text field. The toolbar badge shows REC.
4. Click the toolbar button and "Stop and open the guide". Each click is a step with a screenshot. Captions are editable; steps can be reordered and deleted. Typed text is not stored, only the field name; password fields are blurred.
5. "Export HTML" and "Copy as Markdown" are free.

Pro features (PDF export, image redact/annotate, auto-blur, branding, Markdown zip) are locked and explained until a one-time purchase through ExtensionPay. To flip Pro locally without paying: open chrome-extension://<extension id>/app/app.html, open DevTools, and run
  chrome.storage.local.set({ proEntitlement: { active: true, checkedAt: Date.now() } })
The page then shows Pro as unlocked.
```
