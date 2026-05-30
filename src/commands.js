import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { formatDateTime, formatGold, formatItemList, formatPercent } from "./format.js";
import { normalizeItemName } from "./itemStore.js";

const ITEM_OPTION_NAME = "아이템";
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
  addModal: "kuma:add-modal",
  removeModal: "kuma:remove-modal",
  intervalModal: "kuma:interval-modal",
};

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("구마")
    .setDescription("버튼 UI로 모니터링 아이템, 알림 채널, 체크 간격을 관리합니다."),
  new SlashCommandBuilder()
    .setName("추가")
    .setDescription("마비노기 경매장 모니터링 아이템을 추가합니다.")
    .addStringOption((option) => option.setName(ITEM_OPTION_NAME).setDescription("추가할 아이템 이름").setRequired(true)),
  new SlashCommandBuilder()
    .setName("제거")
    .setDescription("마비노기 경매장 모니터링 아이템을 제거합니다.")
    .addStringOption((option) => option.setName(ITEM_OPTION_NAME).setDescription("제거할 아이템 이름").setRequired(true)),
  new SlashCommandBuilder().setName("목록").setDescription("현재 모니터링 중인 아이템 목록을 봅니다."),
  new SlashCommandBuilder().setName("상태").setDescription("봇과 모니터링 루프 상태를 확인합니다."),
  new SlashCommandBuilder()
    .setName("알림채널")
    .setDescription("특가 알림을 보낼 Discord 채널을 설정하거나 확인합니다.")
    .addSubcommand((subcommand) => subcommand.setName("설정").setDescription("현재 채널을 특가 알림 채널로 설정합니다."))
    .addSubcommand((subcommand) => subcommand.setName("보기").setDescription("현재 특가 알림 채널을 확인합니다."))
    .addSubcommand((subcommand) => subcommand.setName("해제").setDescription("특가 알림 채널 설정을 해제합니다.")),
  new SlashCommandBuilder()
    .setName("가격확인")
    .setDescription("아이템의 현재 경매장 최저가와 차순위 가격을 확인합니다.")
    .addStringOption((option) => option.setName(ITEM_OPTION_NAME).setDescription("확인할 아이템 이름").setRequired(true)),
];

export const applicationCommands = commandBuilders.map((command) => command.toJSON());

function privateReply(payload) {
  if (typeof payload === "string") {
    return { content: payload, flags: MessageFlags.Ephemeral };
  }

  return { ...payload, flags: MessageFlags.Ephemeral };
}

function buildRegistrationPanel(context) {
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
    new ButtonBuilder().setCustomId(CUSTOM_ID.removeButton).setLabel("아이템 제거").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CUSTOM_ID.listButton).setLabel("목록 보기").setStyle(ButtonStyle.Secondary),
  );

  const secondRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.alertChannelButton).setLabel("이 채널로 알림").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CUSTOM_ID.intervalButton).setLabel("체크 간격").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.statusButton).setLabel("상태").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [firstRow, secondRow] };
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
  return new EmbedBuilder()
    .setTitle(`경매장 가격 확인: ${marketData.itemName}`)
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

async function handleChatInputCommand(interaction, context) {
  const { commandName } = interaction;
  const { itemStore, settingsStore, mabinogiClient, monitor, config } = context;

  if (commandName === "구마") {
    await interaction.reply(privateReply(buildRegistrationPanel(context)));
    return;
  }

  if (commandName === "추가") {
    const itemName = normalizeItemName(interaction.options.getString(ITEM_OPTION_NAME, true));
    const result = await itemStore.add(itemName);

    if (!result.added) {
      const message = result.reason === "duplicate" ? `이미 모니터링 중입니다: ${itemName}` : "아이템 이름을 입력해 주세요.";
      await interaction.reply(privateReply(message));
      return;
    }

    monitor.clearCooldown(itemName);
    await interaction.reply(privateReply(`추가 완료: ${itemName}\n\n현재 목록:\n${formatItemList(result.items)}`));
    return;
  }

  if (commandName === "제거") {
    const itemName = normalizeItemName(interaction.options.getString(ITEM_OPTION_NAME, true));
    const result = await itemStore.remove(itemName);

    if (!result.removed) {
      await interaction.reply(privateReply(`목록에 없는 아이템입니다: ${itemName}`));
      return;
    }

    monitor.clearCooldown(itemName);
    await interaction.reply(privateReply(`제거 완료: ${itemName}\n\n현재 목록:\n${formatItemList(result.items)}`));
    return;
  }

  if (commandName === "목록") {
    await interaction.reply(privateReply(`현재 모니터링 중인 아이템:\n${formatItemList(itemStore.getAll())}`));
    return;
  }

  if (commandName === "상태") {
    await interaction.reply(privateReply(buildStatusText(context)));
    return;
  }

  if (commandName === "알림채널") {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "설정") {
      await setCurrentChannelAsAlert(interaction, settingsStore);
      return;
    }

    if (subcommand === "보기") {
      const alertChannelId = settingsStore.getAlertChannelId();
      await interaction.reply(privateReply(alertChannelId ? `현재 알림 채널: <#${alertChannelId}>` : "알림 채널이 아직 설정되지 않았습니다."));
      return;
    }

    if (subcommand === "해제") {
      await settingsStore.clearAlertChannelId();
      await interaction.reply(privateReply("알림 채널 설정을 해제했습니다."));
      return;
    }
  }

  if (commandName === "가격확인") {
    const itemName = normalizeItemName(interaction.options.getString(ITEM_OPTION_NAME, true));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!mabinogiClient.hasApiKey()) {
      await interaction.editReply("마비노기 가격 조회를 하려면 `.env`에 `API_KEY` 또는 `MABINOGI_API_KEY`를 추가해야 합니다.");
      return;
    }

    const marketData = await mabinogiClient.fetchMarketData(itemName);
    if (!marketData.found) {
      await interaction.editReply(
        `가격 정보를 충분히 찾지 못했습니다: ${itemName}\n검색 결과: ${marketData.rawCount}개, 이름 일치: ${marketData.matchingCount}개`,
      );
      return;
    }

    await interaction.editReply({ embeds: [buildMarketEmbed(marketData, config.alertDiscountThreshold)] });
  }
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
    await interaction.reply(privateReply(`현재 모니터링 중인 아이템:\n${formatItemList(itemStore.getAll())}`));
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
  }
}

async function handleModalSubmit(interaction, context) {
  const { itemStore, settingsStore, monitor } = context;

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
    const result = await itemStore.add(itemName);

    if (!result.added) {
      const message = result.reason === "duplicate" ? `이미 모니터링 중입니다: ${itemName}` : "아이템 이름을 입력해 주세요.";
      await interaction.reply(privateReply(message));
      return;
    }

    monitor.clearCooldown(itemName);
    await interaction.reply(privateReply(`추가 완료: ${itemName}\n\n현재 목록:\n${formatItemList(result.items)}`));
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

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, context);
  }
}
