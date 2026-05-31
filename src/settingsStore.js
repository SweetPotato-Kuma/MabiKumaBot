import fs from "node:fs/promises";
import path from "node:path";

const MIN_ALERT_DISCOUNT_PERCENT = 10;
const MAX_ALERT_DISCOUNT_PERCENT = 100;
const GLOBAL_SCOPE_ID = "global";

function normalizeScopeId(value) {
  return String(value ?? "").trim() || GLOBAL_SCOPE_ID;
}

function normalizeChannelId(value) {
  return String(value ?? "").trim();
}

function normalizeAlertDiscountPercent(value) {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < MIN_ALERT_DISCOUNT_PERCENT || percent > MAX_ALERT_DISCOUNT_PERCENT) {
    return null;
  }

  return percent;
}

function normalizeScopeSettings(rawSettings) {
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    return {};
  }

  const settings = {};
  const alertChannelId = normalizeChannelId(rawSettings.alertChannelId);
  const alertDiscountPercent = normalizeAlertDiscountPercent(rawSettings.alertDiscountPercent);

  if (alertChannelId) {
    settings.alertChannelId = alertChannelId;
  }

  if (alertDiscountPercent !== null) {
    settings.alertDiscountPercent = alertDiscountPercent;
  }

  return settings;
}

function normalizeScopes(rawScopes) {
  if (!rawScopes || typeof rawScopes !== "object" || Array.isArray(rawScopes)) {
    return {};
  }

  const scopes = {};
  for (const [scopeId, rawScopeSettings] of Object.entries(rawScopes)) {
    const normalizedScopeId = normalizeScopeId(scopeId);
    const settings = normalizeScopeSettings(rawScopeSettings);
    scopes[normalizedScopeId] = settings;
  }

  return scopes;
}

function mostCommonChannelId(values) {
  const counts = new Map();
  for (const value of values.map(normalizeChannelId).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

function mergeLegacySettings(parsed, initialSettings) {
  const legacyUsers = parsed?.users && typeof parsed.users === "object" && !Array.isArray(parsed.users) ? parsed.users : {};
  const userSettings = Object.values(legacyUsers).filter((settings) => settings && typeof settings === "object" && !Array.isArray(settings));
  const channelId = mostCommonChannelId([parsed?.alertChannelId, initialSettings.alertChannelId, ...userSettings.map((settings) => settings.alertChannelId)]);
  const percents = [
    normalizeAlertDiscountPercent(parsed?.alertDiscountPercent),
    ...userSettings.map((settings) => normalizeAlertDiscountPercent(settings.alertDiscountPercent)),
  ].filter((percent) => percent !== null);

  return normalizeScopeSettings({
    alertChannelId: channelId,
    // Use the most sensitive legacy threshold so merging users does not silently suppress existing alerts.
    alertDiscountPercent: percents.length > 0 ? Math.min(...percents) : null,
  });
}

export class SettingsStore {
  constructor({ filePath, initialSettings = {} }) {
    this.filePath = filePath;
    this.settings = {
      checkIntervalMs: initialSettings.checkIntervalMs,
      scopes: normalizeScopes(initialSettings.scopes),
    };

    const initialScope = normalizeScopeSettings(initialSettings);
    if (Object.keys(initialScope).length > 0) {
      this.settings.scopes[GLOBAL_SCOPE_ID] = initialScope;
    }

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

    const scopes = normalizeScopes(parsed.scopes ?? parsed.guilds);
    const hasScopedSettings = Object.keys(scopes).length > 0;
    if (!hasScopedSettings) {
      const legacySettings = mergeLegacySettings(parsed, this.settings.scopes[GLOBAL_SCOPE_ID] ?? {});
      if (Object.keys(legacySettings).length > 0) {
        scopes[GLOBAL_SCOPE_ID] = legacySettings;
      }
    }

    const checkIntervalMs = Number(parsed.checkIntervalMs ?? this.settings.checkIntervalMs);
    this.settings = {
      checkIntervalMs: Number.isFinite(checkIntervalMs) && checkIntervalMs >= 1000 ? checkIntervalMs : this.settings.checkIntervalMs,
      scopes,
    };

    this.loaded = true;

    if (this.shouldRewrite(parsed)) {
      await this.save();
    }
  }

  getAlertChannelId(scopeId = GLOBAL_SCOPE_ID) {
    this.assertLoaded();
    const normalizedScopeId = normalizeScopeId(scopeId);
    return this.settings.scopes?.[normalizedScopeId]?.alertChannelId || this.settings.scopes?.[GLOBAL_SCOPE_ID]?.alertChannelId || "";
  }

  getCheckIntervalMs(fallbackMs) {
    this.assertLoaded();
    const value = Number(this.settings.checkIntervalMs);
    return Number.isFinite(value) && value >= 1000 ? value : fallbackMs;
  }

  getAlertDiscountPercent(scopeId, fallbackPercent) {
    this.assertLoaded();
    const normalizedScopeId = normalizeScopeId(scopeId);
    const scopePercent = normalizeAlertDiscountPercent(this.settings.scopes?.[normalizedScopeId]?.alertDiscountPercent);
    if (scopePercent !== null) {
      return scopePercent;
    }

    const globalPercent = normalizeAlertDiscountPercent(this.settings.scopes?.[GLOBAL_SCOPE_ID]?.alertDiscountPercent);
    if (globalPercent !== null) {
      return globalPercent;
    }

    return normalizeAlertDiscountPercent(fallbackPercent) ?? MIN_ALERT_DISCOUNT_PERCENT;
  }

  async setAlertChannelId(scopeId, channelId) {
    this.assertLoaded();
    const scopeSettings = this.ensureScopeSettings(scopeId);
    scopeSettings.alertChannelId = normalizeChannelId(channelId);
    await this.save();
  }

  async setCheckIntervalMs(intervalMs) {
    this.assertLoaded();
    this.settings.checkIntervalMs = intervalMs;
    await this.save();
  }

  async setAlertDiscountPercent(scopeId, percent) {
    this.assertLoaded();
    const normalizedPercent = normalizeAlertDiscountPercent(percent);
    if (normalizedPercent === null) {
      throw new Error(
        `Alert discount percent must be an integer between ${MIN_ALERT_DISCOUNT_PERCENT} and ${MAX_ALERT_DISCOUNT_PERCENT}.`,
      );
    }

    const scopeSettings = this.ensureScopeSettings(scopeId);
    scopeSettings.alertDiscountPercent = normalizedPercent;
    await this.save();
  }

  async clearAlertChannelId(scopeId = GLOBAL_SCOPE_ID) {
    this.assertLoaded();
    const scopeSettings = this.ensureScopeSettings(scopeId);
    delete scopeSettings.alertChannelId;
    await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(
      {
        checkIntervalMs: this.settings.checkIntervalMs,
        scopes: this.settings.scopes ?? {},
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${payload}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  ensureScopeSettings(scopeId) {
    const normalizedScopeId = normalizeScopeId(scopeId);
    if (!this.settings.scopes) {
      this.settings.scopes = {};
    }

    if (
      normalizedScopeId !== GLOBAL_SCOPE_ID &&
      !this.settings.scopes[normalizedScopeId] &&
      this.settings.scopes[GLOBAL_SCOPE_ID] &&
      Object.keys(this.settings.scopes).length === 1
    ) {
      this.settings.scopes[normalizedScopeId] = { ...this.settings.scopes[GLOBAL_SCOPE_ID] };
      delete this.settings.scopes[GLOBAL_SCOPE_ID];
    }

    if (!this.settings.scopes[normalizedScopeId]) {
      this.settings.scopes[normalizedScopeId] = {};
    }

    return this.settings.scopes[normalizedScopeId];
  }

  shouldRewrite(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return true;
    }

    return (
      Boolean(parsed.users) ||
      Boolean(parsed.guilds) ||
      Boolean(parsed.alertChannelId) ||
      Boolean(parsed.alertDiscountPercent) ||
      JSON.stringify(normalizeScopes(parsed.scopes)) !== JSON.stringify(this.settings.scopes ?? {})
    );
  }

  assertLoaded() {
    if (!this.loaded) {
      throw new Error("SettingsStore.load() must be called before using the store.");
    }
  }
}
