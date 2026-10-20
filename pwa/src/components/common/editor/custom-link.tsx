import Link from "@tiptap/extension-link";

export const CustomLink = Link.extend({
  addOptions() {
    // Cast shims a version drift in @tiptap/extension-link's option types.
    const parentOptions = this.parent?.() ?? {};
    return {
      ...parentOptions,
      fileBaseUrl: import.meta.env.VITE_API_URL,
      // Merge (not replace) the parent's `HTMLAttributes` so we keep its
      // `target`/`rel` defaults (open-in-new-tab + `noopener noreferrer`)
      // and only add our brand color class. `renderHTML` calls
      // `mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)`,
      // which dedupes class tokens, so this class survives even though the
      // per-mark `class` attribute's default also mirrors it (see
      // `@tiptap/extension-link`'s `addAttributes`).
      HTMLAttributes: {
        ...(parentOptions as { HTMLAttributes?: Record<string, unknown> })
          .HTMLAttributes,
        class: "text-primary underline underline-offset-4 font-medium",
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- shim for extension-link option drift (see above)
  },

  addCommands() {
    return {
      ...this.parent?.(),

      fetchFileMetadata:
        (href: string) =>
        // @ts-expect-error: the command context is untyped in this extension
        async ({ commands }) => {
          // @ts-expect-error: this.options is not typed on the command context
          const base = this.options.fileBaseUrl;

          if (!href.startsWith(`${base}/files/`)) return;

          // 1️⃣ Extract ID
          const id = href.split("/files/")[1];

          try {
            // 2️⃣ Fetch metadata
            const res = await fetch(`${base}/files/metadata/${id}`);
            const json = await res.json();
            const data = json.data;

            // 3️⃣ Store result in node attributes
            commands.updateAttributes("customLink", {
              fileName: data.originalName,
              fileSize: data.size,
              isFile: true,
            });
          } catch (err) {
            console.error("Failed to fetch file metadata", err);
          }
        },
    };
  },
});
