import { fold } from "./normalize";

interface Node {
  kids: Map<string, Node>;
  /** Display text and rank of a word that ends here. */
  word?: { text: string; weight: number };
}

const key = (s: string) => fold(s.trim()).text;

/** Prefix completion over accent-folded keys, so "toan" finds "Toán". */
export class Trie {
  private root: Node = { kids: new Map() };

  insert(text: string, weight: number): void {
    const k = key(text);
    if (!k) return;
    let n = this.root;
    for (const ch of k) {
      let next = n.kids.get(ch);
      if (!next) n.kids.set(ch, (next = { kids: new Map() }));
      n = next;
    }
    if (!n.word || n.word.weight < weight) n.word = { text, weight };
  }

  /** Words strictly longer than `prefix`, heaviest first, ties by text. */
  complete(prefix: string, limit: number): string[] {
    const p = key(prefix);
    if (!p || limit <= 0) return [];
    let n = this.root;
    for (const ch of p) {
      const next = n.kids.get(ch);
      if (!next) return [];
      n = next;
    }
    const found: { text: string; weight: number }[] = [];
    const walk = (node: Node, isRoot: boolean) => {
      if (node.word && !isRoot) found.push(node.word);
      for (const kid of node.kids.values()) walk(kid, false);
    };
    walk(n, true);
    return found
      .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text))
      .slice(0, limit)
      .map((w) => w.text);
  }
}
