import { connectPage, escapeHtml, expiredPage } from "./connect-page";

describe("connect page", () => {
  const html = connectPage({
    code: "ABCD2345",
    clientName: `<script>alert("x")</script> & co`,
    lang: "en",
    nonce: "n0nce",
  });

  it("escapes the assistant name", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co",
    );
  });

  it("shows the code in two groups and links into the app", () => {
    expect(html).toContain("ABCD 2345");
    expect(html).toContain('href="zenflow://settings?connect=ABCD2345"');
  });

  it("runs only the polling script, tagged with the nonce", () => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script nonce="n0nce">');
  });

  it("speaks Vietnamese when asked", () => {
    const vi = connectPage({
      code: "ABCD2345",
      clientName: "ChatGPT",
      lang: "vi",
      nonce: "n",
    });
    expect(vi).toContain("Kết nối ChatGPT");
    expect(vi).toContain('lang="vi"');
  });

  it("marks an expired request with the brand mark and no script", () => {
    const expired = expiredPage("en");
    expect(expired).toContain("<svg");
    expect(expired).toContain("This request expired");
    expect(expired).not.toContain("<script");
  });

  it("escapes quotes and angle brackets", () => {
    expect(escapeHtml(`<a href="x">'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;",
    );
  });
});
