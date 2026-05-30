import fs from "node:fs/promises";
import path from "node:path";

export function normalizeItemName(itemName) {
  return String(itemName ?? "")
    .trim()
    .replace(/\s+/g, " ");
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

function normalizeUsers(rawUsers) {
  if (!rawUsers || typeof rawUsers !== "object" || Array.isArray(rawUsers)) {
    return {};
  }

  const users = {};
  for (const [userId, userData] of Object.entries(rawUsers)) {
    if (!userId || !userData || typeof userData !== "object" || Array.isArray(userData)) {
      continue;
    }

    users[userId] = {
      items: uniqueItems(Array.isArray(userData.items) ? userData.items : []),
    };
  }

  return users;
}

export class ItemStore {
  constructor({ filePath, initialItems = [] }) {
    this.filePath = filePath;
    this.users = {};
    this.legacyItems = uniqueItems(initialItems);
    this.loaded = false;
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.users = normalizeUsers(parsed.users);
      this.legacyItems = uniqueItems(
        Array.isArray(parsed.legacyItems) ? parsed.legacyItems : Array.isArray(parsed.items) ? parsed.items : [],
      );

      if (this.shouldRewrite(parsed)) {
        await this.save();
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      if (this.legacyItems.length > 0) {
        await this.save();
      }
    }

    this.loaded = true;
  }

  async ensureUser(userId) {
    this.assertLoaded();
    this.assertUserId(userId);

    if (this.users[userId]) {
      return this.getAll(userId);
    }

    const hasExistingUsers = Object.keys(this.users).length > 0;
    const shouldClaimLegacyItems = !hasExistingUsers && this.legacyItems.length > 0;

    this.users[userId] = {
      items: shouldClaimLegacyItems ? [...this.legacyItems] : [],
    };

    if (shouldClaimLegacyItems) {
      this.legacyItems = [];
      await this.save();
    }

    return this.getAll(userId);
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        users: this.users,
        ...(this.legacyItems.length > 0 ? { legacyItems: this.legacyItems } : {}),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${payload}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  getAll(userId = null) {
    this.assertLoaded();

    if (!userId) {
      return uniqueItems([
        ...this.legacyItems,
        ...Object.values(this.users).flatMap((userData) => (Array.isArray(userData.items) ? userData.items : [])),
      ]);
    }

    return [...(this.users[userId]?.items ?? [])];
  }

  getUsers() {
    this.assertLoaded();
    return Object.entries(this.users)
      .map(([userId, userData]) => ({ userId, items: [...(userData.items ?? [])] }))
      .filter((userData) => userData.items.length > 0);
  }

  async add(userId, itemName) {
    this.assertLoaded();
    this.assertUserId(userId);
    await this.ensureUser(userId);

    const normalized = normalizeItemName(itemName);
    if (!normalized) {
      return { added: false, reason: "empty", items: this.getAll(userId) };
    }

    const userItems = this.users[userId].items;
    const normalizedKey = normalizeItemKey(normalized);
    const existingIndex = userItems.findIndex((item) => normalizeItemKey(item) === normalizedKey);
    const existingItem = existingIndex === -1 ? null : userItems[existingIndex];

    if (existingItem) {
      if (itemPreferenceScore(normalized) > itemPreferenceScore(existingItem)) {
        userItems[existingIndex] = normalized;
        await this.save();
        return { added: false, reason: "duplicate", existingItem: normalized, updatedExisting: true, items: this.getAll(userId) };
      }

      return { added: false, reason: "duplicate", existingItem, updatedExisting: false, items: this.getAll(userId) };
    }

    userItems.push(normalized);
    await this.save();
    return { added: true, items: this.getAll(userId) };
  }

  async remove(userId, itemName) {
    this.assertLoaded();
    this.assertUserId(userId);
    await this.ensureUser(userId);

    const normalizedKey = normalizeItemKey(itemName);
    const userItems = this.users[userId].items;
    const nextItems = userItems.filter((item) => normalizeItemKey(item) !== normalizedKey);

    if (nextItems.length === userItems.length) {
      return { removed: false, items: this.getAll(userId) };
    }

    this.users[userId].items = nextItems;
    await this.save();
    return { removed: true, items: this.getAll(userId) };
  }

  async removeMany(userId, itemNames) {
    this.assertLoaded();
    this.assertUserId(userId);
    await this.ensureUser(userId);

    const keysToRemove = new Set(itemNames.map(normalizeItemKey));
    const userItems = this.users[userId].items;
    const removedItems = userItems.filter((item) => keysToRemove.has(normalizeItemKey(item)));
    const nextItems = userItems.filter((item) => !keysToRemove.has(normalizeItemKey(item)));

    if (nextItems.length === userItems.length) {
      return { removed: false, removedItems: [], items: this.getAll(userId) };
    }

    this.users[userId].items = nextItems;
    await this.save();
    return { removed: true, removedItems, items: this.getAll(userId) };
  }

  shouldRewrite(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return true;
    }

    if (Array.isArray(parsed.items)) {
      return true;
    }

    if (!parsed.users || typeof parsed.users !== "object" || Array.isArray(parsed.users)) {
      return this.legacyItems.length > 0;
    }

    return Object.entries(this.users).some(([userId, userData]) => {
      const rawItems = parsed.users?.[userId]?.items;
      return !Array.isArray(rawItems) || JSON.stringify(userData.items) !== JSON.stringify(rawItems);
    });
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("ItemStore.load() must be called before using the store.");
    }
  }

  assertUserId(userId) {
    if (!userId) {
      throw new Error("Discord user id is required for user-scoped monitoring items.");
    }
  }
}
