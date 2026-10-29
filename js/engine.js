import { CHAPTERS, TEST_NODES, resolveCampaignEnding } from "./story.js?v=34";

const SLOT_COUNT = 5;
const SLOTS_KEY = "kokonoe-haru-slots-v29";
const AUTOSAVE_KEY = "kokonoe-haru-auto-v29";
const LEGACY_SAVE_KEYS = ["kokonoe-haru-save-v28", "kokonoe-haru-save-v27", "kokonoe-haru-save-v26"];
const LOG_LIMIT = 100;
const DEFAULT_PLAYER_NAME = "尘";
/** 单框建议字数；超出则按句拆开依次显示 */
const DIALOGUE_CHUNK_MAX = 34;

function buildHonor(name) {
  const n = String(name || "").trim();
  if (!n) return `${DEFAULT_PLAYER_NAME}先生`;
  if (/(先生|小姐|女士|老师|桑)$/.test(n)) return n;
  return `${n}先生`;
}

/**
 * 把长段落拆成短对话框：优先按句号等断句，单句仍过长再按逗号切开。
 */
function splitDialogueChunks(text, maxLen = DIALOGUE_CHUNK_MAX) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return [];
  if (raw.length <= maxLen) return [raw];

  const byBreak = raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pieces = [];
  for (const block of byBreak) {
    const sentences = block.match(/[^。！？；…]+[。！？；…]+|[^。！？；…]+$/g) || [block];
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;
      if (s.length <= maxLen) {
        pieces.push(s);
        continue;
      }
      let rest = s;
      while (rest.length > maxLen) {
        const window = rest.slice(0, maxLen + 1);
        let cut = Math.max(
          window.lastIndexOf("，"),
          window.lastIndexOf("、"),
          window.lastIndexOf("："),
          window.lastIndexOf("——"),
          window.lastIndexOf(","),
          window.lastIndexOf(" ")
        );
        if (cut < Math.floor(maxLen * 0.45)) {
          cut = maxLen;
        } else if (rest.slice(cut, cut + 2) === "——") {
          cut += 2;
        } else {
          cut += 1;
        }
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) pieces.push(rest);
    }
  }

  const merged = [];
  for (const part of pieces) {
    const prev = merged[merged.length - 1];
    if (prev && prev.length + part.length <= Math.floor(maxLen * 0.85)) {
      merged[merged.length - 1] = prev + part;
    } else {
      merged.push(part);
    }
  }
  return merged.length ? merged : [raw];
}

function expandLinesForDisplay(lines) {
  const out = [];
  for (const line of lines || []) {
    if (!line || line.askName || (!line.text && (line.revealSprite || line.hideSprite || line.mood))) {
      if (line) out.push(line);
      continue;
    }
    if (!line.text) {
      out.push(line);
      continue;
    }
    const chunks = splitDialogueChunks(line.text);
    chunks.forEach((text, index) => {
      out.push({
        ...line,
        text,
        revealSprite: index === 0 ? line.revealSprite : undefined,
        hideSprite: index === 0 ? line.hideSprite : undefined,
        mood: index === 0 ? line.mood : undefined,
      });
    });
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function tierLabel(intimacy) {
  if (intimacy >= 80) return "羁绊";
  if (intimacy >= 60) return "亲密";
  if (intimacy >= 40) return "信赖";
  if (intimacy >= 20) return "熟识";
  return "相识";
}

function defaultResume() {
  return {
    mode: "idle",
    lineIndex: 0,
    choiceIndex: null,
  };
}

/**
 * 线性章节制：每章 scenes 按顺序只播一次，不随机、不重复。
 * 存档可恢复到具体台词行 / 选项等待 / 选项回复。
 */
export class GalEngine {
  constructor({ ui }) {
    this.ui = ui;
    this.ready = true;

    this.chapterIndex = 0;
    this.sceneIndex = 0;
    this.intimacy = 0;
    this.safety = 35;
    this.flags = [];
    this.ended = false;

    this.awaitingChoice = false;
    this.typing = false;
    this.fullText = "";
    this.charIndex = 0;
    this.typeTimer = null;
    this._waitingAdvance = false;
    this.cps = 36;
    this.phase = "idle";
    this.log = [];
    this.playerName = DEFAULT_PLAYER_NAME;
    this.playerHonor = buildHonor(DEFAULT_PLAYER_NAME);
    this.awaitingName = false;

    this.resume = defaultResume();
    this.lineQueue = [];
    this._activeSlot = null;
  }

  setPlayerName(raw) {
    const name = String(raw || "")
      .trim()
      .replace(/\s+/g, "")
      .slice(0, 8);
    this.playerName = name || DEFAULT_PLAYER_NAME;
    this.playerHonor = buildHonor(this.playerName);
  }

  fillTemplate(text) {
    return String(text || "")
      .replaceAll("{name}", this.playerName)
      .replaceAll("{honor}", this.playerHonor);
  }

  pushLog(speaker, text) {
    const entry = {
      speaker: this.fillTemplate(speaker || ""),
      text: this.fillTemplate(text || ""),
    };
    if (!entry.text) return;
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) {
      this.log.splice(0, this.log.length - LOG_LIMIT);
    }
  }

  getLog() {
    return this.log.map((entry) => ({
      speaker: this.fillTemplate(entry.speaker),
      text: this.fillTemplate(entry.text),
    }));
  }

  async init() {
    this.ready = true;
  }

  get chapter() {
    return CHAPTERS[this.chapterIndex] || null;
  }

  get currentCard() {
    const scenes = this.chapter?.scenes || [];
    return scenes[this.sceneIndex] || null;
  }

  clearPlayback() {
    this.stopTyping();
    this._waitingAdvance = false;
    this.awaitingChoice = false;
    this.awaitingName = false;
    this.lineQueue = [];
    this.resume = defaultResume();
    this.ui.hideChoices();
    this.ui.closeNamePrompt?.();
    this.ui.setClickHint(false);
  }

  reset() {
    this.clearPlayback();
    this._activeSlot = null;
    this.chapterIndex = 0;
    this.sceneIndex = 0;
    this.intimacy = 0;
    this.safety = 35;
    this.flags = [];
    this.ended = false;
    this.phase = "idle";
    this.log = [];
    this.playerName = DEFAULT_PLAYER_NAME;
    this.playerHonor = buildHonor(DEFAULT_PLAYER_NAME);
    this.ui.hideEnding();
    this.ui.closeLog?.();
    this.ui.closeSaveSlots?.();
    this.syncHud(false);
  }

  async start() {
    if (!this.ready) await this.init();
    this.reset();
    this.ui.showGame();
    this.beginChapter();
  }

  getTestNodes() {
    return TEST_NODES.map((node) => {
      const chapterIndex = CHAPTERS.findIndex((c) => c.id === node.chapterId);
      return { ...node, chapterIndex };
    }).filter((node) => node.chapterIndex >= 0);
  }

  async startAtNode(nodeId) {
    if (!this.ready) await this.init();
    const node = this.getTestNodes().find((n) => n.id === nodeId);
    if (!node) {
      this.ui.toast("找不到该测试节点。");
      return false;
    }
    this.reset();
    this.chapterIndex = node.chapterIndex;
    this.sceneIndex = 0;
    this.intimacy = clamp(Number(node.intimacy) || 0, 0, 100);
    this.safety = clamp(Number(node.safety) || 35, 0, 100);
    this.flags = Array.isArray(node.flags) ? [...node.flags] : [];
    if (node.chapterId !== "meet") {
      this.setPlayerName(DEFAULT_PLAYER_NAME);
    }
    this.ui.showGame();
    this.syncHud(false);
    this.beginChapter();
    return true;
  }

  getState() {
    return {
      version: 29,
      chapterIndex: this.chapterIndex,
      sceneIndex: this.sceneIndex,
      intimacy: this.intimacy,
      safety: this.safety,
      flags: [...this.flags],
      ended: this.ended,
      playerName: this.playerName,
      playerHonor: this.playerHonor,
      resume: {
        mode: this.resume.mode,
        lineIndex: this.resume.lineIndex,
        choiceIndex: this.resume.choiceIndex,
      },
      log: this.log.slice(-LOG_LIMIT),
    };
  }

  buildSaveMeta(state) {
    const ch = CHAPTERS[state.chapterIndex];
    const lastLog = [...(state.log || [])].reverse().find((e) => e?.text);
    return {
      chapterLabel: ch?.label || "—",
      timeLabel: ch?.timeLabel || "",
      preview: String(lastLog?.text || "……").slice(0, 40),
      intimacy: state.intimacy,
      safety: state.safety,
    };
  }

  readSlotStore() {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const slots = Array.from({ length: SLOT_COUNT }, (_, i) => data.slots?.[i] ?? null);
        return {
          slots,
          lastSlot:
            data.lastSlot === null || data.lastSlot === undefined ? null : Number(data.lastSlot),
        };
      }
    } catch {
      /* ignore */
    }
    return { slots: Array.from({ length: SLOT_COUNT }, () => null), lastSlot: null };
  }

  writeSlotStore(store) {
    localStorage.setItem(
      SLOTS_KEY,
      JSON.stringify({
        slots: Array.from({ length: SLOT_COUNT }, (_, i) => store.slots?.[i] ?? null),
        lastSlot: store.lastSlot ?? null,
      })
    );
  }

  migrateLegacySaves() {
    const store = this.readSlotStore();
    if (store.slots.some(Boolean)) return store;
    for (const key of LEGACY_SAVE_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const state = JSON.parse(raw);
        if (!state || typeof state !== "object") continue;
        store.slots[0] = {
          savedAt: Date.now(),
          meta: this.buildSaveMeta({
            ...state,
            log: Array.isArray(state.log) ? state.log : [],
          }),
          state,
        };
        store.lastSlot = 0;
        this.writeSlotStore(store);
        break;
      } catch {
        /* ignore */
      }
    }
    return store;
  }

  formatSavedAt(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  listSlots() {
    const store = this.migrateLegacySaves();
    return store.slots.map((slot, index) => ({
      index,
      empty: !slot,
      savedAt: slot?.savedAt || null,
      savedAtLabel: this.formatSavedAt(slot?.savedAt),
      chapterLabel: slot?.meta?.chapterLabel || "",
      timeLabel: slot?.meta?.timeLabel || "",
      preview: slot?.meta?.preview || "",
      intimacy: slot?.meta?.intimacy,
      safety: slot?.meta?.safety,
    }));
  }

  canCaptureProgress() {
    if (this.ended) return { ok: false, reason: "结局画面无法保存，请重新开始。" };
    if (this.resume.mode === "idle" && this.phase === "idle") {
      return { ok: false, reason: "当前没有可保存的进度。" };
    }
    return { ok: true };
  }

  saveToSlot(index, { toast = true } = {}) {
    const check = this.canCaptureProgress();
    if (!check.ok) {
      if (toast) this.ui.toast(check.reason);
      return false;
    }
    const slotIndex = clamp(Number(index) || 0, 0, SLOT_COUNT - 1);
    try {
      const state = this.getState();
      const store = this.readSlotStore();
      store.slots[slotIndex] = {
        savedAt: Date.now(),
        meta: this.buildSaveMeta(state),
        state,
      };
      store.lastSlot = slotIndex;
      this.writeSlotStore(store);
      this._activeSlot = slotIndex;
      this.writeAutosave(false);
      if (toast) this.ui.toast(`已保存到槽位 ${slotIndex + 1}。`);
      return true;
    } catch {
      if (toast) this.ui.toast("保存失败，请检查浏览器存储权限。");
      return false;
    }
  }

  writeAutosave(toast = false) {
    const check = this.canCaptureProgress();
    if (!check.ok) return false;
    try {
      const state = this.getState();
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          meta: this.buildSaveMeta(state),
          state,
          slotHint: this._activeSlot,
        })
      );
      if (toast) this.ui.toast("已自动保存。");
      return true;
    } catch {
      return false;
    }
  }

  autosave() {
    if (this.ended || this.resume.mode === "idle") return false;
    return this.writeAutosave(false);
  }

  /** 菜单「保存」：交给 UI 打开五槽面板 */
  requestSavePanel() {
    const check = this.canCaptureProgress();
    if (!check.ok) {
      this.ui.toast(check.reason);
      return false;
    }
    this.ui.openSaveSlots?.({
      mode: "save",
      slots: this.listSlots(),
      hint: "点空槽写入；点已有槽位将覆盖该存档。",
    });
    return true;
  }

  requestLoadPanel({ fromTitle = false } = {}) {
    const slots = this.listSlots();
    if (!slots.some((s) => !s.empty) && !this.readAutosaveEntry()) {
      this.ui.toast("没有可读取的进度。");
      return false;
    }
    this.ui.openSaveSlots?.({
      mode: "load",
      slots,
      fromTitle,
      hint: "选择一个存档读取。",
    });
    return true;
  }

  readAutosaveEntry() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.state) return null;
      return data;
    } catch {
      return null;
    }
  }

  hasSave() {
    this.migrateLegacySaves();
    if (this.listSlots().some((s) => !s.empty)) return true;
    return Boolean(this.readAutosaveEntry());
  }

  findLatestEntry() {
    this.migrateLegacySaves();
    const candidates = [];
    const store = this.readSlotStore();
    store.slots.forEach((slot, index) => {
      if (slot?.state) {
        candidates.push({ kind: "slot", index, savedAt: slot.savedAt || 0, entry: slot });
      }
    });
    const auto = this.readAutosaveEntry();
    if (auto?.state) {
      candidates.push({ kind: "auto", index: null, savedAt: auto.savedAt || 0, entry: auto });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.savedAt - a.savedAt);
    return candidates[0];
  }

  async load() {
    const latest = this.findLatestEntry();
    if (!latest) {
      this.ui.toast("没有可读取的进度。");
      return false;
    }
    if (latest.kind === "slot") return this.loadFromSlot(latest.index);
    return this.applyLoadedState(latest.entry.state, { toast: "已读取最近进度。" });
  }

  async loadFromSlot(index) {
    const store = this.readSlotStore();
    const slot = store.slots[clamp(Number(index) || 0, 0, SLOT_COUNT - 1)];
    if (!slot?.state) {
      this.ui.toast("该槽位没有存档。");
      return false;
    }
    this._activeSlot = clamp(Number(index) || 0, 0, SLOT_COUNT - 1);
    store.lastSlot = this._activeSlot;
    this.writeSlotStore(store);
    return this.applyLoadedState(slot.state, { toast: `已读取槽位 ${this._activeSlot + 1}。` });
  }

  async applyLoadedState(data, { toast = "进度已读取。" } = {}) {
    try {
      this.clearPlayback();
      this.ended = false;
      this.chapterIndex = clamp(Number(data.chapterIndex) || 0, 0, Math.max(CHAPTERS.length - 1, 0));
      this.sceneIndex = Math.max(0, Number(data.sceneIndex) || 0);
      this.intimacy = clamp(Number(data.intimacy) || 0, 0, 100);
      this.safety = clamp(Number(data.safety) || 35, 0, 100);
      this.flags = Array.isArray(data.flags) ? [...data.flags] : [];
      this.log = Array.isArray(data.log)
        ? data.log
            .filter((e) => e && typeof e.text === "string")
            .map((e) => ({
              speaker: String(e.speaker || ""),
              text: String(e.text || ""),
            }))
            .slice(-LOG_LIMIT)
        : [];
      this.setPlayerName(data.playerName || DEFAULT_PLAYER_NAME);
      if (data.playerHonor) this.playerHonor = String(data.playerHonor);

      const resume = data.resume && typeof data.resume === "object" ? data.resume : null;
      this.ui.hideEnding();
      this.ui.closeLog?.();
      this.ui.closeSaveSlots?.();
      this.ui.closeMenu?.();
      this.ui.showGame();
      this.syncHud(false);
      if (toast) this.ui.toast(toast);

      if (resume && resume.mode && resume.mode !== "idle") {
        this.resume = {
          mode: String(resume.mode),
          lineIndex: Math.max(0, Number(resume.lineIndex) || 0),
          choiceIndex:
            resume.choiceIndex === null || resume.choiceIndex === undefined
              ? null
              : Number(resume.choiceIndex),
        };
        this.restoreFromResume();
      } else {
        this.playCurrentScene();
      }
      return true;
    } catch {
      this.ui.toast("存档损坏，无法读取。");
      return false;
    }
  }

  applyCardVisuals(card) {
    if (!card) return;
    if (card.scene) this.ui.setScene(card.scene);
    if (typeof card.showSprite === "boolean") {
      this.ui.setSpriteVisible(card.showSprite, card.mood || "neutral");
    } else {
      this.ui.setSpriteVisible(true, card.mood || "neutral");
    }
    this.phase = card.id || `scene_${this.sceneIndex}`;
  }

  restoreFromResume() {
    const mode = this.resume.mode;
    if (mode === "bridge") {
      this.showBridge();
      return;
    }
    if (mode === "chapterIntro") {
      this.startChapterIntro({ resume: true });
      return;
    }

    const card = this.currentCard;
    if (!card) {
      if (this.sceneIndex >= (this.chapter?.scenes || []).length) {
        this.showBridge();
      } else {
        this.playCurrentScene();
      }
      return;
    }
    this.applyCardVisuals(card);

    if (mode === "choice") {
      this.showCardChoices(card);
      return;
    }

    if (mode === "reply") {
      const choice = card.choices?.[this.resume.choiceIndex];
      if (!choice) {
        this.showCardChoices(card);
        return;
      }
      this.lineQueue = expandLinesForDisplay(choice.reply || []);
      this.resume.mode = "reply";
      this.playLineAt(this.resume.lineIndex, { skipLog: true, instant: true });
      return;
    }

    if (mode === "name" || mode === "lines") {
      this.lineQueue = expandLinesForDisplay(card.lines || []);
      this.resume.mode = mode === "name" ? "name" : "lines";
      this.playLineAt(this.resume.lineIndex, { skipLog: true, instant: true });
      return;
    }

    this.playCurrentScene();
  }

  syncHud(bump = false) {
    const ch = this.chapter;
    this.ui.setStatus({
      chapterLabel: ch?.label || "—",
      timeLabel: ch?.timeLabel || "",
      intimacy: this.intimacy,
      tier: tierLabel(this.intimacy),
      safety: this.safety,
      bump,
    });
  }

  addFlag(flag) {
    if (flag && !this.flags.includes(flag)) this.flags.push(flag);
  }

  applyDelta({ intimacy = 0, safety = 0 } = {}) {
    this.intimacy = clamp(this.intimacy + intimacy, 0, 100);
    this.safety = clamp(this.safety + safety, 0, 100);
    this.syncHud(intimacy !== 0 || safety !== 0);
  }

  beginChapter() {
    const ch = this.chapter;
    if (!ch) {
      this.finishCampaign();
      return;
    }
    this.sceneIndex = 0;
    this.phase = "scene";
    this.syncHud(false);
    this.startChapterIntro({ resume: false });
  }

  startChapterIntro({ resume = false } = {}) {
    const ch = this.chapter;
    if (!ch) {
      this.finishCampaign();
      return;
    }
    this.lineQueue = expandLinesForDisplay([
      {
        speaker: "",
        text: `【${ch.label}】\n${ch.timeLabel}`,
      },
    ]);
    this.resume.mode = "chapterIntro";
    this.resume.choiceIndex = null;
    if (!resume) this.resume.lineIndex = 0;
    this.playLineAt(this.resume.lineIndex, {
      skipLog: resume,
      instant: resume,
    });
  }

  playCurrentScene() {
    const ch = this.chapter;
    if (!ch) {
      this.finishCampaign();
      return;
    }
    const scenes = ch.scenes || [];
    if (this.sceneIndex >= scenes.length) {
      this.showBridge();
      return;
    }
    const card = scenes[this.sceneIndex];
    this.applyCardVisuals(card);
    this.lineQueue = expandLinesForDisplay(card.lines || []);
    this.resume.mode = "lines";
    this.resume.lineIndex = 0;
    this.resume.choiceIndex = null;
    this.playLineAt(0);
  }

  advanceScene() {
    this.sceneIndex += 1;
    const scenes = this.chapter?.scenes || [];
    if (this.sceneIndex >= scenes.length) {
      this.showBridge();
    } else {
      this.playCurrentScene();
    }
    this.autosave();
  }

  showBridge() {
    const isLast = this.chapterIndex >= CHAPTERS.length - 1;
    if (isLast) {
      this.finishCampaign();
      return;
    }
    this.resume.mode = "bridge";
    this.resume.lineIndex = 0;
    this.resume.choiceIndex = null;
    this.awaitingChoice = true;
    this._waitingAdvance = false;
    this.ui.setSpeaker("");
    this.ui.setDialogue("——");
    this.ui.setClickHint(false);
    this.ui.showChoices([
      {
        text: "时间往前走一些……",
        onSelect: () => {
          this.awaitingChoice = false;
          this.ui.hideChoices();
          this.chapterIndex += 1;
          this.beginChapter();
          this.autosave();
        },
      },
    ]);
    this.autosave();
  }

  showCardChoices(card) {
    if (!card?.choices?.length) {
      this.advanceScene();
      return;
    }
    this.resume.mode = "choice";
    this.resume.choiceIndex = null;
    this.awaitingChoice = true;
    this._waitingAdvance = false;
    this.ui.setClickHint(false);
    this.ui.showChoices(
      card.choices.map((c, index) => ({
        text: this.fillTemplate(c.text),
        onSelect: () => this.selectChoice(card, index),
      }))
    );
    this.autosave();
  }

  selectChoice(card, index) {
    const c = card.choices?.[index];
    if (!c) return;
    this.awaitingChoice = false;
    this.ui.hideChoices();
    this.pushLog("{name}", c.text || "");
    (c.flags || []).forEach((f) => this.addFlag(f));
    this.applyDelta({
      intimacy: c.intimacy || 0,
      safety: c.safety || 0,
    });
    this.resume.mode = "reply";
    this.resume.choiceIndex = index;
    this.resume.lineIndex = 0;
    this.lineQueue = expandLinesForDisplay(c.reply || []);
    this.autosave();
    if (!this.lineQueue.length) {
      this.onQueueFinished();
      return;
    }
    this.playLineAt(0);
  }

  playLineAt(index, { skipLog = false, instant = false } = {}) {
    this.awaitingChoice = false;
    this.awaitingName = false;
    this._waitingAdvance = false;

    if (index >= this.lineQueue.length) {
      this.onQueueFinished();
      return;
    }

    this.resume.lineIndex = index;
    const line = this.lineQueue[index];

    if (line.askName) {
      this.resume.mode = this.resume.mode === "chapterIntro" ? "chapterIntro" : "name";
      this.awaitingName = true;
      this.ui.setClickHint(false);
      this.ui.openNamePrompt({
        defaultValue: this.playerName || DEFAULT_PLAYER_NAME,
        onConfirm: (raw) => {
          this.setPlayerName(raw);
          this.awaitingName = false;
          this.ui.closeNamePrompt();
          if (this.resume.mode === "name") this.resume.mode = "lines";
          this.resume.lineIndex = index + 1;
          this.autosave();
          this.playLineAt(index + 1);
        },
      });
      this.autosave();
      return;
    }

    if (line.revealSprite) {
      this.ui.setSpriteVisible(true, line.mood || "neutral");
    } else if (line.hideSprite) {
      this.ui.setSpriteVisible(false);
    } else if (line.mood && this.ui.sprite && !this.ui.sprite.classList.contains("hidden")) {
      this.ui.setMood(line.mood);
    }

    const speaker = this.fillTemplate(line.speaker ?? "");
    const text = this.fillTemplate(line.text || "");
    if (!text && (line.revealSprite || line.hideSprite || line.mood)) {
      this.resume.lineIndex = index + 1;
      this.playLineAt(index + 1, { skipLog, instant });
      return;
    }

    if (!skipLog) this.pushLog(speaker, text);
    this.ui.setSpeaker(speaker);
    if (instant) {
      this.stopTyping();
      this.fullText = text;
      this.charIndex = text.length;
      this.typing = false;
      this._waitingAdvance = true;
      this.ui.setDialogue(text);
      this.ui.setClickHint(true);
      this.autosave();
      return;
    }
    this.typeText(text);
    this.autosave();
  }

  onQueueFinished() {
    const mode = this.resume.mode;
    if (mode === "chapterIntro") {
      this.playCurrentScene();
      this.autosave();
      return;
    }
    if (mode === "lines") {
      const card = this.currentCard;
      if (card?.choices?.length) {
        this.showCardChoices(card);
      } else {
        this.advanceScene();
      }
      return;
    }
    if (mode === "reply") {
      this.advanceScene();
      return;
    }
    this.advanceScene();
  }

  finishCampaign() {
    this.ended = true;
    this.phase = "ending";
    this.resume = defaultResume();
    this.lineQueue = [];
    this.awaitingChoice = false;
    this._waitingAdvance = false;
    const ending = resolveCampaignEnding({
      intimacy: this.intimacy,
      safety: this.safety,
      flags: this.flags,
    });
    this.ui.setSpriteVisible(true, "smile");
    this.ui.setScene("home");
    this.ui.showEnding(ending);
  }

  typeText(text) {
    this.stopTyping();
    this.fullText = text || "";
    this.charIndex = 0;
    this.typing = true;
    this._waitingAdvance = false;
    this.ui.setDialogue("");
    this.ui.setClickHint(false);

    const step = () => {
      this.charIndex += 1;
      this.ui.setDialogue(this.fullText.slice(0, this.charIndex));
      if (this.charIndex >= this.fullText.length) {
        this.typing = false;
        this.typeTimer = null;
        this._waitingAdvance = true;
        this.ui.setClickHint(!this.awaitingChoice && !this.awaitingName);
        return;
      }
      this.typeTimer = window.setTimeout(step, 1000 / this.cps);
    };
    step();
  }

  stopTyping() {
    if (this.typeTimer) {
      clearTimeout(this.typeTimer);
      this.typeTimer = null;
    }
    this.typing = false;
  }

  advance() {
    if (this.ended || this.awaitingChoice || this.awaitingName) return;

    if (this.typing) {
      this.stopTyping();
      this.ui.setDialogue(this.fullText);
      this._waitingAdvance = true;
      this.ui.setClickHint(true);
      return;
    }

    if (!this._waitingAdvance) return;

    this._waitingAdvance = false;
    this.ui.setClickHint(false);
    const nextIndex = this.resume.lineIndex + 1;
    this.resume.lineIndex = nextIndex;
    this.playLineAt(nextIndex);
  }
}
