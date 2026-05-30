import fs from "node:fs/promises";
import path from "node:path";

export function normalizeItemName(itemName) {
  return itemName.trim().replace(/\s+/g, " ");
}

export function normalizeItemKey(itemName) {
  return normalizeItemName(itemName)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s"'`.,/\\|()[\]{}<>:;!?~_\-+*=]+/g, "");
}

function itemPreferenceScore(itemName) {
  const hasSpacing = /\s/.test(itemName) ? 10 : 0;
  return hasSpacing + itemName.length / 1000;
}

function uniqueItems(items) {
  const indexByKey = new Map();
  const result = [];

  for (const item of items.map(normalizeItemName).filter(Boolean)) {
    const key = normalizeItemKey(item);
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(item);
      continue;
    }

    if (itemPreferenceScore(item) > itemPreferenceScore(result[existingIndex])) {
      result[existingIndex] = item;
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
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      this.items = uniqueItems(rawItems);
      if (this.items.length !== rawItems.length || JSON.stringify(this.items) !== JSON.stringify(rawItems)) {
        await this.save();
      }
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

    const normalizedKey = normalizeItemKey(normalized);
    const existingIndex = this.items.findIndex((item) => normalizeItemKey(item) === normalizedKey);
    const existingItem = existingIndex === -1 ? null : this.items[existingIndex];
    const exists = Boolean(existingItem);
    if (exists) {
      if (itemPreferenceScore(normalized) > itemPreferenceScore(existingItem)) {
        this.items[existingIndex] = normalized;
        await this.save();
        return { added: false, reason: "duplicate", existingItem: normalized, updatedExisting: true, items: this.getAll() };
      }

      return { added: false, reason: "duplicate", existingItem, updatedExisting: false, items: this.getAll() };
    }

    this.items.push(normalized);
    await this.save();
    return { added: true, items: this.getAll() };
  }

  async remove(itemName) {
    this.assertLoaded();
    const normalizedKey = normalizeItemKey(itemName);
    const nextItems = this.items.filter((item) => normalizeItemKey(item) !== normalizedKey);

    if (nextItems.length === this.items.length) {
      return { removed: false, items: this.getAll() };
    }

    this.items = nextItems;
    await this.save();
    return { removed: true, items: this.getAll() };
  }

  async removeMany(itemNames) {
    this.assertLoaded();
    const keysToRemove = new Set(itemNames.map(normalizeItemKey));
    const removedItems = this.items.filter((item) => keysToRemove.has(normalizeItemKey(item)));
    const nextItems = this.items.filter((item) => !keysToRemove.has(normalizeItemKey(item)));

    if (nextItems.length === this.items.length) {
      return { removed: false, removedItems: [], items: this.getAll() };
    }

    this.items = nextItems;
    await this.save();
    return { removed: true, removedItems, items: this.getAll() };
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("ItemStore.load() must be called before using the store.");
    }
  }
}
