import { GalEngine } from "./engine.js";

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $("stage"),
  title: $("title-screen"),
  game: $("game-ui"),
  ending: $("ending-screen"),
  menu: $("menu-screen"),
  sprite: $("sprite"),
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
    this.setSpriteVisible(false);
    this.btnContinue.classList.toggle("hidden", !engine.hasSave());
  },

  showGame() {
    this.title.classList.add("hidden");
    this.ending.classList.add("hidden");
    this.menu.classList.add("hidden");
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
    this.toastEl.textContent = "";
    this.menu.classList.remove("hidden");
  },

  closeMenu() {
    this.menu.classList.add("hidden");
    this.toastEl.textContent = "";
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
  $("btn-close-menu").addEventListener("click", () => ui.closeMenu());
  $("btn-save").addEventListener("click", () => engine.save());
  $("btn-load").addEventListener("click", async () => {
    await engine.load();
    ui.closeMenu();
  });
  $("btn-to-title").addEventListener("click", () => {
    engine.reset();
    ui.showTitle();
  });

  $("dialogue-box").addEventListener("click", () => engine.advance());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!ui.menu.classList.contains("hidden")) ui.closeMenu();
      else if (!ui.game.classList.contains("hidden")) ui.openMenu();
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (!ui.title.classList.contains("hidden")) return;
      if (!ui.menu.classList.contains("hidden")) return;
      if (!ui.ending.classList.contains("hidden")) return;
      e.preventDefault();
      engine.advance();
    }
  });
}

bind();
boot();
