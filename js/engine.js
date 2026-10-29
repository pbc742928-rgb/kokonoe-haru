import { CHAPTERS, TEST_NODES, resolveCampaignEnding } from "./story.js";

const SAVE_KEY = "kokonoe-haru-save-v26";
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
      // 长句：尽量在逗号/顿号处切开
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
          cut += 2; // 破折号留在上一句
        } else {
          cut += 1; // 逗号等标点留在上一句，避免下框以「，」开头
        }
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) pieces.push(rest);
    }
  }

  // 合并过短碎片，避免一句被拆成碎屑
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
        // 精灵切换只在首句触发，避免同一行拆段时反复进场
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

/**
 * 线性章节制：每章 scenes 按顺序只播一次，不随机、不重复。
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
    this._lineDone = null;
    this.cps = 36;
    this.phase = "idle";
    this.log = [];
    this.playerName = DEFAULT_PLAYER_NAME;
    this.playerHonor = buildHonor(DEFAULT_PLAYER_NAME);
    this.awaitingName = false;
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

  reset() {
    this.stopTyping();
    this.chapterIndex = 0;
    this.sceneIndex = 0;
    this.intimacy = 0;
    this.safety = 35;
    this.flags = [];
    this.ended = false;
    this.awaitingChoice = false;
    this.phase = "idle";
    this._lineDone = null;
    this.log = [];
    this.playerName = DEFAULT_PLAYER_NAME;
    this.playerHonor = buildHonor(DEFAULT_PLAYER_NAME);
    this.awaitingName = false;
    this.ui.hideChoices();
    this.ui.hideEnding();
    this.ui.closeLog?.();
    this.ui.closeNamePrompt?.();
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
    // 跳过初见时默认已有称呼，避免后段缺失名字
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
      chapterIndex: this.chapterIndex,
      sceneIndex: this.sceneIndex,
      intimacy: this.intimacy,
      safety: this.safety,
      flags: [...this.flags],
      ended: this.ended,
      playerName: this.playerName,
      playerHonor: this.playerHonor,
    };
  }

  save() {
    if (this.ended) {
      this.ui.toast("结局画面无法保存，请重新开始。");
      return false;
    }
    if (this.awaitingChoice || this.awaitingName || this.typing || this._lineDone) {
      this.ui.toast("请先完成当前对话再保存。");
      return false;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.getState()));
    this.ui.toast("进度已保存。");
    return true;
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
      this.stopTyping();
      this.chapterIndex = Number(data.chapterIndex) || 0;
      this.sceneIndex = Number(data.sceneIndex) || 0;
      this.intimacy = Number(data.intimacy) || 0;
      this.safety = Number(data.safety) || 35;
      this.flags = Array.isArray(data.flags) ? data.flags : [];
      this.ended = false;
      this.awaitingChoice = false;
      this.awaitingName = false;
      this._lineDone = null;
      this.setPlayerName(data.playerName || DEFAULT_PLAYER_NAME);
      if (data.playerHonor) this.playerHonor = String(data.playerHonor);
      this.ui.hideChoices();
      this.ui.hideEnding();
      this.ui.closeNamePrompt?.();
      this.ui.showGame();
      this.syncHud(false);
      this.ui.toast("进度已读取。");
      this.playCurrentScene();
      return true;
    } catch {
      this.ui.toast("存档损坏，无法读取。");
      return false;
    }
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

    this.enqueueLines(
      [
        {
          speaker: "",
          text: `【${ch.label}】\n${ch.timeLabel}`,
        },
      ],
      () => this.playCurrentScene()
    );
  }

  playCurrentScene() {
    const ch = this.chapter;
    if (!ch) {
      this.finishCampaign();
      return;
    }
    const scenes = ch.scenes || [];
    if (this.sceneIndex >= scenes.length) {
      this.bridgeToNextChapter();
      return;
    }
    const card = scenes[this.sceneIndex];
    this.phase = card.id || `scene_${this.sceneIndex}`;
    this.playCard(card, () => {
      this.sceneIndex += 1;
      if (this.sceneIndex >= scenes.length) {
        this.bridgeToNextChapter();
      } else {
        this.playCurrentScene();
      }
    });
  }

  bridgeToNextChapter() {
    const isLast = this.chapterIndex >= CHAPTERS.length - 1;
    if (isLast) {
      this.finishCampaign();
      return;
    }
    this.awaitingChoice = true;
    this.ui.setSpeaker("");
    this.ui.setDialogue("——");
    this.ui.showChoices([
      {
        text: "时间往前走一些……",
        onSelect: () => {
          this.awaitingChoice = false;
          this.ui.hideChoices();
          this.chapterIndex += 1;
          this.beginChapter();
        },
      },
    ]);
  }

  playCard(card, onDone) {
    if (!card) {
      onDone?.();
      return;
    }
    if (card.scene) this.ui.setScene(card.scene);
    if (typeof card.showSprite === "boolean") {
      this.ui.setSpriteVisible(card.showSprite, card.mood || "neutral");
    } else {
      this.ui.setSpriteVisible(true, card.mood || "neutral");
    }

    this.enqueueLines(card.lines || [], () => {
      if (card.choices?.length) {
        this.awaitingChoice = true;
        this.ui.setClickHint(false);
        this.ui.showChoices(
          card.choices.map((c) => ({
            text: this.fillTemplate(c.text),
            onSelect: () => {
              this.awaitingChoice = false;
              this.ui.hideChoices();
              this.pushLog("{name}", c.text || "");
              (c.flags || []).forEach((f) => this.addFlag(f));
              this.applyDelta({
                intimacy: c.intimacy || 0,
                safety: c.safety || 0,
              });
              this.enqueueLines(c.reply || [], onDone);
            },
          }))
        );
        return;
      }
      onDone?.();
    });
  }

  enqueueLines(lines, onDone) {
    const list = expandLinesForDisplay(lines);
    const next = () => {
      if (!list.length) {
        onDone?.();
        return;
      }
      const line = list.shift();
      if (line.askName) {
        this.awaitingName = true;
        this.ui.setClickHint(false);
        this.ui.openNamePrompt({
          defaultValue: this.playerName || DEFAULT_PLAYER_NAME,
          onConfirm: (raw) => {
            this.setPlayerName(raw);
            this.awaitingName = false;
            this.ui.closeNamePrompt();
            next();
          },
        });
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
        next();
        return;
      }
      this.pushLog(speaker, text);
      this.ui.setSpeaker(speaker);
      this.typeText(text, next);
    };
    next();
  }

  finishCampaign() {
    this.ended = true;
    this.phase = "ending";
    const ending = resolveCampaignEnding({
      intimacy: this.intimacy,
      safety: this.safety,
      flags: this.flags,
    });
    this.ui.setSpriteVisible(true, "smile");
    this.ui.setScene("home");
    this.ui.showEnding(ending);
  }

  typeText(text, onDone) {
    this.stopTyping();
    this.fullText = text || "";
    this.charIndex = 0;
    this.typing = true;
    this._lineDone = onDone;
    this.ui.setDialogue("");
    this.ui.setClickHint(false);

    const step = () => {
      this.charIndex += 1;
      this.ui.setDialogue(this.fullText.slice(0, this.charIndex));
      if (this.charIndex >= this.fullText.length) {
        this.typing = false;
        this.typeTimer = null;
        this.ui.setClickHint(!this.awaitingChoice);
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
      this.ui.setClickHint(true);
      return;
    }

    if (this._lineDone) {
      const cb = this._lineDone;
      this._lineDone = null;
      this.ui.setClickHint(false);
      cb();
    }
  }
}
