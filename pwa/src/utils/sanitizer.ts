import sanitize from "sanitize-html";
const allowedTags = [
  "b",
  "em",
  "strong",
  "i",
  "u",
  "strike",
  "iframe",
  "blockquote",
  "mark",
  "code",
  "pre",
  "img",
  "audio",
  "video",
  "a",
  "p",
  "li",
  "ul",
  "ol",
  "br",
  "span",
  "div",
  "label",
  "input",
];

// Uploads are stored inline as data URIs, so media and file links keep `data:`.
const mediaSchemes = ["http", "https", "data"];

export const sanitizeContent = (content: string) => {
  return sanitize(content, {
    allowedTags,
    allowedIframeDomains: ["www.youtube.com"],
    allowedSchemesByTag: {
      img: mediaSchemes,
      audio: mediaSchemes,
      video: mediaSchemes,
      a: ["http", "https", "mailto", "tel", "data"],
    },
    allowedAttributes: {
      code: ["class"],

      a: [
        "href",
        "data-filename",
        "data-filesize",
        "data-type",
        "target",
        "rel",
        "class",
      ],

      // keep classes for styling
      // Checklists (task lists) keep their markup.
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      input: ["type", "checked", "disabled"],
      label: [],
      div: ["class", "style"],
      span: ["class", "style"],

      img: ["src", "alt"],
      video: ["src", "controls"],
      audio: ["src", "controls"],
    },
  });
};
