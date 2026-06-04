import fs from "node:fs/promises";
import path from "node:path";

const GLOBAL_SCOPE_ID = "global";

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

function normalizeScopeId(value) {
  return String(value ?? "").trim() || GLOBAL_SCOPE_ID;
}

function uniqueNames(values) {
  const seen = new Set();
  const result = [];

  for (const value of values ?? []) {
    const normalized = normalizeItemName(value);
    const key = normalizeItemKey(normalized);
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function normalizeMonitoringItem(item) {
  const rawItemName =
    typeof item === "string"
      ? item
      : item && typeof item === "object" && !Array.isArray(item)
        ? item.itemName ?? item.name
        : "";
  const itemName = normalizeItemName(rawItemName);

  if (!itemName) {
    return null;
  }

  const category =
    item && typeof item === "object" && !Array.isArray(item) ? normalizeItemName(item.category ?? item.auctionItemCategory) : "";
  const listItemName =
    item && typeof item === "object" && !Array.isArray(item) ? normalizeItemName(item.listItemName ?? item.auctionListItemName) : "";
  const searchTerms =
    item && typeof item === "object" && !Array.isArray(item)
      ? uniqueNames([...(Array.isArray(item.searchTerms) ? item.searchTerms : []), itemName])
      : uniqueNames([itemName]);
  const includeIncomplete =
    item && typeof item === "object" && !Array.isArray(item)
      ? Boolean(item.includeIncomplete ?? item.allowIncomplete ?? item.includeUnfinished)
      : false;

  return {
    itemName,
    category,
    listItemName,
    includeIncomplete,
    searchTerms,
  };
}

function serializeMonitoringItem(item) {
  const normalized = normalizeMonitoringItem(item);
  if (!normalized) {
    return null;
  }

  return {
    itemName: normalized.itemName,
    includeIncomplete: normalized.includeIncomplete,
    ...(normalized.category ? { category: normalized.category } : {}),
    ...(normalized.listItemName && normalizeItemKey(normalized.listItemName) !== normalizeItemKey(normalized.itemName)
      ? { listItemName: normalized.listItemName }
      : {}),
    ...(normalized.searchTerms.length > 1 ||
    (normalized.searchTerms.length === 1 && normalizeItemKey(normalized.searchTerms[0]) !== normalizeItemKey(normalized.itemName))
      ? { searchTerms: normalized.searchTerms }
      : {}),
  };
}

export function formatMonitoringItem(item) {
  const normalized = normalizeMonitoringItem(item);
  if (!normalized) {
    return "";
  }

  const tags = [normalized.category, normalized.includeIncomplete ? "미완성 포함" : ""].filter(Boolean);
  return tags.length > 0 ? `${normalized.itemName} [${tags.join(", ")}]` : normalized.itemName;
}

export function monitoringItemKey(item) {
  const normalized = normalizeMonitoringItem(item);
  if (!normalized) {
    return "";
  }

  return normalizeItemKey(normalized.itemName);
}

function itemPreferenceScore(item) {
  const normalized = normalizeMonitoringItem(item);
  if (!normalized) {
    return 0;
  }

  const hasSpacing = /\s/.test(normalized.itemName) ? 10 : 0;
  const hasCategory = normalized.category ? 20 : 0;
  const hasListItemName = normalized.listItemName ? 10 : 0;
  const searchTermScore = normalized.searchTerms.length;
  return hasCategory + hasListItemName + hasSpacing + searchTermScore + normalized.itemName.length / 1000;
}

function uniqueItems(items) {
  const indexByKey = new Map();
  const result = [];

  for (const item of items.map(serializeMonitoringItem).filter(Boolean)) {
    const key = monitoringItemKey(item);
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

function normalizeScopes(rawScopes) {
  if (!rawScopes || typeof rawScopes !== "object" || Array.isArray(rawScopes)) {
    return {};
  }

  const scopes = {};
  for (const [scopeId, scopeData] of Object.entries(rawScopes)) {
    if (!scopeData || typeof scopeData !== "object" || Array.isArray(scopeData)) {
      continue;
    }

    scopes[normalizeScopeId(scopeId)] = {
      items: uniqueItems(Array.isArray(scopeData.items) ? scopeData.items : []),
    };
  }

  return scopes;
}

function legacyUserItems(rawUsers) {
  if (!rawUsers || typeof rawUsers !== "object" || Array.isArray(rawUsers)) {
    return [];
  }

  return Object.values(rawUsers).flatMap((userData) =>
    userData && typeof userData === "object" && !Array.isArray(userData) && Array.isArray(userData.items) ? userData.items : [],
  );
}

function removalKeys(item) {
  const normalized = normalizeMonitoringItem(item);
  const keys = new Set();

  if (normalized) {
    keys.add(monitoringItemKey(normalized));
    keys.add(normalizeItemKey(formatMonitoringItem(normalized)));
    for (const searchTerm of normalized.searchTerms) {
      keys.add(normalizeItemKey(searchTerm));
    }
  }

  if (typeof item === "string") {
    keys.add(normalizeItemKey(item));
  }

  return keys;
}

function matchesRemovalKeys(item, keys) {
  const normalized = normalizeMonitoringItem(item);
  if (!normalized) {
    return false;
  }

  return (
    keys.has(monitoringItemKey(normalized)) ||
    keys.has(normalizeItemKey(formatMonitoringItem(normalized))) ||
    normalized.searchTerms.some((searchTerm) => keys.has(normalizeItemKey(searchTerm)))
  );
}

export class ItemStore {
  constructor({ filePath, initialItems = [] }) {
    this.filePath = filePath;
    this.scopes = {};
    this.legacyItems = uniqueItems(initialItems);
    this.loaded = false;
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let parsed = {};
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    this.scopes = normalizeScopes(parsed.scopes ?? parsed.guilds);
    this.legacyItems = uniqueItems([
      ...this.legacyItems,
      ...(Array.isArray(parsed.legacyItems) ? parsed.legacyItems : []),
      ...(Array.isArray(parsed.items) ? parsed.items : []),
      ...legacyUserItems(parsed.users),
    ]);

    if (Object.keys(this.scopes).length === 0 && this.legacyItems.length > 0) {
      this.scopes[GLOBAL_SCOPE_ID] = { items: [...this.legacyItems] };
      this.legacyItems = [];
    }

    this.loaded = true;

    if (this.shouldRewrite(parsed)) {
      await this.save();
    }
  }

  async ensureScope(scopeId) {
    this.assertLoaded();
    const normalizedScopeId = normalizeScopeId(scopeId);

    if (this.scopes[normalizedScopeId]) {
      return this.getAll(normalizedScopeId);
    }

    if (
      normalizedScopeId !== GLOBAL_SCOPE_ID &&
      this.scopes[GLOBAL_SCOPE_ID] &&
      Object.keys(this.scopes).length === 1
    ) {
      this.scopes[normalizedScopeId] = { items: [...this.scopes[GLOBAL_SCOPE_ID].items] };
      delete this.scopes[GLOBAL_SCOPE_ID];
      await this.save();
      return this.getAll(normalizedScopeId);
    }

    this.scopes[normalizedScopeId] = {
      items: this.legacyItems.length > 0 ? [...this.legacyItems] : [],
    };
    this.legacyItems = [];
    await this.save();
    return this.getAll(normalizedScopeId);
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        scopes: this.scopes,
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

  getAll(scopeId = null) {
    return this.getEntries(scopeId).map(formatMonitoringItem);
  }

  getEntries(scopeId = null) {
    this.assertLoaded();

    if (!scopeId) {
      return uniqueItems([
        ...this.legacyItems,
        ...Object.values(this.scopes).flatMap((scopeData) => (Array.isArray(scopeData.items) ? scopeData.items : [])),
      ]);
    }

    const normalizedScopeId = normalizeScopeId(scopeId);
    return uniqueItems(this.scopes[normalizedScopeId]?.items ?? this.scopes[GLOBAL_SCOPE_ID]?.items ?? []);
  }

  getScopes() {
    this.assertLoaded();
    return Object.entries(this.scopes)
      .map(([scopeId, scopeData]) => ({ scopeId, items: uniqueItems(scopeData.items ?? []) }))
      .filter((scopeData) => scopeData.items.length > 0);
  }

  getUsers() {
    return this.getScopes().map(({ scopeId, items }) => ({ userId: scopeId, items }));
  }

  async add(scopeId, itemName) {
    this.assertLoaded();
    await this.ensureScope(scopeId);

    const normalizedScopeId = normalizeScopeId(scopeId);
    const normalized = serializeMonitoringItem(itemName);
    if (!normalized) {
      return { added: false, reason: "empty", items: this.getAll(normalizedScopeId) };
    }

    const scopeItems = this.scopes[normalizedScopeId].items;
    const normalizedKey = monitoringItemKey(normalized);
    const existingIndex = scopeItems.findIndex((item) => monitoringItemKey(item) === normalizedKey);
    const existingItem = existingIndex === -1 ? null : serializeMonitoringItem(scopeItems[existingIndex]);

    if (existingItem) {
      const includeIncompleteChanged = existingItem.includeIncomplete !== normalized.includeIncomplete;
      if (includeIncompleteChanged || itemPreferenceScore(normalized) > itemPreferenceScore(existingItem)) {
        const nextItem =
          itemPreferenceScore(normalized) >= itemPreferenceScore(existingItem)
            ? normalized
            : serializeMonitoringItem({ ...existingItem, includeIncomplete: normalized.includeIncomplete });
        scopeItems[existingIndex] = nextItem;
        await this.save();
        return {
          added: false,
          reason: "duplicate",
          existingItem: formatMonitoringItem(normalized),
          updatedExisting: true,
          items: this.getAll(normalizedScopeId),
        };
      }

      return {
        added: false,
        reason: "duplicate",
        existingItem: formatMonitoringItem(existingItem),
        updatedExisting: false,
        items: this.getAll(normalizedScopeId),
      };
    }

    scopeItems.push(normalized);
    await this.save();
    return { added: true, item: normalized, items: this.getAll(normalizedScopeId) };
  }

  async remove(scopeId, itemName) {
    this.assertLoaded();
    await this.ensureScope(scopeId);

    const normalizedScopeId = normalizeScopeId(scopeId);
    const keysToRemove = removalKeys(itemName);
    const scopeItems = this.scopes[normalizedScopeId].items;
    const nextItems = scopeItems.filter((item) => !matchesRemovalKeys(item, keysToRemove));

    if (nextItems.length === scopeItems.length) {
      return { removed: false, items: this.getAll(normalizedScopeId) };
    }

    this.scopes[normalizedScopeId].items = nextItems;
    await this.save();
    return { removed: true, items: this.getAll(normalizedScopeId) };
  }

  async removeMany(scopeId, itemNames) {
    this.assertLoaded();
    await this.ensureScope(scopeId);

    const normalizedScopeId = normalizeScopeId(scopeId);
    const keysToRemove = new Set(itemNames.flatMap((itemName) => [...removalKeys(itemName)]));
    const scopeItems = this.scopes[normalizedScopeId].items;
    const removedItems = scopeItems.filter((item) => matchesRemovalKeys(item, keysToRemove));
    const nextItems = scopeItems.filter((item) => !matchesRemovalKeys(item, keysToRemove));

    if (nextItems.length === scopeItems.length) {
      return { removed: false, removedItems: [], items: this.getAll(normalizedScopeId) };
    }

    this.scopes[normalizedScopeId].items = nextItems;
    await this.save();
    return { removed: true, removedItems: removedItems.map(formatMonitoringItem), items: this.getAll(normalizedScopeId) };
  }

  shouldRewrite(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return true;
    }

    return (
      Boolean(parsed.users) ||
      Boolean(parsed.guilds) ||
      Array.isArray(parsed.items) ||
      Array.isArray(parsed.legacyItems) ||
      JSON.stringify(normalizeScopes(parsed.scopes)) !== JSON.stringify(this.scopes)
    );
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("ItemStore.load() must be called before using the store.");
    }
  }
}
