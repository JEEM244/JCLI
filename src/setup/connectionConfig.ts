export interface XmlConnectionEntry {
  name: string;
  connectionString: string;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function parseXmlConnectionEntries(content: string): XmlConnectionEntry[] {
  const withoutComments = content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const section = withoutComments.match(/<connectionStrings\b[^>]*>([\s\S]*?)<\/connectionStrings\s*>/i);
  if (!section) return [];
  const entries: XmlConnectionEntry[] = [];
  const addTag = /<add\b([^>]*?)\/?>/gi;
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const tag of section[1].matchAll(addTag)) {
    const attributes = new Map<string, string>();
    for (const attribute of tag[1].matchAll(attributePattern)) {
      attributes.set(attribute[1].toLowerCase(), decodeXmlAttribute(attribute[2] ?? attribute[3] ?? ""));
    }
    const name = attributes.get("name")?.trim();
    const connectionString = attributes.get("connectionstring");
    if (name && connectionString) entries.push({ name, connectionString });
  }
  return entries;
}
