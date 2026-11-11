# Browser extensions

The desktop app can add Chrome extensions to its built-in browser.

Open **Settings → Browser → Extensions**. Paste a Chrome Web Store link or extension ID under
**Add from Chrome Web Store**, or choose **Load unpacked** to pick an extension folder on disk.
T3 Code then shows the extension's permissions and adds it only if you choose **Add extension**.
Agents cannot add extensions.

Extensions apply to every saved browser profile, not to incognito. Reload open pages after adding
one. Use the switch to turn an extension off, or the trash button to remove it. To open an
extension's toolbar popup, choose it under **Extensions** in the browser's **More** menu.

The built-in browser supports only part of Chrome's extension platform. Extensions that use
content scripts, `storage`, and basic messaging usually work. Native messaging, context menus,
notifications, downloads, and full tab and window control are not available, so extensions that
depend on them may fail or show errors. The permission prompt lists what an extension asks for that
the browser does not document support for.

Password managers such as 1Password cannot connect to their desktop app here, because that link
uses native messaging. They may not work at all in the built-in browser. Use the password manager's
own app or your regular browser instead.
