import { Test, TestingModule } from "@nestjs/testing";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { LinkPreview } from "@zenflow/shared";
import { isPublicAddress } from "./address-guard";
import { parseLinkPreview } from "./html-metadata";
import { LinkPreviewService } from "./link-preview.service";

const PAGE = "https://example.com/post/1";

describe("parseLinkPreview", () => {
  it("reads Open Graph tags in either attribute order", () => {
    const html = `
      <meta content="Hello" property="og:title">
      <meta property="og:description" content="About it">
      <meta name="og:site_name" content="Example">`;
    expect(parseLinkPreview(html, PAGE)).toEqual({
      title: "Hello",
      description: "About it",
      image: null,
      siteName: "Example",
    });
  });

  it("falls back to Twitter tags, then the <title> element", () => {
    const twitter = parseLinkPreview(
      `<meta name="twitter:title" content="Tw"><meta name="twitter:description" content="Td">`,
      PAGE,
    );
    expect(twitter.title).toBe("Tw");
    expect(twitter.description).toBe("Td");

    const plain = parseLinkPreview(
      `<title> Plain page </title><meta name="description" content="Plain">`,
      PAGE,
    );
    expect(plain.title).toBe("Plain page");
    expect(plain.description).toBe("Plain");
  });

  it("decodes HTML entities in values", () => {
    const preview = parseLinkPreview(
      `<meta property="og:title" content="Tom &amp; Jerry &#39;s &#x41; &#66;">`,
      PAGE,
    );
    expect(preview.title).toBe("Tom & Jerry 's A B");
  });

  it("resolves a relative image against the page URL", () => {
    const preview = parseLinkPreview(
      `<meta property="og:image" content="/img/card.png">`,
      PAGE,
    );
    expect(preview.image).toBe("https://example.com/img/card.png");
  });

  it("drops images that are not http(s)", () => {
    const preview = parseLinkPreview(
      `<meta property="og:image" content="javascript:alert(1)">`,
      PAGE,
    );
    expect(preview.image).toBeNull();
  });

  it("returns nulls for a page without metadata", () => {
    expect(parseLinkPreview("<p>hi</p>", PAGE)).toEqual({
      title: null,
      description: null,
      image: null,
      siteName: null,
    });
  });

  it("ignores metadata past the 200 000 character head", () => {
    const html = `${"a".repeat(200_000)}<meta property="og:title" content="late">`;
    expect(parseLinkPreview(html, PAGE).title).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "ff02::1",
  ])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("rejects strings that are not IP addresses", () => {
    expect(isPublicAddress("example.com")).toBe(false);
  });
});

describe("LinkPreviewService.preview", () => {
  async function makeService(cache: { get: jest.Mock; set: jest.Mock }) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LinkPreviewService,
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();
    return module.get<LinkPreviewService>(LinkPreviewService);
  }

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://10.0.0.5:8080/",
    "ftp://8.8.8.8/file",
  ])("returns null without fetching %s", async (url) => {
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const service = await makeService(cache);

    await expect(service.preview(url)).resolves.toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("serves a cached preview without fetching", async () => {
    const cached: LinkPreview = {
      title: "Cached",
      description: null,
      image: null,
      siteName: null,
    };
    const cache = {
      get: jest.fn().mockResolvedValue(cached),
      set: jest.fn(),
    };
    const service = await makeService(cache);

    await expect(service.preview("http://127.0.0.1/")).resolves.toEqual(cached);
    expect(cache.get).toHaveBeenCalledWith("link-preview:http://127.0.0.1/");
  });
});
