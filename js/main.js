import { GalEngine } from "./engine.js";

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $("stage"),
  title: $("title-screen"),
  game: $("game-ui"),
  ending: $("ending-screen"),
  menu: $("menu-screen"),
  logScreen: $("log-screen"),
  logList: $("log-list"),
  nameScreen: $("name-screen"),
  nameInput: $("name-input"),
  nameError: $("name-error"),
  sprite: $("sprite"),
  _nameConfirm: null,
  spriteImg: $("sprite-img"),
  speaker: $("speaker"),
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

  showTitle() {
    this.title.classList.remove("hidden");
    this.game.classList.add("hidden");
    this.ending.classList.add("hidden");
    this.menu.classList.add("hidden");
    this.closeLog();
    this.closeNamePrompt();
    this.setSpriteVisible(false);
    this.btnContinue.classList.toggle("hidden", !engine.hasSave());
  },

  showGame() {
    this.title.classList.add("hidden");
    this.ending.classList.add("hidden");
    this.menu.classList.add("hidden");
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
    this.ending.classList.remove("hidden");
    this.endingTitle.textContent = ending.title;
    this.endingText.textContent = ending.text;
  },

  hideEnding() {
    this.ending.classList.add("hidden");
  },

  openMenu() {
    this.closeLog();
    this.toastEl.textContent = "";
    this.menu.classList.remove("hidden");
  },

  closeMenu() {
    this.menu.classList.add("hidden");
    this.toastEl.textContent = "";
  },

  openLog(entries = []) {
    this.closeMenu();
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

function bind() {
  $("btn-start").addEventListener("click", () => engine.start());
  $("btn-continue").addEventListener("click", async () => {
    await engine.load();
    ui.closeMenu();
  });
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
  $("btn-save").addEventListener("click", () => engine.save());
  $("btn-load").addEventListener("click", async () => {
    await engine.load();
    ui.closeMenu();
  });
  $("btn-to-title").addEventListener("click", () => {
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
    if (ui.isLogOpen() || ui.isNamePromptOpen()) return;
    engine.advance();
  });

  $("log-screen").addEventListener("click", (e) => {
    if (e.target === $("log-screen")) ui.closeLog();
  });

  window.addEventListener("keydown", (e) => {
    if (ui.isNamePromptOpen()) {
      if (e.key === "Escape") e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
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
      if (ui.isLogOpen()) return;
      if (!ui.ending.classList.contains("hidden")) return;
      e.preventDefault();
      engine.advance();
    }
  });
}

bind();
boot();
