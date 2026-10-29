import { GalEngine } from "./engine.js?v=29";

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $("stage"),
  title: $("title-screen"),
  game: $("game-ui"),
  ending: $("ending-screen"),
  menu: $("menu-screen"),
  saveScreen: $("save-screen"),
  savePanelTitle: $("save-panel-title"),
  savePanelHint: $("save-panel-hint"),
  saveSlotList: $("save-slot-list"),
  saveToast: $("save-toast"),
  logScreen: $("log-screen"),
  logList: $("log-list"),
  nameScreen: $("name-screen"),
  nameInput: $("name-input"),
  nameError: $("name-error"),
  sprite: $("sprite"),
  _nameConfirm: null,
  spriteImg: $("sprite-img"),
  speaker: $("speaker"),
  dialogueFade: $("dialogue-fade"),
  spriteMap: {
    neutral: "assets/sprites/haru_neutral.png",
    shy: "assets/sprites/haru_shy.png",
    smile: "assets/sprites/haru_smile.png",
  },
  text: $("dialogue-text"),
  hint: $("click-hint"),
  choices: $("choices"),
  chapterPill: $("chapter-pill"),
  timePill: $("time-pill"),
  intimacyPill: $("intimacy-pill"),
  safetyPill: $("safety-pill"),
  endingTitle: $("ending-title"),
  endingText: $("ending-text"),
  toastEl: $("menu-toast"),
  btnContinue: $("btn-continue"),
  btnTitleLoad: $("btn-title-load"),
  _saveMode: "save",
  _fadeTimer: null,

  showTitle() {
    this.title.classList.remove("hidden");
    this.game.classList.add("hidden");
    this.ending.classList.add("hidden");
    this.menu.classList.add("hidden");
    this.closeSaveSlots();
    this.closeLog();
    this.closeNamePrompt();
    this.setSpriteVisible(false);
    const has = engine.hasSave();
    this.btnContinue.classList.toggle("hidden", !has);
    this.btnTitleLoad?.classList.toggle("hidden", !has);
  },

  showGame() {
    this.title.classList.add("hidden");
    this.ending.classList.add("hidden");
    this.menu.classList.add("hidden");
    this.closeSaveSlots();
    this.closeLog();
    this.closeNamePrompt();
    this.game.classList.remove("hidden");
  },

  setScene(name) {
    this.stage.className = "";
    this.stage.classList.add(`scene-${name || "home"}`);
  },

  setSpriteVisible(visible, mood = "neutral") {
    if (visible) {
      const wasHidden = this.sprite.classList.contains("hidden");
      this.sprite.classList.remove("hidden");
      this.setMood(mood);
      if (wasHidden) {
        this.sprite.classList.remove("enter");
        void this.sprite.offsetWidth;
        this.sprite.classList.add("enter");
      }
    } else {
      this.sprite.classList.add("hidden");
      this.sprite.classList.remove("enter");
    }
  },

  setMood(mood) {
    const key = this.spriteMap[mood] ? mood : "neutral";
    if (!this.spriteImg) return;
    const next = this.spriteMap[key];
    if (this.spriteImg.getAttribute("src") !== next) {
      this.spriteImg.src = next;
    }
    this.sprite.dataset.mood = key;
  },

  setSpeaker(name) {
    this.speaker.textContent = name || "";
  },

  setDialogue(text) {
    this.text.textContent = text;
  },

  setClickHint(on) {
    this.hint.classList.toggle("visible", Boolean(on));
  },

  fadeDialogueOut(ms = 180) {
    return this._runDialogueFade(true, ms);
  },

  fadeDialogueIn(ms = 180) {
    return this._runDialogueFade(false, ms);
  },

  cancelDialogueFade() {
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    this.dialogueFade?.classList.remove("is-out");
  },

  _runDialogueFade(toOut, ms) {
    const el = this.dialogueFade;
    if (!el) return Promise.resolve();
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    return new Promise((resolve) => {
      if (toOut) {
        el.classList.add("is-out");
      } else {
        el.classList.add("is-out");
        void el.offsetWidth;
        el.classList.remove("is-out");
      }
      const done = () => {
        this._fadeTimer = null;
        resolve();
      };
      this._fadeTimer = window.setTimeout(done, ms + 20);
    });
  },

  setStatus({ chapterLabel, timeLabel, intimacy, tier, safety, bump }) {
    this.chapterPill.textContent = chapterLabel || "—";
    this.timePill.textContent = timeLabel || "";
    this.timePill.classList.toggle("hidden", !timeLabel);
    this.intimacyPill.textContent = `亲密 ${intimacy} · ${tier}`;
    this.safetyPill.textContent = `安心 ${safety}`;
    if (bump) {
      this.intimacyPill.classList.remove("bump");
      void this.intimacyPill.offsetWidth;
      this.intimacyPill.classList.add("bump");
    }
  },

  showChoices(items) {
    this.choices.innerHTML = "";
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.textContent = item.text;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        item.onSelect();
      });
      this.choices.appendChild(btn);
    });
    this.choices.classList.remove("hidden");
    this.setClickHint(false);
  },

  hideChoices() {
    this.choices.classList.add("hidden");
    this.choices.innerHTML = "";
  },

  showEnding(ending) {
    this.game.classList.add("hidden");
    this.menu.classList.add("hidden");
    this.closeSaveSlots();
    this.ending.classList.remove("hidden");
    this.endingTitle.textContent = ending.title;
    this.endingText.textContent = ending.text;
  },

  hideEnding() {
    this.ending.classList.add("hidden");
  },

  openMenu() {
    this.closeLog();
    this.closeSaveSlots();
    this.toastEl.textContent = "";
    this.menu.classList.remove("hidden");
  },

  closeMenu() {
    this.menu.classList.add("hidden");
    this.toastEl.textContent = "";
  },

  openSaveSlots({ mode = "save", slots = [], hint = "" } = {}) {
    this.closeMenu();
    this.closeLog();
    this._saveMode = mode;
    this.savePanelTitle.textContent = mode === "load" ? "读取进度" : "保存进度";
    this.savePanelHint.textContent = hint || "";
    this.saveToast.textContent = "";
    this.saveSlotList.innerHTML = "";

    slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "save-slot" + (slot.empty ? " is-empty" : "");
      btn.setAttribute("role", "listitem");

      const idx = document.createElement("span");
      idx.className = "save-slot-index";
      idx.textContent = String(slot.index + 1);

      const main = document.createElement("div");
      main.className = "save-slot-main";

      const title = document.createElement("p");
      title.className = "save-slot-title";
      title.textContent = slot.empty
        ? mode === "load"
          ? "空槽"
          : "空槽 · 点击写入"
        : slot.chapterLabel || "存档";

      const meta = document.createElement("p");
      meta.className = "save-slot-meta";
      if (slot.empty) {
        meta.textContent = mode === "save" ? "尚无数据" : "不可读取";
      } else {
        const bits = [slot.timeLabel, slot.savedAtLabel, slot.intimacy != null ? `亲密 ${slot.intimacy}` : ""]
          .filter(Boolean)
          .join(" · ");
        meta.textContent = bits || "已保存";
      }

      const preview = document.createElement("p");
      preview.className = "save-slot-preview";
      preview.textContent = slot.empty ? "—" : slot.preview || "……";

      main.appendChild(title);
      main.appendChild(meta);
      main.appendChild(preview);
      btn.appendChild(idx);
      btn.appendChild(main);

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (this._saveMode === "save") {
          if (!slot.empty) {
            const ok = window.confirm(`覆盖槽位 ${slot.index + 1} 的存档？`);
            if (!ok) return;
          }
          const saved = engine.saveToSlot(slot.index, { toast: false });
          if (saved) {
            this.saveToast.textContent = `已保存到槽位 ${slot.index + 1}。`;
            this.renderSaveSlots(engine.listSlots());
            window.setTimeout(() => this.closeSaveSlots(), 480);
          } else {
            this.saveToast.textContent = "保存失败。";
          }
          return;
        }

        if (slot.empty) {
          this.saveToast.textContent = "该槽位没有存档。";
          return;
        }
        await engine.loadFromSlot(slot.index);
      });

      this.saveSlotList.appendChild(btn);
    });

    this.saveScreen.classList.remove("hidden");
  },

  renderSaveSlots(slots) {
    if (this.saveScreen.classList.contains("hidden")) return;
    this.openSaveSlots({
      mode: this._saveMode,
      slots,
      hint: this.savePanelHint.textContent,
    });
  },

  closeSaveSlots() {
    this.saveScreen?.classList.add("hidden");
    if (this.saveToast) this.saveToast.textContent = "";
  },

  isSaveSlotsOpen() {
    return this.saveScreen && !this.saveScreen.classList.contains("hidden");
  },

  openLog(entries = []) {
    this.closeMenu();
    this.closeSaveSlots();
    this.logList.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "暂时还没有可回顾的文本。";
      this.logList.appendChild(empty);
    } else {
      entries.forEach((entry) => {
        const item = document.createElement("article");
        item.className = "log-item";
        const who = document.createElement("p");
        who.className = "log-speaker" + (entry.speaker ? "" : " is-narration");
        who.textContent = entry.speaker || "旁白";
        const body = document.createElement("p");
        body.className = "log-text";
        body.textContent = entry.text;
        item.appendChild(who);
        item.appendChild(body);
        this.logList.appendChild(item);
      });
    }
    this.logScreen.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.logList.scrollTop = this.logList.scrollHeight;
    });
  },

  closeLog() {
    this.logScreen?.classList.add("hidden");
  },

  isLogOpen() {
    return this.logScreen && !this.logScreen.classList.contains("hidden");
  },

  openNamePrompt({ defaultValue = "尘", onConfirm } = {}) {
    this.closeMenu();
    this.closeLog();
    this.closeSaveSlots();
    this._nameConfirm = onConfirm;
    this.nameError.textContent = "";
    this.nameInput.value = defaultValue || "尘";
    this.nameScreen.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.nameInput.focus();
      this.nameInput.select();
    });
  },

  closeNamePrompt() {
    this.nameScreen?.classList.add("hidden");
    this.nameError.textContent = "";
    this._nameConfirm = null;
  },

  isNamePromptOpen() {
    return this.nameScreen && !this.nameScreen.classList.contains("hidden");
  },

  submitNamePrompt() {
    const raw = (this.nameInput.value || "").trim();
    if (!raw) {
      this.nameError.textContent = "请输入一个称呼。";
      this.nameInput.focus();
      return;
    }
    if (/[<>{}]/.test(raw)) {
      this.nameError.textContent = "称呼里请不要使用特殊符号。";
      this.nameInput.focus();
      return;
    }
    const cb = this._nameConfirm;
    if (cb) cb(raw);
  },

  toast(msg) {
    if (this.isSaveSlotsOpen() && this.saveToast) {
      this.saveToast.textContent = msg;
      return;
    }
    this.toastEl.textContent = msg;
  },
};

const engine = new GalEngine({ ui });

async function boot() {
  try {
    await engine.init();
  } catch (err) {
    console.error(err);
    ui.toast("资源加载失败，请用本地服务器打开（勿直接双击 html）。");
  }
  ui.setScene("home");
  ui.showTitle();
}

function renderTestNodes() {
  const list = $("test-node-list");
  if (!list) return;
  list.innerHTML = "";
  engine.getTestNodes().forEach((node) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "test-node-btn";
    btn.innerHTML = `<span class="test-node-title">${node.title}</span><span class="test-node-blurb">${node.blurb}</span>`;
    btn.addEventListener("click", () => engine.startAtNode(node.id));
    list.appendChild(btn);
  });
}

function bind() {
  $("btn-start").addEventListener("click", () => engine.start());
  $("btn-continue").addEventListener("click", async () => {
    await engine.load();
  });
  $("btn-title-load")?.addEventListener("click", () => {
    engine.requestLoadPanel({ fromTitle: true });
  });
  renderTestNodes();
  $("btn-restart").addEventListener("click", () => engine.start());
  $("btn-title").addEventListener("click", () => ui.showTitle());
  $("btn-menu").addEventListener("click", (e) => {
    e.stopPropagation();
    ui.openMenu();
  });
  $("btn-log").addEventListener("click", (e) => {
    e.stopPropagation();
    if (ui.isLogOpen()) ui.closeLog();
    else ui.openLog(engine.getLog());
  });
  $("btn-close-menu").addEventListener("click", () => ui.closeMenu());
  $("btn-close-log").addEventListener("click", () => ui.closeLog());
  $("btn-close-save")?.addEventListener("click", () => ui.closeSaveSlots());
  $("btn-save").addEventListener("click", () => {
    engine.requestSavePanel();
  });
  $("btn-load").addEventListener("click", () => {
    engine.requestLoadPanel();
  });
  $("btn-to-title").addEventListener("click", () => {
    engine.autosave();
    engine.reset();
    ui.showTitle();
  });

  $("btn-confirm-name").addEventListener("click", (e) => {
    e.stopPropagation();
    ui.submitNamePrompt();
  });
  $("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      ui.submitNamePrompt();
    }
  });

  $("dialogue-box").addEventListener("click", () => {
    if (ui.isLogOpen() || ui.isNamePromptOpen() || ui.isSaveSlotsOpen()) return;
    engine.advance();
  });

  $("log-screen").addEventListener("click", (e) => {
    if (e.target === $("log-screen")) ui.closeLog();
  });
  $("save-screen")?.addEventListener("click", (e) => {
    if (e.target === $("save-screen")) ui.closeSaveSlots();
  });

  window.addEventListener("keydown", (e) => {
    if (ui.isNamePromptOpen()) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      if (ui.isSaveSlotsOpen()) {
        ui.closeSaveSlots();
        return;
      }
      if (ui.isLogOpen()) {
        ui.closeLog();
        return;
      }
      if (!ui.menu.classList.contains("hidden")) ui.closeMenu();
      else if (!ui.game.classList.contains("hidden")) ui.openMenu();
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (!ui.title.classList.contains("hidden")) return;
      if (!ui.menu.classList.contains("hidden")) return;
      if (ui.isSaveSlotsOpen()) return;
      if (ui.isLogOpen()) return;
      if (!ui.ending.classList.contains("hidden")) return;
      e.preventDefault();
      engine.advance();
    }
  });
}

bind();
boot();
