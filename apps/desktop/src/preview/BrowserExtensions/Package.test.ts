import { describe, expect, it } from "vite-plus/test";
import { strToU8, zipSync } from "fflate";

import {
  chromiumExtensionId,
  crxPublicKeyForId,
  crxZipPayload,
  parseWebStoreReference,
  summarizeManifest,
  unpackZip,
} from "./Package.ts";

const ONE_PASSWORD_ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";

const uint32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const concat = (...parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** A length-delimited protobuf field; every length here stays under 128 bytes. */
const field = (number: number, value: Uint8Array) =>
  concat(Uint8Array.of(number * 8 + 2, value.length), value);

const crx3 = (header: Uint8Array, zip: Uint8Array) =>
  concat(strToU8("Cr24"), uint32(3), uint32(header.length), header, zip);

const zip = zipSync({ "manifest.json": strToU8("{}"), "popup/index.html": strToU8("<p>") });

describe("parseWebStoreReference", () => {
  it.each([
    [ONE_PASSWORD_ID, ONE_PASSWORD_ID],
    [
      `https://chromewebstore.google.com/detail/1password-password-manager/${ONE_PASSWORD_ID}`,
      ONE_PASSWORD_ID,
    ],
    [`https://chrome.google.com/webstore/detail/x/${ONE_PASSWORD_ID}?hl=en`, ONE_PASSWORD_ID],
    [`chromewebstore.google.com/detail/x/${ONE_PASSWORD_ID}`, ONE_PASSWORD_ID],
    [`http://chromewebstore.google.com/detail/${ONE_PASSWORD_ID}`, undefined],
    [`https://evil.example/detail/${ONE_PASSWORD_ID}`, undefined],
    ["not an id", undefined],
  ])("reads %s", (reference, expected) => {
    expect(parseWebStoreReference(reference)).toBe(expected);
  });
});

describe("CRX packages", () => {
  it("returns the zip after a CRX3 header", () => {
    expect(crxZipPayload(crx3(Uint8Array.of(1, 2, 3), zip))).toEqual(zip);
  });

  it("returns the zip after a CRX2 key and signature", () => {
    const crx2 = concat(
      strToU8("Cr24"),
      uint32(2),
      uint32(2),
      uint32(3),
      Uint8Array.of(9, 9),
      Uint8Array.of(8, 8, 8),
      zip,
    );
    expect(crxZipPayload(crx2)).toEqual(zip);
  });

  it("rejects files that are not extension packages", () => {
    expect(() => crxZipPayload(zip)).toThrow("Not a Chrome extension package.");
    expect(() => crxZipPayload(concat(strToU8("Cr24"), uint32(3), uint32(500)))).toThrow(
      "Truncated",
    );
  });

  it("finds the publisher key whose hash is the requested id", () => {
    const publisherKey = strToU8("publisher-public-key");
    const otherKey = strToU8("google-verified-contents-key");
    const id = chromiumExtensionId(publisherKey);
    const header = concat(
      field(2, concat(field(1, otherKey), field(2, strToU8("sig-a")))),
      field(2, concat(field(1, publisherKey), field(2, strToU8("sig-b")))),
    );
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(crxPublicKeyForId(crx3(header, zip), id)).toEqual(publisherKey);
    expect(crxPublicKeyForId(crx3(header, zip), ONE_PASSWORD_ID)).toBeUndefined();
  });
});

describe("unpackZip", () => {
  it("keeps nested files", () => {
    expect([...unpackZip(zip).keys()]).toEqual(["manifest.json", "popup/index.html"]);
  });

  it.each(["../escape.js", "/etc/passwd", "a//b.js", "C:/windows.js"])(
    "rejects the unsafe entry %s",
    (name) => {
      expect(() => unpackZip(zipSync({ [name]: strToU8("x") }))).toThrow("unsafe path");
    },
  );
});

describe("summarizeManifest", () => {
  it("lists permissions, host access, the popup, and what Electron cannot provide", () => {
    const summary = summarizeManifest(
      {
        manifest_version: 3,
        name: "__MSG_extName__",
        version: "8.12.0",
        action: { default_popup: "popup/index.html" },
        permissions: ["storage", "tabs", "nativeMessaging", "contextMenus"],
        optional_permissions: ["downloads"],
        host_permissions: ["<all_urls>"],
        content_scripts: [{ matches: ["https://*/*"] }],
      },
      { extname: { message: "1Password" } },
    );
    expect(summary).toEqual({
      name: "1Password",
      version: "8.12.0",
      manifestVersion: 3,
      popup: "popup/index.html",
      permissions: [
        "storage",
        "tabs",
        "nativeMessaging",
        "contextMenus",
        "<all_urls>",
        "https://*/*",
      ],
      unsupported: ["nativeMessaging", "contextMenus", "downloads"],
    });
  });

  it("reads a Manifest V2 browser action popup", () => {
    const summary = summarizeManifest({
      manifest_version: 2,
      name: "Legacy",
      version: "1.0",
      browser_action: { default_popup: "popup.html" },
    });
    expect(summary.popup).toBe("popup.html");
    expect(summary.permissions).toEqual([]);
  });

  it("rejects a manifest without a name", () => {
    expect(() => summarizeManifest({ version: "1" })).toThrow("no name");
  });
});
