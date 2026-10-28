// Maintenance-only conversion of upstream notices. Package builds copy the
// committed result and never need Cargo, Rust documentation or this converter.
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines: string[] = [];
      for (const word of normalize(paragraph).split(" ")) {
        const last = lines.length - 1;
        if (last < 0 || lines[last].length + word.length + 1 > 88) {
          lines.push(word); 
        } else {
          lines[last] += " " + word;
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export class NoticeBundle {
  private texts = new Map<string, { id: string; text: string }>();
  private components: string[] = [];

  addText(text: string): string {
    const key = normalize(text);
    if (!key) {
      throw Error("Empty upstream notice");
    }

    let entry = this.texts.get(key);
    if (!entry) {
      entry = {
        id: `N${String(this.texts.size + 1).padStart(3, "0")}`,
        text: paragraphs(text),
      };
      this.texts.set(key, entry);
    }

    return `[${entry.id}]`;
  }

  addComponent(text: string) {
    this.components.push(text.trim());
  }

  render(): string {
    return [
      "Third-party notices for Frozenight browser assets",
      "",
      "Frozenight's own notices are in LICENSE-MIT.txt and LICENSE-APACHE.txt.",
      "This file covers chess.js, locked Cargo dependencies (including build-time",
      "dependencies), and Rust 1.90.0 standard-library notices. The broad upstream",
      "Rust component inventory is retained, including other compilation targets;",
      "an entry here does not imply that component is included in this WASM.",
      "",
      "Matching notice texts are printed once, ignoring only whitespace differences.",
      "Each component references its complete texts by [Nxxx]. Copyright statements",
      "and license wording are preserved. Layout and HTML markup have been removed.",
      "",
      "COMPONENTS",
      "==========",
      ...this.components.flatMap((text) => ["", text]),
      "",
      "LICENSE TEXTS AND NOTICES",
      "========================",
      ...[...this.texts.values()].flatMap(({ id, text }) => [
        "",
        `[${id}]`,
        "-".repeat(72),
        text,
      ]),
      "",
    ].join("\n");
  }
}

function decodeHtml(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#")) {
      return String.fromCodePoint(
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10),
      );
    }

    if (!Object.hasOwn(named, entity)) {
      throw Error(`Unknown HTML entity: &${entity};`);
    }

    return named[entity];
  });
}

function htmlText(html: string): string {
  return paragraphs(
    decodeHtml(
      html
        .replace(
          /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
          (_, url: string, label: string) =>
            normalize(label) === url ? label : `${label} (${url})`,
        )
        .replace(/<\/(?:p|h[1-6]|li)>/g, "\n\n")
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

export function addRustNotices(
  bundle: NoticeBundle,
  html: string,
  readLicense: (name: string) => string,
) {
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1];
  if (!body || !body.includes('id="in-tree-files"')) {
    throw Error("Unrecognized Rust standard-library notice format");
  }

  const parts = body
    .replace(/<h2>Table of Contents<\/h2>[\s\S]*?<\/ul>/, "")
    .split(/<h3>([\s\S]*?)<\/h3>/);

  // The in-tree section supplies attribution and SPDX expressions, rather than
  // full license texts. Retain each of its referenced licenses in this file.
  const inTree = parts[0].match(
    /id="in-tree-files"[\s\S]*?id="out-of-tree-dependencies"/,
  )?.[0];
  if (!inTree) {
    throw Error("Missing Rust in-tree notice section");
  }

  const expressions = [...inTree.matchAll(/<b>License:<\/b>([^<]+)/g)];
  if (!expressions.length) {
    throw Error("Missing Rust in-tree licenses");
  }

  const licenses = new Set(
    expressions.flatMap(([, expression]) =>
      normalize(expression)
        .split(/[\s()]+/)
        .filter((id) => id && id !== "OR" && id !== "AND"),
    ),
  );

  const references = [...licenses].sort().map((id) => {
    if (!/^[A-Za-z0-9.-]+$/.test(id)) {
      throw Error(`Unexpected Rust license: ${id}`);
    }
    return `${id}: ${bundle.addText(readLicense(id + ".txt"))}`;
  });

  bundle.addComponent(
    `Rust 1.90.0 standard library\nSource: Rust 1.90.0 share/doc/rust/COPYRIGHT-library.html\n\n${htmlText(parts[0])}\n\nIn-tree license texts:\n${references.join("\n")}`,
  );

  for (let i = 1; i < parts.length; i += 2) {
    const title = htmlText(parts[i]);

    let section = parts[i + 1];
    const refs: string[] = [];

    section = section.replace(
      /<details>([\s\S]*?)<\/details>/g,
      (_, detail: string) => {
        const name = detail.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];
        const pre = detail.match(/<pre>([\s\S]*?)<\/pre>/)?.[1];
        if (!name || !pre) {
          throw Error(`Unrecognized Rust notice: ${title}`);
        }
        refs.push(`${htmlText(name)}: ${bundle.addText(decodeHtml(pre))}`);
        return "";
      },
    );

    if (/<(?:details|pre|summary)\b/.test(section)) {
      throw Error(`Unconverted Rust notice: ${title}`);
    }

    bundle.addComponent(
      `Rust standard-library dependency: ${title}\n${htmlText(section).replace(/\n\nNotices:$/, "")}\n${refs.join("\n")}`,
    );
  }
}
