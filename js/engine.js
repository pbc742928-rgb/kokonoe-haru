import { CHAPTERS, TEST_NODES, resolveCampaignEnding } from "./story.js?v=27";

const SAVE_KEY = "kokonoe-haru-save-v27";
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
      version: 27,
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

  persist({ toast = false } = {}) {
    if (this.ended) {
      if (toast) this.ui.toast("结局画面无法保存，请重新开始。");
      return false;
    }
    if (this.resume.mode === "idle" && this.phase === "idle") {
      if (toast) this.ui.toast("当前没有可保存的进度。");
      return false;
    }
    if (this.typing) {
      this.stopTyping();
      this.ui.setDialogue(this.fullText);
      this.ui.setClickHint(!this.awaitingChoice && !this.awaitingName);
      this._waitingAdvance = true;
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.getState()));
      if (toast) this.ui.toast("进度已保存。");
      return true;
    } catch {
      if (toast) this.ui.toast("保存失败，请检查浏览器存储权限。");
      return false;
    }
  }

  save() {
    return this.persist({ toast: true });
  }

  autosave() {
    if (this.ended || this.resume.mode === "idle") return false;
    return this.persist({ toast: false });
  }

  hasSave() {
    return Boolean(localStorage.getItem(SAVE_KEY));
  }

  async load() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      this.ui.toast("没有可读取的进度。");
      return false;
    }
    try {
      const data = JSON.parse(raw);
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
      this.ui.showGame();
      this.syncHud(false);
      this.ui.toast("进度已读取。");

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
        // 旧档：仅有章节/场景，从该场景开头播
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
