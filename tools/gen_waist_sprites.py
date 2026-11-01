"""Story-matched waist-up sprites for 九重春.

Primary: txt2img + ControlNet reference_only (frees camera angle).
Refine:  img2img over existing cand/ images — keep angle, fix petite proportion + beauty.

Usage:
  python tools/gen_waist_sprites.py --refine   # polish existing 42 (recommended)
  python tools/gen_waist_sprites.py            # full regenerate from scratch
  python tools/gen_waist_sprites.py --test     # one probe image
  python tools/gen_waist_sprites.py slug ...   # regenerate listed slugs only
"""
from __future__ import annotations

import base64
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "assets" / "sprites" / "haru_neutral.png"
OUT = ROOT / "assets" / "sprites" / "cand"
TXT_API = "http://127.0.0.1:7860/sdapi/v1/txt2img"
IMG_API = "http://127.0.0.1:7860/sdapi/v1/img2img"
PER_VARIANT = 3

IDENTITY = (
    "masterpiece, best quality, highly detailed, beautiful soft painted anime, "
    "galgame character sprite, visual novel portrait, refined linework, soft lighting, "
    "1girl, solo, (petite:1.4), (short stature:1.3), (small slender body:1.35), "
    "(delicate narrow shoulders:1.25), slim arms, small delicate hands, "
    "youthful girlish face, cute face, balanced natural proportions, "
    "short straight black hair, blunt bangs, black-framed rectangular glasses, "
    "dark brown eyes, reddish-brown iris, faint dark circles under eyes, pale soft skin, "
    "(upper body:1.35), waist-up, plain white background, simple background"
)

REFINE_PROMPT = (
    "masterpiece, best quality, highly detailed, beautiful soft painted anime, "
    "galgame sprite, refined linework, soft lighting, "
    "1girl, solo, (petite:1.4), (short stature:1.3), (small slender body:1.35), "
    "delicate narrow shoulders, slim arms, small delicate hands, "
    "youthful girlish face, cute face, balanced natural proportions, "
    "same character, short straight black hair, blunt bangs, "
    "black-framed rectangular glasses, dark brown reddish eyes, "
    "faint dark circles, pale soft skin, upper body, waist-up, plain white background"
)

SUIT = (
    "light gray office suit jacket slightly oversized on petite body, "
    "white collared shirt, office lady, neat soft fabric folds"
)
TEE = (
    "oversized plain white t-shirt hanging loosely on petite body, "
    "loose sleeves covering hands a little, damp short hair, modest"
)

NEGATIVE = (
    "nsfw, cleavage, (full body:1.3), legs, thighs, pants, trousers, feet, shoes, "
    "multiple girls, 2girls, duplicate, clone, shadow figure, "
    "scenery, room, furniture, detailed background, text, watermark, signature, "
    "photorealistic, 3d, lowres, worst quality, bad anatomy, bad hands, "
    "extra fingers, fused fingers, missing fingers, deformed, blurry, "
    "muscular, broad shoulders, thick arms, thick neck, stocky, chubby, "
    "tall woman, mature voluptuous body, large head, disproportionate, "
    "foreshortened torso, warped body, uneven shoulders, "
    "from above, high angle, bird's eye view, looking up at viewer, "
    "leaning toward camera, extreme perspective, "
    "blue eyes, red eyes, long hair, ponytail, twintails, no glasses"
)

# (slug, outfit, angle + action + expression, story beat)
VARIANTS = [
    (
        "suit_front_blank",
        SUIT,
        "(front view:1.2), looking at viewer, arms down, "
        "expressionless, empty unfocused eyes, closed mouth, tired",
        "初遇站台：「……为什么？」空白、失焦的冷脸",
    ),
    (
        "suit_tq_briefcase_guard",
        SUIT,
        "(from side:0.6), (three-quarter view:1.3), body turned left, "
        "(hugging black briefcase against chest with both arms:1.3), "
        "wary sideways glance at viewer, guarded, closed mouth",
        "长椅/回家路上：抱紧公文包当挡箭牌",
    ),
    (
        "suit_side_avert",
        SUIT,
        "(profile:1.1), (from side:1.2), (looking away:1.3), eyes half-lidded, "
        "head slightly lowered, distant, expressionless",
        "对视一瞬后先移开眼",
    ),
    (
        "suit_down_shoes",
        SUIT,
        "eye-level, (looking down:1.4), chin lowered, wet hair, damp clothes, "
        "holding briefcase handle in front of waist, quiet, slight frown",
        "进门前低头看沾泥的鞋尖",
    ),
    (
        "suit_cup_glance",
        SUIT,
        "(three-quarter view:1.2), (holding paper coffee cup with both hands:1.4), "
        "steam, glancing up at viewer, upturned eyes, (red ears:1.2), cold face",
        "便利店热饮 / 摩卡：冷脸，耳尖悄悄红",
    ),
    (
        "suit_ledger_glasses",
        SUIT,
        "(front view:1.1), (adjusting glasses with one finger:1.4), "
        "holding a clipboard with papers, serious businesslike expression, "
        "looking at viewer",
        "记账表格：账目优先的人机感",
    ),
    (
        "tee_towel_down",
        TEE,
        "(three-quarter view:1.2), (towel on head:1.3), "
        "drying hair with towel, looking down, unguarded, calm",
        "洗完澡穿你的 T 恤，低头擦头发",
    ),
    (
        "tee_skewer_blink",
        TEE,
        "(front view:1.1), (holding a meat skewer:1.3), small bite, "
        "blinking, slightly surprised, wide eyes, cheeks puffed slightly",
        "烤串夜宵：愣两秒，小口咬下",
    ),
    (
        "tee_hair_earblush",
        TEE,
        "(from side:0.8), (looking away:1.3), "
        "(twirling a strand of hair with fingers:1.3), "
        "(red ears:1.4), light blush, cold face, embarrassed",
        "吹风机：脸依旧冷，耳尖发烫、绞着头发",
    ),
    (
        "tee_mug_tired",
        TEE,
        "(three-quarter view:1.2), (holding a mug with both hands:1.4), "
        "steam, fogged glasses, tired gentle eyes, looking down at mug",
        "捧着水杯，蒸汽模糊镜片",
    ),
    (
        "tee_glasses_off",
        TEE,
        "(front view:1.1), (holding glasses in hand:1.4), not wearing glasses, "
        "bare face, soft tired eyes, looking at viewer, gentle",
        "摘下眼镜擦雾：罕见柔软又疲惫的目光",
    ),
    (
        "tee_sleepy",
        TEE,
        "eye-level, (rubbing eye with one hand:1.4), sleepy, half-closed eyes, "
        "messy hair, just woke up, soft yawn",
        "沙发上睡醒，捏着毯子边",
    ),
    (
        "suit_lookback",
        SUIT,
        "(from behind:1.0), (looking back over shoulder:1.4), "
        "head turned to viewer, quiet, faint softness in eyes",
        "门口回头：愿意回来",
    ),
    (
        "tee_faint_smile",
        TEE,
        "(three-quarter view:1.2), (head tilt:1.2), looking at viewer, "
        "(faint closed-mouth smile:1.3), soft eyes, light blush",
        "沙发 / 尾声：极淡的笑",
    ),
]


def _png_b64(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def ref_b64() -> str:
    im = Image.open(REF).convert("RGBA")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    return _png_b64(bg)


def _cn_ref(ref: str, weight: float, end: float) -> dict:
    return {
        "controlnet": {
            "args": [
                {
                    "enabled": True,
                    "module": "reference_only",
                    "model": "None",
                    "image": ref,
                    "weight": weight,
                    "resize_mode": "Crop and Resize",
                    "control_mode": "Balanced",
                    "threshold_a": 0.5,
                    "guidance_start": 0.0,
                    "guidance_end": end,
                    "pixel_perfect": True,
                }
            ]
        }
    }


def _post(url: str, body: dict) -> list[bytes]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=900) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return [base64.b64decode(s) for s in data["images"]]


def txt2img(ref: str, outfit: str, action: str, n: int) -> list[bytes]:
    body = {
        "prompt": f"{IDENTITY}, {outfit}, {action}",
        "negative_prompt": NEGATIVE,
        "steps": 32,
        "width": 640,
        "height": 896,
        "cfg_scale": 7.5,
        "sampler_name": "DPM++ 2M",
        "scheduler": "Karras",
        "batch_size": n,
        "n_iter": 1,
        "seed": -1,
        "enable_hr": True,
        "hr_scale": 1.3,
        "hr_upscaler": "R-ESRGAN 4x+ Anime6B",
        "denoising_strength": 0.32,
        "hr_second_pass_steps": 18,
        # Same CN recipe that unlocked angles; prompt carries petite + beauty
        "alwayson_scripts": _cn_ref(ref, 0.85, 1.0),
    }
    return _post(TXT_API, body)[:n]


def refine_one(init_path: Path, ref: str) -> bytes:
    """Light polish — keep angle/pose, nudge beauty + petite (denoise low)."""
    im = Image.open(init_path).convert("RGBA")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    if im.mode == "RGBA":
        bg.paste(im, mask=im.split()[3])
    else:
        bg.paste(im)
    w, h = bg.size
    if max(w, h) > 896:
        scale = 896 / max(w, h)
        bg = bg.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    body = {
        "prompt": REFINE_PROMPT,
        "negative_prompt": NEGATIVE,
        "init_images": [_png_b64(bg)],
        "steps": 28,
        "width": bg.size[0],
        "height": bg.size[1],
        "cfg_scale": 7,
        "denoising_strength": 0.36,
        "sampler_name": "DPM++ 2M",
        "scheduler": "Karras",
        "batch_size": 1,
        "n_iter": 1,
        "seed": -1,
        "alwayson_scripts": _cn_ref(ref, 0.6, 0.6),
    }
    return _post(IMG_API, body)[0]


def write_gallery() -> None:
    sections = []
    for i, (slug, outfit, _, beat) in enumerate(VARIANTS, start=1):
        wear = "西装" if "suit jacket" in outfit or outfit is SUIT else "借来的 T 恤"
        figs = "".join(
            f'<figure><img src="haru_waist_{slug}_{k}.png?v=refine" alt="{slug}-{k}" loading="lazy" />'
            f"<figcaption>{slug}-{k}</figcaption></figure>"
            for k in range(1, PER_VARIANT + 1)
            if (OUT / f"haru_waist_{slug}_{k}.png").exists()
        )
        sections.append(
            f"<section><h2>{i}. {beat}</h2><p class=\"meta\">{slug} · {wear}</p>"
            f'<div class="grid">{figs}</div></section>'
        )
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>九重春 · 剧情对应立绘候选</title>
<style>
body {{ margin: 0; padding: 24px; font-family: "Segoe UI", "PingFang SC", sans-serif; background: #1a1f28; color: #f3ebe0; }}
h1 {{ font-weight: 500; margin: 0 0 8px; }}
.hint {{ opacity: .75; margin-bottom: 28px; }}
section {{ margin-bottom: 36px; }}
h2 {{ font-size: 1.05rem; font-weight: 500; margin: 0 0 4px; }}
.meta {{ margin: 0 0 12px; opacity: .55; font-size: .85rem; }}
.grid {{ display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 12px; max-width: 760px; }}
figure {{ margin: 0; background: #2a3140; border-radius: 10px; overflow: hidden; border: 1px solid rgba(243,235,224,.12); }}
img {{ display: block; width: 100%; height: auto; background: #fff; }}
figcaption {{ padding: 8px 10px; font-size: .85rem; }}
</style>
</head>
<body>
<h1>九重春 · 剧情对应立绘候选（娇小 + 精细 v2）</h1>
<p class="hint">同剧情角度矩阵，加强娇小身材与画质。回聊编号即可，例如 suit_cup_glance-2。</p>
{"".join(sections)}
</body>
</html>
"""
    (OUT / "index.html").write_text(html, encoding="utf-8")


def run_refine() -> None:
    ref = ref_b64()
    files = sorted(OUT.glob("haru_waist_*.png"))
    if not files:
        raise SystemExit("no candidates to refine in assets/sprites/cand/")
    for i, path in enumerate(files, start=1):
        print(f"[{i}/{len(files)}] refine {path.name} ...", flush=True)
        path.write_bytes(refine_one(path, ref))
        if i % 3 == 0:
            write_gallery()
    write_gallery()
    print("done refine", flush=True)


def main() -> None:
    args = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)

    if args == ["--refine"]:
        run_refine()
        return

    ref = ref_b64()

    if args == ["--test"]:
        slug, outfit, action, _ = VARIANTS[0]
        (OUT / "_test.png").write_bytes(txt2img(ref, outfit, action, 1)[0])
        print(f"saved {OUT / '_test.png'}", flush=True)
        return

    todo = [v for v in VARIANTS if not args or v[0] in args]
    if not args:
        for old in OUT.glob("haru_waist_*.png"):
            old.unlink()
    for slug, outfit, action, _ in todo:
        print(f"generating {slug} ...", flush=True)
        for k, raw in enumerate(txt2img(ref, outfit, action, PER_VARIANT), start=1):
            (OUT / f"haru_waist_{slug}_{k}.png").write_bytes(raw)
        print(f"  saved {PER_VARIANT}", flush=True)
        write_gallery()
    write_gallery()
    print("done", flush=True)


if __name__ == "__main__":
    main()
