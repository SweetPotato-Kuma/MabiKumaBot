import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { formatDateTime, formatGold, formatItemList, formatPercent } from "./format.js";
import { normalizeItemName } from "./itemStore.js";

const ITEMS_PER_PAGE = 25;
const ITEM_INPUT_ID = "itemName";
const INTERVAL_INPUT_ID = "intervalSeconds";
const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 3600;

const CUSTOM_ID = {
  addButton: "kuma:add",
  removeButton: "kuma:remove",
  listButton: "kuma:list",
  statusButton: "kuma:status",
  alertChannelButton: "kuma:alert-channel",
  intervalButton: "kuma:interval",
  priceButton: "kuma:price",
  listPagePrefix: "kuma:list-page",
  listDeletePrefix: "kuma:list-delete",
  addModal: "kuma:add-modal",
  removeModal: "kuma:remove-modal",
  intervalModal: "kuma:interval-modal",
  priceModal: "kuma:price-modal",
};

export const commandBuilders = [
  new SlashCommandBuilder().setName("구마").setDescription("마비노기 경매장 모니터링을 관리합니다."),
];

export const applicationCommands = commandBuilders.map((command) => command.toJSON());

function privateReply(payload) {
  if (typeof payload === "string") {
    return { content: payload, flags: MessageFlags.Ephemeral };
  }

  return { ...payload, flags: MessageFlags.Ephemeral };
}

function clampPage(page, totalPages) {
  return Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));
}

function truncateOptionText(text, maxLength = 100) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function parsePageFromCustomId(customId, prefix) {
  const page = Number(customId.slice(prefix.length + 1));
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function buildMainPanel(context) {
  const { itemStore, settingsStore, mabinogiClient } = context;
  const alertChannelId = settingsStore.getAlertChannelId();
  const items = itemStore.getAll();
  const checkIntervalSeconds = Math.round(context.monitor.intervalMs / 1000);

  const embed = new EmbedBuilder()
    .setTitle("마비노기 쿠마봇")
    .setDescription("아래 버튼으로 모니터링 아이템, 알림 채널, 체크 간격을 관리할 수 있습니다.")
    .setColor(0x4c6ef5)
    .addFields(
      { name: "모니터링 아이템", value: items.length > 0 ? `${items.length}개 등록됨` : "아직 등록된 아이템이 없습니다.", inline: true },
      { name: "알림 채널", value: alertChannelId ? `<#${alertChannelId}>` : "미설정", inline: true },
      { name: "체크 간격", value: `${checkIntervalSeconds}초`, inline: true },
      { name: "API 키", value: mabinogiClient.hasApiKey() ? "설정됨" : "미설정", inline: true },
    );

  const firstRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.addButton).setLabel("아이템 추가").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.listButton).setLabel("목록/삭제").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.priceButton).setLabel("가격 확인").setStyle(ButtonStyle.Secondary),
  );

  const secondRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.alertChannelButton).setLabel("이 채널로 알림").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CUSTOM_ID.intervalButton).setLabel("체크 간격").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.statusButton).setLabel("상태").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [firstRow, secondRow] };
}

function buildListPanel(context, page = 0, notice = "") {
  const items = context.itemStore.getAll();
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const currentPage = clampPage(page, totalPages);
  const start = currentPage * ITEMS_PER_PAGE;
  const visibleItems = items.slice(start, start + ITEMS_PER_PAGE);

  const description =
    visibleItems.length > 0
      ? visibleItems.map((item, index) => `${start + index + 1}. ${item}`).join("\n")
      : "등록된 아이템이 없습니다.";

  const embed = new EmbedBuilder()
    .setTitle("모니터링 목록")
    .setDescription(description)
    .setColor(0x4c6ef5)
    .setFooter({ text: `${items.length}개 등록됨 · ${currentPage + 1}/${totalPages} 페이지` });

  if (notice) {
    embed.addFields({ name: "처리 결과", value: notice });
  }

  const components = [];

  if (visibleItems.length > 0) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID.listDeletePrefix}:${currentPage}`)
          .setPlaceholder("삭제할 아이템을 선택하세요.")
          .setMinValues(1)
          .setMaxValues(visibleItems.length)
          .addOptions(
            visibleItems.map((item, index) => ({
              label: truncateOptionText(item),
              value: String(start + index),
              description: "선택하면 목록에서 삭제됩니다.",
            })),
          ),
      ),
    );
  }

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID.listPagePrefix}:${currentPage - 1}`)
          .setLabel("이전")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID.listPagePrefix}:${currentPage + 1}`)
          .setLabel("다음")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1),
      ),
    );
  }

  return { embeds: [embed], components };
}

function buildItemModal({ customId, title, label, placeholder }) {
  const input = new TextInputBuilder()
    .setCustomId(ITEM_INPUT_ID)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildMarketEmbed(marketData, threshold) {
  const isAlert = marketData.lowestPrice <= marketData.nextPrice * threshold;
  const title =
    marketData.resolvedItemName && marketData.resolvedItemName !== marketData.itemName
      ? `경매장 가격 확인: ${marketData.itemName} → ${marketData.resolvedItemName}`
      : `경매장 가격 확인: ${marketData.itemName}`;

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(isAlert ? 0xe03131 : 0x2f9e44)
    .addFields(
      { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
      { name: "차순위 가격", value: formatGold(marketData.nextPrice), inline: true },
      { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
      { name: "알림 기준", value: `최저가가 차순위의 ${formatPercent(threshold)} 이하`, inline: false },
    )
    .setFooter({ text: `검색 결과 ${marketData.matchingCount}개 중 최저 2개 기준` })
    .setTimestamp(new Date());
}

function buildStatusText(context) {
  const { config, itemStore, settingsStore, mabinogiClient, monitor } = context;
  const status = monitor.getStatus();
  const alertChannelId = settingsStore.getAlertChannelId();

  return [
    `상태: ${status.running ? "실행 중" : "중지됨"}`,
    `아이템 수: ${itemStore.getAll().length}`,
    `알림 채널: ${alertChannelId ? `<#${alertChannelId}>` : "미설정"}`,
    `마비노기 API 키: ${mabinogiClient.hasApiKey() ? "설정됨" : "미설정"}`,
    `체크 간격: ${Math.round(monitor.intervalMs / 1000)}초`,
    `알림 기준: 차순위 가격의 ${formatPercent(config.alertDiscountThreshold)} 이하`,
    `마지막 체크: ${formatDateTime(status.lastRunAt)}`,
    `다음 체크: ${formatDateTime(status.nextRunAt)}`,
    `마지막 오류: ${status.lastError ?? "없음"}`,
  ].join("\n");
}

async function setCurrentChannelAsAlert(interaction, settingsStore) {
  if (!interaction.channel?.isTextBased()) {
    await interaction.reply(privateReply("텍스트를 보낼 수 있는 채널에서만 알림 채널을 설정할 수 있습니다."));
    return;
  }

  await settingsStore.setAlertChannelId(interaction.channelId);
  await interaction.reply(privateReply(`알림 채널을 설정했습니다: <#${interaction.channelId}>`));
}

async function addMonitoringItem(interaction, context, rawItemName) {
  const { itemStore, mabinogiClient, monitor } = context;
  const normalizedInput = normalizeItemName(rawItemName);

  if (!normalizedInput) {
    await interaction.editReply("아이템 이름을 입력해 주세요.");
    return;
  }

  const resolvedItemName = await mabinogiClient.resolveItemName(normalizedInput);
  const result = await itemStore.add(resolvedItemName);

  if (!result.added) {
    const suffix = result.updatedExisting ? "\n기존 항목 표기를 더 정확한 이름으로 정리했습니다." : "";
    await interaction.editReply(`이미 모니터링 중입니다: ${result.existingItem ?? resolvedItemName}${suffix}`);
    return;
  }

  monitor.clearCooldown(resolvedItemName);
  const resolvedNote = resolvedItemName !== normalizedInput ? `\n입력값: ${normalizedInput}\n매칭명: ${resolvedItemName}` : "";
  await interaction.editReply(`추가 완료: ${resolvedItemName}${resolvedNote}\n\n현재 목록:\n${formatItemList(result.items)}`);
}

async function handleChatInputCommand(interaction, context) {
  if (interaction.commandName !== "구마") {
    return;
  }

  await interaction.reply(privateReply(buildMainPanel(context)));
}

async function handleButton(interaction, context) {
  const { itemStore, settingsStore } = context;

  if (interaction.customId === CUSTOM_ID.addButton) {
    await interaction.showModal(
      buildItemModal({
        customId: CUSTOM_ID.addModal,
        title: "모니터링 아이템 추가",
        label: "추가할 아이템 이름",
        placeholder: "예: 마나 허브",
      }),
    );
    return;
  }

  if (interaction.customId === CUSTOM_ID.removeButton) {
    await interaction.showModal(
      buildItemModal({
        customId: CUSTOM_ID.removeModal,
        title: "모니터링 아이템 제거",
        label: "제거할 아이템 이름",
        placeholder: "예: 마나 허브",
      }),
    );
    return;
  }

  if (interaction.customId === CUSTOM_ID.listButton) {
    await interaction.reply(privateReply(buildListPanel(context)));
    return;
  }

  if (interaction.customId.startsWith(`${CUSTOM_ID.listPagePrefix}:`)) {
    const page = parsePageFromCustomId(interaction.customId, CUSTOM_ID.listPagePrefix);
    await interaction.update(buildListPanel(context, page));
    return;
  }

  if (interaction.customId === CUSTOM_ID.statusButton) {
    await interaction.reply(privateReply(buildStatusText(context)));
    return;
  }

  if (interaction.customId === CUSTOM_ID.alertChannelButton) {
    await setCurrentChannelAsAlert(interaction, settingsStore);
    return;
  }

  if (interaction.customId === CUSTOM_ID.intervalButton) {
    const input = new TextInputBuilder()
      .setCustomId(INTERVAL_INPUT_ID)
      .setLabel("체크 간격(초)")
      .setPlaceholder("예: 10")
      .setValue(String(Math.round(context.monitor.intervalMs / 1000)))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(4);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(CUSTOM_ID.intervalModal)
        .setTitle("체크 간격 설정")
        .addComponents(new ActionRowBuilder().addComponents(input)),
    );
    return;
  }

  if (interaction.customId === CUSTOM_ID.priceButton) {
    await interaction.showModal(
      buildItemModal({
        customId: CUSTOM_ID.priceModal,
        title: "경매장 가격 확인",
        label: "확인할 아이템 이름",
        placeholder: "예: 마나허브",
      }),
    );
  }
}

async function handleSelectMenu(interaction, context) {
  if (!interaction.customId.startsWith(`${CUSTOM_ID.listDeletePrefix}:`)) {
    return;
  }

  const page = parsePageFromCustomId(interaction.customId, CUSTOM_ID.listDeletePrefix);
  const items = context.itemStore.getAll();
  const selectedItems = interaction.values.map((value) => items[Number(value)]).filter(Boolean);
  const result = await context.itemStore.removeMany(selectedItems);

  for (const itemName of result.removedItems) {
    context.monitor.clearCooldown(itemName);
  }

  const totalPages = Math.max(1, Math.ceil(result.items.length / ITEMS_PER_PAGE));
  const nextPage = clampPage(page, totalPages);
  const notice = result.removed
    ? `삭제 완료: ${result.removedItems.join(", ")}`
    : "삭제할 항목을 찾지 못했습니다.";

  await interaction.update(buildListPanel(context, nextPage, notice));
}

async function handleModalSubmit(interaction, context) {
  const { itemStore, settingsStore, mabinogiClient, monitor, config } = context;

  if (interaction.customId === CUSTOM_ID.intervalModal) {
    const rawSeconds = interaction.fields.getTextInputValue(INTERVAL_INPUT_ID).trim();
    const intervalSeconds = Number(rawSeconds);

    if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS || intervalSeconds > MAX_INTERVAL_SECONDS) {
      await interaction.reply(
        privateReply(`체크 간격은 ${MIN_INTERVAL_SECONDS}초부터 ${MAX_INTERVAL_SECONDS}초까지의 정수로 입력해 주세요.`),
      );
      return;
    }

    const intervalMs = intervalSeconds * 1000;
    await settingsStore.setCheckIntervalMs(intervalMs);
    monitor.setIntervalMs(intervalMs);
    await interaction.reply(privateReply(`체크 간격을 ${intervalSeconds}초로 설정했습니다.`));
    return;
  }

  const itemName = normalizeItemName(interaction.fields.getTextInputValue(ITEM_INPUT_ID));

  if (interaction.customId === CUSTOM_ID.addModal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await addMonitoringItem(interaction, context, itemName);
    return;
  }

  if (interaction.customId === CUSTOM_ID.removeModal) {
    const result = await itemStore.remove(itemName);

    if (!result.removed) {
      await interaction.reply(privateReply(`목록에 없는 아이템입니다: ${itemName}`));
      return;
    }

    monitor.clearCooldown(itemName);
    await interaction.reply(privateReply(`제거 완료: ${itemName}\n\n현재 목록:\n${formatItemList(result.items)}`));
    return;
  }

  if (interaction.customId === CUSTOM_ID.priceModal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!mabinogiClient.hasApiKey()) {
      await interaction.editReply("마비노기 가격 조회를 하려면 `.env`에 `API_KEY` 또는 `MABINOGI_API_KEY`를 추가해야 합니다.");
      return;
    }

    const marketData = await mabinogiClient.fetchMarketData(itemName);
    if (!marketData.found) {
      await interaction.editReply(
        [
          `가격 정보를 충분히 찾지 못했습니다: ${itemName}`,
          `검색 결과: ${marketData.rawCount}개, 이름 일치: ${marketData.matchingCount}개`,
          `시도한 검색어: ${marketData.searchKeywords.join(", ")}`,
        ].join("\n"),
      );
      return;
    }

    await interaction.editReply({ embeds: [buildMarketEmbed(marketData, config.alertDiscountThreshold)] });
  }
}

export async function handleInteraction(interaction, context) {
  if (interaction.isChatInputCommand()) {
    await handleChatInputCommand(interaction, context);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction, context);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction, context);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, context);
  }
}
