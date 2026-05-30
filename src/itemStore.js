import fs from "node:fs/promises";
import path from "node:path";

export function normalizeItemName(itemName) {
  return itemName.trim();
}

function uniqueItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items.map(normalizeItemName).filter(Boolean)) {
    const key = item.toLocaleLowerCase("ko-KR");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export class ItemStore {
  constructor({ filePath, initialItems = [] }) {
    this.filePath = filePath;
    this.items = uniqueItems(initialItems);
    this.loaded = false;
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.items = uniqueItems(Array.isArray(parsed.items) ? parsed.items : []);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      if (this.items.length > 0) {
        await this.save();
      }
    }

    this.loaded = true;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        items: this.items,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${payload}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  getAll() {
    this.assertLoaded();
    return [...this.items];
  }

  async add(itemName) {
    this.assertLoaded();
    const normalized = normalizeItemName(itemName);
    if (!normalized) {
      return { added: false, reason: "empty", items: this.getAll() };
    }

    const exists = this.items.some((item) => item.toLocaleLowerCase("ko-KR") === normalized.toLocaleLowerCase("ko-KR"));
    if (exists) {
      return { added: false, reason: "duplicate", items: this.getAll() };
    }

    this.items.push(normalized);
    await this.save();
    return { added: true, items: this.getAll() };
  }

  async remove(itemName) {
    this.assertLoaded();
    const normalized = normalizeItemName(itemName);
    const nextItems = this.items.filter((item) => item.toLocaleLowerCase("ko-KR") !== normalized.toLocaleLowerCase("ko-KR"));

    if (nextItems.length === this.items.length) {
      return { removed: false, items: this.getAll() };
    }

    this.items = nextItems;
    await this.save();
    return { removed: true, items: this.getAll() };
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("ItemStore.load() must be called before using the store.");
    }
  }
}

