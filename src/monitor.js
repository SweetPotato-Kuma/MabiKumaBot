import { EmbedBuilder } from "discord.js";

import { formatGold, formatPercent } from "./format.js";
import { formatMonitoringItem, monitoringItemKey, normalizeMonitoringItem } from "./itemStore.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toAlertDiscountPercent(value) {
  const percent = Number(value);
  return Number.isInteger(percent) && percent >= 10 && percent <= 100 ? percent : 10;
}

export class PriceMonitor {
  constructor({
    mabinogiClient,
    itemStore,
    settingsStore,
    resolveChannel,
    intervalMs,
    defaultAlertDiscountPercent,
    cooldownMs,
    logger,
  }) {
    this.mabinogiClient = mabinogiClient;
    this.itemStore = itemStore;
    this.settingsStore = settingsStore;
    this.resolveChannel = resolveChannel;
    this.intervalMs = intervalMs;
    this.defaultAlertDiscountPercent = toAlertDiscountPercent(defaultAlertDiscountPercent);
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.running = false;
    this.timer = null;
    this.checking = false;
    this.lastRunAt = null;
    this.nextRunAt = null;
    this.lastError = null;
    this.lastAlertAtByItem = new Map();
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.logger.info(`Price monitor started. interval=${Math.round(this.intervalMs / 1000)}s`);
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;
    this.logger.info("Price monitor stopped.");
  }

  getStatus() {
    return {
      running: this.running,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      lastError: this.lastError,
    };
  }

  clearCooldown(scopeId, itemName) {
    if (itemName === undefined) {
      itemName = scopeId;
      scopeId = "global";
    }

    this.lastAlertAtByItem.delete(this.buildCooldownKey(scopeId, itemName));
  }

  setIntervalMs(intervalMs) {
    this.intervalMs = intervalMs;
    this.logger.info(`Price monitor interval updated. interval=${Math.round(this.intervalMs / 1000)}s`);

    if (this.running && !this.checking) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.schedule(this.intervalMs);
    }
  }

  schedule(delayMs) {
    if (!this.running) {
      return;
    }

    this.nextRunAt = new Date(Date.now() + delayMs);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  async tick() {
    if (!this.running) {
      return;
    }

    if (this.checking) {
      this.logger.warn("Previous price check is still running. Skipping this tick.");
      this.schedule(this.intervalMs);
      return;
    }

    this.checking = true;
    try {
      await this.checkAll();
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      this.logger.error("Price monitor tick failed:", error);
    } finally {
      this.checking = false;
      this.lastRunAt = new Date();
      this.schedule(this.intervalMs);
    }
  }

  async checkAll() {
    const scopes = this.itemStore.getScopes();
    const itemCount = scopes.reduce((total, scopeData) => total + scopeData.items.length, 0);

    if (itemCount === 0) {
      this.logger.info("No monitoring items registered.");
      return;
    }

    if (!this.mabinogiClient.hasApiKey()) {
      this.logger.warn("Price check skipped: API_KEY or MABINOGI_API_KEY is not configured.");
      return;
    }

    this.logger.info(`Checking ${itemCount} monitoring item(s) for ${scopes.length} server scope(s).`);
    for (const scopeData of scopes) {
      for (const item of scopeData.items) {
        await this.checkItem(scopeData.scopeId, item);
        await sleep(250);
      }
    }
  }

  async checkItem(scopeId, item) {
    const alertDiscountPercent = this.settingsStore.getAlertDiscountPercent(scopeId, this.defaultAlertDiscountPercent);
    const alertDiscountRate = alertDiscountPercent / 100;
    let monitoringItem = normalizeMonitoringItem(item);
    if (!monitoringItem) {
      this.logger.warn(`Invalid monitoring item skipped. scope=${scopeId}`);
      return null;
    }

    let itemLabel = formatMonitoringItem(monitoringItem);
    try {
      if (!monitoringItem.category || !monitoringItem.listItemName) {
        monitoringItem = await this.resolveMonitoringItemCategory(scopeId, monitoringItem);
        itemLabel = formatMonitoringItem(monitoringItem);
      }
      if (!monitoringItem.category) {
        this.logger.warn(`${itemLabel}: auction category is not resolved. Skipping category-safe price check.`);
        return null;
      }

      const marketData = await this.mabinogiClient.fetchMarketData(monitoringItem);
      if (!marketData.found) {
        this.logger.warn(
          `${itemLabel}: insufficient auction data. raw=${marketData.rawCount}, matching=${marketData.matchingCount}`,
        );
        return null;
      }

      this.logger.info(
        `${itemLabel} -> ${marketData.resolvedItemName}: lowest=${marketData.lowestPrice.toLocaleString("ko-KR")}, next=${marketData.nextPrice.toLocaleString(
          "ko-KR",
        )}, discount=${formatPercent(marketData.discountRate)}, scope=${scopeId}, threshold=${alertDiscountPercent}%`,
      );

      if (marketData.discountRate >= alertDiscountRate) {
        await this.sendAlertIfAllowed(scopeId, marketData, alertDiscountPercent);
      } else {
        this.clearCooldown(scopeId, monitoringItem);
      }

      return marketData;
    } catch (error) {
      this.logger.error(`${itemLabel}: price check failed:`, error);
      return null;
    }
  }

  async resolveMonitoringItemCategory(scopeId, monitoringItem) {
    try {
      const itemCheck = await this.mabinogiClient.findAuctionItem(monitoringItem.itemName, {
        includeIncomplete: monitoringItem.includeIncomplete,
      });
      if (!itemCheck.found || !itemCheck.category) {
        return monitoringItem;
      }

      const resolvedItem = {
        itemName: itemCheck.resolvedItemName || monitoringItem.itemName,
        category: itemCheck.category,
        listItemName: itemCheck.listItemName,
        includeIncomplete: monitoringItem.includeIncomplete,
        searchTerms: itemCheck.searchTerms?.length > 0 ? itemCheck.searchTerms : monitoringItem.searchTerms,
      };
      const result = await this.itemStore.add(scopeId, resolvedItem);
      if (result.updatedExisting) {
        this.logger.info(`${monitoringItem.itemName}: auction category resolved as ${itemCheck.category}.`);
      }

      return normalizeMonitoringItem(resolvedItem) ?? monitoringItem;
    } catch (error) {
      this.logger.warn(`${monitoringItem.itemName}: failed to resolve auction category. ${error.message}`);
      return monitoringItem;
    }
  }

  async sendAlertIfAllowed(scopeId, marketData, alertDiscountPercent) {
    const key = this.buildCooldownKey(scopeId, {
      itemName: marketData.itemName,
      category: marketData.category,
      listItemName: marketData.listItemName,
      includeIncomplete: marketData.includeIncomplete,
      searchTerms: marketData.searchTerms,
    });
    const now = Date.now();
    const lastAlertAt = this.lastAlertAtByItem.get(key) ?? 0;

    if (this.cooldownMs > 0 && now - lastAlertAt < this.cooldownMs) {
      this.logger.info(`${marketData.itemName}: alert skipped by cooldown. scope=${scopeId}`);
      return;
    }

    let channel = null;
    try {
      channel = await this.resolveChannel(scopeId);
    } catch (error) {
      this.logger.warn(`Alert skipped: failed to resolve alert channel. scope=${scopeId}. ${error.message}`);
      return;
    }

    if (!channel) {
      this.logger.warn(`Alert skipped: no alert channel configured for scope=${scopeId}. Use /구마 and set this channel as the alert channel.`);
      return;
    }

    if (!channel?.isTextBased()) {
      this.logger.warn(`Alert skipped: configured Discord alert channel is not text-based. scope=${scopeId}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`가격 알림: ${marketData.resolvedItemName}`)
      .setColor(0xe03131)
      .setDescription(`기준가 대비 ${alertDiscountPercent}% 이상 낮은 매물을 찾았습니다.`)
      .addFields(
        ...(marketData.category ? [{ name: "자동 분류", value: marketData.category, inline: true }] : []),
        { name: "미완성 매물", value: marketData.includeIncomplete ? "포함" : "제외", inline: true },
        { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
        { name: "기준가(차순위)", value: formatGold(marketData.nextPrice), inline: true },
        { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
        { name: "서버 알림 기준", value: `${alertDiscountPercent}% 이상 낮을 때`, inline: false },
      )
      .setFooter({ text: "Nexon Open API 경매장 데이터 기준" })
      .setTimestamp(new Date());

    await channel.send({ content: `구마가 매물을 찾았습니다: **${marketData.resolvedItemName}**`, embeds: [embed] });
    this.lastAlertAtByItem.set(key, now);
    this.logger.info(`${marketData.itemName}: alert sent. scope=${scopeId}`);
  }

  buildCooldownKey(scopeId, itemName) {
    const normalized = normalizeMonitoringItem(itemName);
    const incompleteSuffix = normalized?.includeIncomplete ? ":include-incomplete" : "";
    return `${scopeId ?? "global"}:${monitoringItemKey(itemName)}${incompleteSuffix}`;
  }
}
