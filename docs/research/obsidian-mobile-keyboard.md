# Obsidian mobile: keyboard, Modal, Menu (research for issue #2)

Issue #2 asked for measurements on real phones. No device is available, so this note answers the same questions from primary sources and makes the container decision on that basis. Anything that only a device can settle is listed under "Not verified on a real device" at the end.

**Evidence labels**

- **[bundle]**: read directly from Obsidian 1.14.5's shipped code, `obsidian-1.14.5.asar` from the [official release](https://github.com/obsidianmd/obsidian-releases/releases/download/v1.14.5/obsidian-1.14.5.asar.gz), unpacked without running anything. Files are `app.js` and `app.css`. `@N` is the character offset in the minified file, and the quoted snippet can be searched for.
- **[d.ts]**: `node_modules/obsidian/obsidian.d.ts`, npm `obsidian@1.12.3`, the version this repo resolves.
- **[doc]**: official documentation or source code (Capacitor, WebKit, Chrome, Obsidian changelog).
- **[secondary]**: a forum post by a user (not staff). Used only as a pointer.
- **Inference**: my reasoning from the evidence. It is not an observed fact.

**What the bundle cannot show.** The desktop bundle includes the mobile JavaScript and CSS (`app.emulateMobile` runs them, see `e.prototype.emulateMobile=function(e){e?localStorage[Moe]=1` @3932685). It does not include the native Capacitor shell: the iOS and Android projects, `capacitor.config`, the Keyboard plugin's native code, or any WKWebView/Android WebView setup. Several values below are **written by that shell and only read by the bundle**. In those cases we know the name and how Obsidian consumes it, but not exactly how it is produced.

---

## 1. Does the webview resize or get overlaid when the keyboard opens?

**Answer: on iOS, Obsidian almost certainly overlays the keyboard and does not resize the webview.** Obsidian shrinks its own layout by `--keyboard-height`. On Android the mechanism can't be determined from the bundle, but Obsidian's CSS uses the same `--keyboard-height` contract on both platforms.

- **Confidence:** medium-high for iOS, low for Android.

### Evidence

**[bundle] The page is always one full viewport tall, and the app container shrinks itself.** From `app.css` @582554:

```css
body.is-mobile { position: relative; height: 100vh; width: 100vw; }
body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)); }
body.is-mobile.keyboard-animating .app-container { max-height: 100vh; }
```

**[bundle] Other mobile chrome follows the same pattern.** Each piece places itself against the full `100vh` minus `--keyboard-height`:

- Mobile toolbar, `app.css` @649390: `.mobile-toolbar { position: absolute; top: calc(100vh - var(--keyboard-height) - var(--mobile-toolbar-height)) }`
- Form modals, `app.css` @639056: `.is-phone .modal.mod-form .modal-button-container { margin-bottom: max(var(--safe-area-inset-bottom), calc(var(--keyboard-height) + var(--size-4-4))) }`
- Settings, `app.css` @317283: `padding-bottom: max(var(--keyboard-height), var(--size-4-16))`
- `:root { … --keyboard-height: 0px; }` (`app.css` @576649) sets the default.

**Inference: why this means "overlay".** If the webview were resized natively, `100vh` would already exclude the keyboard. Subtracting `--keyboard-height` on top of that would count the keyboard twice, and Obsidian's own layout would leave a gap. So on any platform where `--keyboard-height` is non-zero, the webview is not being resized.

**[doc] Stock Capacitor resize modes.** The stock Capacitor Keyboard plugin defaults to `resize: native` ("The whole native Web View will be resized … This affects the `vh` relative unit"). Its other modes are `body`, `ionic`, and `none` ("Neither the app nor the Web View are resized"). The `resize` option is "Only available on iOS" ([Capacitor Keyboard docs](https://capacitorjs.com/docs/apis/keyboard)). In the iOS source, `native` shrinks the webview frame, and `body` sets `document.body.style.height` from JavaScript ([Keyboard.m](https://github.com/ionic-team/capacitor-keyboard/blob/main/ios/Sources/KeyboardPlugin/Keyboard.m)).

**Inference: Obsidian probably uses `none` on iOS.** Obsidian's CSS model only fits `none`. `body` would fight `body.is-mobile { height: 100vh }`, and `native` would double-count as described above.

**[bundle] Obsidian's Keyboard plugin is not the stock one.** The bundle calls `Lw.hasPhysicalKeyboard()` and `Lw.isMultiWindowMode()` (@3894891, @3122254). The `keyboardWillHide` event it receives carries `e.hasPhysicalKeyboard` (@3121708). None of these exist in the stock plugin, so the stock defaults may not apply.

**[bundle] Nothing in the bundle writes the keyboard state.** These names are only read, never set, in `app.js`:

- `--keyboard-height`: read at @3085454, @3123058, @3123448. It also appears in the list of root styles copied to popout windows (`d0=["--zoom-factor","--keyboard-height"]` @2616201), which suggests an inline style on `<html>`.
- `keyboard-animating`: the class appears only in `app.css`.
- `Platform.mobileSoftKeyboardVisible`: its only assignment is the default `mobileSoftKeyboardVisible:!1` (@793312).

**Inference:** the native shell sets all three, probably through the custom Keyboard plugin.

**[doc] Obsidian's changelog** mentions this machinery without describing it:

- 1.9.0 mobile: "The app now smoothly resizes when the on-screen keyboard appears and disappears." On Android: "Improved how the app layout adapts to the on-screen keyboard" and "App now resizes correctly in split-screen mode" ([changelog](https://obsidian.md/changelog/2025-05-21-mobile-v1.9.0/)).
- 1.14.4: "Bases: Fixed kanban columns resizing on mobile when the keyboard opens or closes." ([changelog](https://obsidian.md/changelog/2026-10-01-mobile-v1.14.4/)). This matches `.is-phone … .bases-kanban-container { height: calc(100% + var(--keyboard-height) - …) }` (`app.css` @586892).

**[secondary]** A user reports that a tall plugin `Modal` gets covered by the keyboard on mobile, and points at `.is-phone .modal-container { --dialog-max-height: calc(100vh - …) }` ([forum, Aug 2026](https://forum.obsidian.md/t/mobile-shrink-modal-height-on-typing-to-accomodate-the-keyboard/117408)). That fits the overlay model. The platform is not stated.

**[doc] Chrome's viewport change doesn't apply.** The Chrome 108 change (keyboard resizes only the visual viewport by default, plus the `interactive-widget` meta key) "do[es] not affect" Android WebView ([Chrome blog](https://developer.chrome.com/blog/viewport-resize-behavior)). Obsidian's viewport meta has no `interactive-widget` anyway: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover` (`index.html`).

**Android: unknown.** On Android the WebView's size depends on the native window's soft-input handling, which lives in the shell. The bundle shows Android-specific keyboard code (the mobile toolbar tracks `hasKeyboardVisible` and `multiWindowModeChanged` only when `Qy.isAndroidApp`, @3121708 and @3122254) but not whether the WebView is resized. **Unknown.**

### What `innerHeight` and `visualViewport` do

- **[bundle] There is no Obsidian code that relies on `visualViewport` or `innerHeight` for keyboard layout.**
  - The only `visualViewport` uses are CodeMirror internals and the image lightbox.
  - CodeMirror (@378104) treats `window.innerHeight - window.visualViewport.height > 1` as "keyboard is covering part of the page". That is a generic CM6 heuristic, not Obsidian's.
  - The lightbox (`scheduleOpenAnimation`, @1692510) waits for `resize`/`visualViewport` `resize` to settle on mobile before animating.
- **Inference (unverified):**
  - In overlay mode, `innerHeight` should stay at the full height.
  - On iOS, `visualViewport.height` is expected to shrink by the keyboard and `offsetTop` may become non-zero if WebKit scrolls to reveal the input. This is how Safari behaves. Whether Obsidian's WKWebView configuration preserves it is **not verified**.
  - If Android resizes the WebView, `innerHeight` and `visualViewport.height` both shrink together.

---

## 2. Does Obsidian give plugins a keyboard-open or keyboard-height signal?

**Answer: yes, at runtime, but none of it is public API.**

- **Confidence:** high that the names below exist and are consumed. Medium on exactly when they are written, because the writer is native.

| Signal | Exact name | Evidence | Public? |
|---|---|---|---|
| CSS variable, keyboard height in px | `--keyboard-height` on `document.documentElement` (default `0px` in `:root`) | [bundle] `app.css` @576649. Read in JS via `getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height")` (@3123058) | No (not in d.ts) |
| Body class while the keyboard animates | `keyboard-animating` on `body` | [bundle] `body.is-mobile.keyboard-animating .app-container { max-height: 100vh; }` @582554 | No |
| Window DOM events | `keyboardWillShow`, `keyboardWillHide` (`keyboardDidShow`/`keyboardDidHide` exist in stock Capacitor) | [bundle] `window.addEventListener("keyboardWillShow",…)` @3109701 and @3121913. [doc] Capacitor dispatches these on `window` "for compatibility with cordova-plugin-ionic-keyboard". The stock payload is `{ keyboardHeight }` on the show events ([docs](https://capacitorjs.com/docs/apis/keyboard), [Keyboard.m](https://github.com/ionic-team/capacitor-keyboard/blob/main/ios/Sources/KeyboardPlugin/Keyboard.m)). Obsidian's build adds `hasPhysicalKeyboard` to the hide event (@3121708) | Capacitor-documented, not Obsidian-documented |
| Platform flag | `Platform.mobileSoftKeyboardVisible: boolean` | [bundle] Default `!1` @793312. Read by the editor (@2592373), the swipe gesture (@2905186), and the navbar (@3111893) | No. [d.ts] `Platform` declares only `isDesktop … isSafari` |
| Platform flag | `Platform.hasPhysicalKeyboard: boolean` | [bundle] Set from `Lw.hasPhysicalKeyboard()` @3894891 | No |
| Workspace event | **none** | [bundle] No `workspace.trigger("keyboard…")`. [d.ts] Has no keyboard events | — |

**[secondary] Users already use these.** A user script reads `window.Capacitor.Plugins.Keyboard.addListener('keyboardWillShow'…)` and says `keyboardDidShow` "fire[s] only after the keyboard fully shows" since 1.9.10 ([forum](https://forum.obsidian.md/t/hide-obsidian-app-header-when-the-softkeyboard-is-open/102979)).

**[bundle] How Obsidian animates its own toolbar.** The mobile toolbar listens for `keyboardWillShow`/`keyboardWillHide`, rereads `--keyboard-height`, and on iOS animates the difference with `duration:300, fn:"cubic-bezier(.12,0,.44,.99)"` (`animateToKeyboardHeight`, @3123448). This is the curve to copy so the dock moves in step with Obsidian's toolbar.

---

## 3. How is a `Modal` styled and positioned on mobile?

**[bundle] Structure** (`ST` constructor, @1287772 region): `div.modal-container` > (`div.modal-bg`, `div.modal` > (`div.modal-header-button` [the X], `div.modal-header` > `div.modal-title`, `div.modal-content`)).

`open()` does the following, in order:

1. `cE(n)`: blurs the active element and clears the selection.
2. `n.document.body.appendChild(this.getRootEl())`: the modal goes on `<body>`, not inside `.app-container`.
3. `this.onOpen()`: called **synchronously**.
4. On phones, `animateOpen()`.
5. `yM.push(this, n)`: registers the modal in the private "closeable" stack.
6. `Qy.hasPhysicalKeyboard&&this.hasInitialInputFocus&&BE(r,…)`: Obsidian only auto-focuses a modal's first input **when a hardware keyboard is attached**.

**[bundle] Positioning (all mobile)**

- `.modal-container { display:flex; align-items:center; justify-content:center; position:absolute; top:0; bottom:0; width:100%; z-index: var(--layer-modal) }` (@285455), with `--layer-modal: 50` (@74432).
- Because the modal sits on `body` (`height:100vh`), **the container covers the full 100vh and does not shrink with `--keyboard-height`**. Only `.app-container` shrinks.
- **Inference:** a `Modal` does not follow the visible area on its own. The plugin has to size its contents.

**[bundle] Phone** (`.is-phone`, which means the viewport is smaller than 600×600: `matchMedia("(min-width: 600px) and (min-height: 600px)")` @3894891):

- `.is-phone .modal-container { --dialog-max-height: calc(100vh - var(--safe-area-inset-top)); --dialog-width: 100vw; --dialog-max-width: calc(100vw - safe-left - safe-right - var(--size-4-6)); --modal-radius: var(--touch-radius-xs); … }` (@636703)
- `.is-phone .modal { padding: 0 var(--safe-area-inset-right) 0 var(--safe-area-inset-left); }` (@637180). The base `.modal` (@286473) also sets `border-radius`, `border`, `min-height:100px`, `max-height: var(--dialog-max-height)`, and `overflow:auto`.
- `.modal.mod-lg` and `.mod-sidebar-layout` become a bottom-anchored sheet: `margin-top:auto; height:100%`, top-only radius (@637878, @638201).
- `.is-phone .modal-content { padding: var(--size-4-4); overflow:auto }` (@638582). `.is-phone .modal-header` has padding plus `position:relative` (@639257).
- **Animation:** `canAnimate()` returns `Qy.isPhone`.
  - Open slides up from `translateY(<height>px)` over `clamp(0.35·h, 100, 250)` ms with `var(--anim-motion-swing)`. The background fades to `bgOpacity` `"0.85"` (`sk`, @827047).
  - Close reverses this (`lk`).
  - A swipe-down-to-dismiss gesture is bound to **`headerEl` only** (`vM(this.headerEl,{…onDismiss:…close()})`).
  - `shouldAnimateOpen` (a private field, default `true`) skips the open animation.

**[bundle] Tablet.** No `.is-phone` rules apply, so the modal is a centered desktop-style dialog using the theme's `--dialog-width`/`--dialog-max-height`, and it does not animate.

**[bundle] Safe areas** are exposed as `--safe-area-inset-{top,bottom,left,right}: env(safe-area-inset-*)` (@576649), with `viewport-fit=cover` in `index.html`.

**Can a plugin make it edge-to-edge and follow the visible area?**

- **Yes, edge-to-edge (Inference, from the CSS above; confidence medium-high).** All the obstacles are plain CSS and `var()`s on classes the plugin can scope with its own modifier class on `containerEl`/`modalEl`:
  1. Override `--dialog-*`/`--modal-radius` on `.modal-container.<ours>`.
  2. Set `.modal.<ours> { width:100vw; max-width:none; height:100%; max-height:none; border:0; border-radius:0; padding:0 }`.
  3. Hide `.modal-header-button` and leave `.modal-header` empty or hidden (this also removes the swipe-to-dismiss area).
  4. Make `.modal-content` a zero-padding flex column.

  Two-class selectors such as `.is-phone .modal.<ours>` beat every core rule listed, so `!important` is not needed.

  The surface handles safe areas itself with `--safe-area-inset-*`.
- **Following the visible area is the plugin's job.** Sizing the inner surface from keyboard tracking works the same inside a `Modal` and inside a custom `div` on `body`. Both start as 100vh boxes.

**[d.ts]** The public API covers `Modal.containerEl`, `modalEl`, `titleEl`, `contentEl`, `scope`, `shouldRestoreSelection`, `open()`, `close()`, `onOpen()`, `onClose()`, and `setCloseCallback()`.

`shouldAnimateOpen`, `onHistoryBack`, `canAnimate`, and `bgOpacity` are **not** public.

---

## 4. Does `focus()` inside a `setTimeout` after a tap raise the iOS keyboard?

**Answer: by default, no** (under WebKit's default policy). Obsidian's native shell could override this, but nothing in the bundle suggests it does. Obsidian's own code focuses synchronously.

- **Confidence:** medium-high for "a delayed focus is not guaranteed and will probably fail". Unverified on a device.

**[doc] WebKit source** (`main`), [`WKContentViewInteraction.mm` `_elementDidFocus:userIsInteracting:…`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm). With the default `_WKFocusStartsInputSessionPolicyAuto`, the keyboard shows only in these cases:

- `if (userIsInteracting) return YES;`
- if the keyboard was dismissed in the same presentation update (`_keyboardDismissedInCurrentPresentationUpdate && !_editingEndedByUser`);
- if the view is first responder and focus is moving between fields (`_isChangingFocus`), or a hardware keyboard is attached.

The host app can override this only through the private input delegate SPI `_webView:focusShouldStartInputSession:` / `_webView:decidePolicyForFocusedElement:`.

**[doc] Where `userIsInteracting` comes from** ([`WebPage.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/WebPage.cpp)). It is `m_userIsInteracting`, which is set with `SetForScope userIsInteractingChange { m_userIsInteracting, true }` only while WebKit is synchronously dispatching a real `mouseEvent`, `keyEvent`, or `dispatchTouchEvent` (plus `setInitialFocus` and JS run with `forceUserGesture`). A `setTimeout` callback runs after that scope has exited.

- **Caveat:** WebKit does forward the *user-gesture token* to timers of 1 s or less (`maxIntervalForUserGestureForwarding { 1_s }` in [`DOMTimer.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.cpp)). That token is a different mechanism from `m_userIsInteracting`, and I did not find it feeding the keyboard decision.
- I also did not trace iOS's synthetic-click path end to end.
- **Inference:** delayed focus does not count as user interaction.

**[doc] There is no `keyboardDisplayRequiresUserAction` on WKWebView.** That was a UIWebView property. A public WKWebView equivalent was proposed and the bug closed ([WebKit bug 149567](https://bugs.webkit.org/show_bug.cgi?id=149567)), but the shipped mechanism is the private delegate above. The stock Capacitor Keyboard iOS plugin swizzles only `inputAccessoryView` and `keyboardAppearance` and has no focus override ([Keyboard.m](https://github.com/ionic-team/capacitor-keyboard/blob/main/ios/Sources/KeyboardPlugin/Keyboard.m)). The Capacitor Keyboard docs do not mention focus or user action ([docs](https://capacitorjs.com/docs/apis/keyboard)). **Whether Obsidian's custom shell implements the delegate SPI cannot be seen in the bundle.**

**[bundle] Obsidian's own pattern is synchronous focus.**

- `SuggestModal` (`OT`) does `onOpen=function(){var e=this.inputEl;e.value="",e.focus(),this.updateSuggestions()}` (@1300155), and `Modal.open()` calls `onOpen()` synchronously.
- A command chosen from the palette runs synchronously inside the tap: `selectSuggestion=function(e,t){…this.close(),this.onChooseSuggestion(e,t)}`.
- Generic modals avoid auto-focus without a hardware keyboard (`Qy.hasPhysicalKeyboard&&this.hasInitialInputFocus`), and the 1.9.10 changelog says "Search inputs are automatically focused when an external keyboard is attached" ([changelog](https://obsidian.md/changelog/2025-08-18-mobile-v1.9.10/)).

**Consequence for this repo.** `src/mobile-search-modal.ts:104` does `setTimeout(() => this.inputEl.focus(), 50)`. The spec's rule stands: focus synchronously in `onOpen()`.

---

## 5. How does `Menu` render on mobile, and do `file-menu` / `files-menu` work?

**[bundle] Phone: a bottom sheet.**

- CSS (@632313): `.is-phone .menu { position:absolute; bottom:0; left: var(--safe-area-inset-left); right: var(--safe-area-inset-right); border-radius: var(--touch-radius-s) var(--touch-radius-s) 0 0; top: unset !important; }`.
- `.is-phone .menu-scroll { max-height: 60vh }`, and there is a `.menu-grabber` handle.
- In `showAtPosition`, for `Qy.isPhone`, `Qy.isMobileApp&&Lw&&Lw.hide()` **hides the soft keyboard**. The menu then slides up over 150 ms (`translateY(<h>px)` → `""`, `var(--anim-motion-swing)`) and `l.style.left=""; l.style.top=""` clears the position (@1226111).
- The x/y passed to `showAtPosition` is **ignored on phones**.
- Swipe-down dismisses the menu (`SS` → `vM`).
- Native menus apply only on desktop: `if(!Qy.isDesktop||!this.useNativeMenu)` renders the DOM menu.
- **Tablet:** the menu is positioned like a desktop popover, clamped by `--safe-area-inset-*` (same function, `else` branch).
- **Layering:** `--layer-menu: 65` is above `--layer-modal: 50`, so a menu opened from a modal appears above it.

**[bundle] `file-menu` / `files-menu` are plain workspace events, and core fires them on phones.**

- The file explorer, on `Qy.isPhone`, adds a title or label item and then still calls `this.app.workspace.trigger("file-menu",i,t,"file-explorer-context-menu",null)`. The multi-select path calls `trigger("files-menu",i,a,"file-explorer-context-menu",null)` (@1513347).
- Core's own `files-menu` listener adds "Move N items" (@2890717).
- Bases, canvas, graph, and link menus fire the same events.

**[d.ts]** `on(name: 'file-menu', callback: (menu, file, source, leaf?) …)` (since 0.9.12) and `on(name: 'files-menu', callback: (menu, files, source, leaf?) …)` (since 1.4.10).

A plugin creates a `Menu`, calls `app.workspace.trigger('files-menu', menu, files, '<source>')`, then calls `menu.showAtPosition(...)`. `trigger` is the public `Events.trigger`.

**Inference:** this works the same on mobile, since no platform guard exists on the event path. How the result looks on a phone is unverified.

---

## 6. Decision

**Use Obsidian's `Modal` as the container, restyled to full-screen.** Do not build a custom `body` overlay.

**Keyboard tracking takes its numbers from both Obsidian's `--keyboard-height` and `visualViewport`, and uses whichever gives the smaller visible height.**

### Why `Modal`

1. **Back button.** On Android, Obsidian's `backButton` handler calls `yM.back(window)`, which calls `onHistoryBack()` on the top closeable, and `Modal` registers itself there (@2903572, `yM.push(this,n)`). That stack is private. A custom container cannot join it, and Obsidian's handler would navigate the note history underneath it. Obsidian's own full-screen custom surface (the image lightbox) gets around this by calling the private `yM.push`.
2. **Behavior we need is already built in.** `Modal` gives `scope` (Escape), focus restore on close, blurring the editor on open, the right z-index (below `Menu` and notices), and a phone slide-in animation that fits user story 52.
3. **Restyling is CSS only.** Every obstacle to edge-to-edge is overridable CSS (section 3), and the swipe-dismiss gesture lives only on `headerEl`, which we leave empty.
4. **A custom container would not help with the keyboard.** Neither container follows the visible area by itself. Both are 100vh boxes on `body`.

### Implementation notes

- Add our own class to `containerEl` and `modalEl`. Neutralize the `--dialog-*` variables, radius, border, padding, and `.modal-header-button`. Lay the surface out with `position:absolute; inset:0 0 auto 0; height: var(--tdock-visible-height)`, and apply `--safe-area-inset-*` ourselves. Cover phone and tablet. On tablet the core rules are the desktop dialog rules.
- Focus the input **synchronously in `onOpen()`**.
- Overriding `onHistoryBack()` would let Android back follow the Quick Look → selection → close order from user story 43. **That method is private**: guard it and fall back to `close()`.

### Keyboard numbers (must hold up under resize and overlay)

Compute these values:

- `layoutH = window.innerHeight`, or the modal container's `clientHeight`.
- `obsidianKb`: `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0`.
- `vv = visualViewport`.

Then:

```
visibleHeight = min(layoutH - obsidianKb, vv ? vv.height : layoutH)
top           = vv ? vv.offsetTop : 0
```

How each case works out:

- **Overlay, Obsidian sets the variable:** the first term is correct. `vv` is either also correct or still full height, and `min` picks the correct one.
- **The WebView resizes:** `layoutH` is already reduced. Obsidian's own layout implies `obsidianKb` is 0 there, otherwise core would double-count. `vv` matches.
- **The variable isn't set** (older or different build): `vv` covers it.

Each source is either correct or too large, never too small, so `min` never cuts content off. That conclusion is an inference from the evidence above.

**Timing:**

- Recompute on `visualViewport` `resize`/`scroll`, on `window` `resize`, and on the `window` events `keyboardWillShow`/`keyboardWillHide`.
- On `keyboardWillShow`, use `event.keyboardHeight` when it is present (stock Capacitor payload; unverified in Obsidian's build) or the last stored height. That is the "guess ahead" step in the spec.
- Animate with Obsidian's iOS curve, `300ms cubic-bezier(.12,0,.44,.99)`.

**Fragility:** treat `Platform.mobileSoftKeyboardVisible` as a hint only. It is not in the d.ts, and its writer is native.

The spec's `trackKeyboard` design stays as written. This adds `--keyboard-height` and `keyboardWillShow` as a second source next to `visualViewport`.

---

## Not verified on a real device

- iOS and Android: actual `innerHeight`, `visualViewport.height`/`offsetTop`, and `--keyboard-height` values with the keyboard down and up, and whether Android resizes the WebView.
- Whether Obsidian's native shell sets `--keyboard-height` on Android, and whether its `keyboardWillShow` event carries `keyboardHeight`.
- Whether synchronous focus in `onOpen()` raises the iOS keyboard when the modal is opened from the command palette, a ribbon or toolbar button, or a link tap. Also whether `setTimeout` focus really fails, and whether the shell implements `_webView:focusShouldStartInputSession:`.
- That the restyled `Modal` reaches every edge, including the notch, the home indicator, and landscape insets, with no flash from core padding during the slide-in animation.
- How the `files-menu` bottom sheet looks over the modal on a phone, and that hiding the keyboard there does not break the selection bar.
