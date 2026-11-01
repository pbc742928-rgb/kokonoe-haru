"""Polish the 3 user-picked waist-up sprites: expression, hands, harmony."""
from __future__ import annotations

import base64
import io
import json
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CAND = ROOT / "assets" / "sprites" / "cand"
REF = ROOT / "assets" / "sprites" / "haru_neutral.png"
API = "http://127.0.0.1:7860/sdapi/v1/img2img"
OUT_DIR = CAND / "polish"
PER = 2

BASE = (
    "masterpiece, best quality, highly detailed, soft painted anime, "
    "beautiful galgame character sprite, refined linework, soft lighting, "
    "1girl, solo, petite, short stature, slender small frame, "
    "delicate narrow shoulders, youthful girlish face, balanced proportions, "
    "short straight black hair, blunt bangs, black-framed rectangular glasses, "
    "dark brown eyes, reddish-brown iris, faint dark circles, pale soft skin, "
    "upper body, plain white background, simple background"
)

NEGATIVE = (
    "nsfw, cleavage, full body, legs, feet, shoes, multiple girls, 2girls, "
    "duplicate, scenery, text, watermark, photorealistic, 3d, lowres, "
    "worst quality, bad anatomy, bad hands, extra fingers, fewer fingers, "
    "fused fingers, missing fingers, mutated hands, poorly drawn hands, "
    "deformed, blurry, muscular, broad shoulders, large head, disproportionate, "
    "elf ears, pointed ears, gloves, blue eyes, red eyes, long hair, "
    "no glasses, red glasses frames"
)

# (slug, source file, story-fit prompt, denoise)
PICKS = [
    (
        "cup",
        "_pick_cup.jpg",
        "holding a paper coffee cup with both hands, steam, "
        "looking up at viewer, cold reserved face, soft eyes, "
        "slightly red ears, quiet awkward warmth, "
        "(beautiful detailed fingers:1.2), five fingers, natural hand pose, "
        "light gray collared shirt, office lady",
        0.38,
    ),
    (
        "smile",
        "_pick_smile.png",
        "looking at viewer, head tilt, "
        "(faint closed-mouth smile:1.3), soft gentle eyes, light blush, "
        "calm intimate mood, light gray turtleneck, "
        "symmetrical shoulders, delicate neck",
        0.36,
    ),
    (
        "towel",
        "_pick_towel.png",
        "white towel on head like a hood, holding towel against chest with one hand, "
        "bare shoulder, after bath, looking down slightly, unguarded calm tired face, "
        "(beautiful detailed fingers:1.25), five fingers, natural grip on towel, "
        "modest, soft collarbone",
        0.40,
    ),
]


def b64_rgb(path: Path) -> tuple[str, int, int]:
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    w, h = bg.size
    target_h = 1024
    target_w = int(w * target_h / h)
    target_w -= target_w % 8
    bg = bg.resize((target_w, target_h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    bg.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii"), target_w, target_h


def ref_b64() -> str:
    im = Image.open(REF).convert("RGBA")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    buf = io.BytesIO()
    bg.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def ad_face(prompt: str) -> dict:
    return {
        "ad_model": "face_yolov8n.pt",
        "ad_model_classes": "",
        "ad_tab_enable": True,
        "ad_prompt": prompt,
        "ad_negative_prompt": NEGATIVE,
        "ad_confidence": 0.3,
        "ad_mask_filter_method": "Area",
        "ad_mask_k": 0,
        "ad_mask_min_ratio": 0.0,
        "ad_mask_max_ratio": 1.0,
        "ad_x_offset": 0,
        "ad_y_offset": 0,
        "ad_dilate_erode": 4,
        "ad_mask_merge_invert": "None",
        "ad_mask_blur": 4,
        "ad_denoising_strength": 0.35,
        "ad_inpaint_only_masked": True,
        "ad_inpaint_only_masked_padding": 32,
        "ad_use_inpaint_width_height": False,
        "ad_inpaint_width": 512,
        "ad_inpaint_height": 512,
        "ad_use_steps": True,
        "ad_steps": 24,
        "ad_use_cfg_scale": False,
        "ad_cfg_scale": 7.0,
        "ad_use_checkpoint": False,
        "ad_checkpoint": "Use same checkpoint",
        "ad_use_vae": False,
        "ad_vae": "Use same VAE",
        "ad_use_sampler": False,
        "ad_sampler": "DPM++ 2M",
        "ad_scheduler": "Use same scheduler",
        "ad_use_noise_multiplier": False,
        "ad_noise_multiplier": 1.0,
        "ad_use_clip_skip": False,
        "ad_clip_skip": 1,
        "ad_restore_face": False,
        "ad_controlnet_model": "None",
        "ad_controlnet_module": "None",
        "ad_controlnet_weight": 1.0,
        "ad_controlnet_guidance_start": 0.0,
        "ad_controlnet_guidance_end": 1.0,
    }


def ad_hand(prompt: str) -> dict:
    d = ad_face(prompt)
    d["ad_model"] = "hand_yolov8n.pt"
    d["ad_denoising_strength"] = 0.45
    d["ad_prompt"] = (
        "beautiful detailed hands, five fingers, natural fingers, "
        "correct anatomy, " + prompt
    )
    return d


def polish(init_b64: str, w: int, h: int, prompt: str, denoise: float, ref: str) -> list[bytes]:
    face_p = (
        "beautiful detailed face, dark brown eyes, black-framed glasses, "
        "soft expression, same character"
    )
    body = {
        "prompt": f"{BASE}, {prompt}",
        "negative_prompt": NEGATIVE,
        "init_images": [init_b64],
        "steps": 32,
        "width": w,
        "height": h,
        "cfg_scale": 7,
        "denoising_strength": denoise,
        "sampler_name": "DPM++ 2M",
        "scheduler": "Karras",
        "batch_size": PER,
        "n_iter": 1,
        "seed": -1,
        "alwayson_scripts": {
            "controlnet": {
                "args": [
                    {
                        "enabled": True,
                        "module": "reference_only",
                        "model": "None",
                        "image": ref,
                        "weight": 0.55,
                        "resize_mode": "Crop and Resize",
                        "control_mode": "Balanced",
                        "threshold_a": 0.5,
                        "guidance_start": 0.0,
                        "guidance_end": 0.55,
                        "pixel_perfect": True,
                    }
                ]
            },
            "ADetailer": {
                "args": [
                    True,
                    False,
                    ad_face(face_p),
                    ad_hand(prompt),
                ]
            },
        },
    }
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    imgs = [base64.b64decode(s) for s in data["images"]]
    return imgs[:PER]


def write_gallery(results: dict[str, list[str]]) -> None:
    labels = {
        "cup": "捧杯 · 冷脸里的一点温度（便利店热饮）",
        "smile": "极淡的笑 · 对视（沙发 / 尾声可复用）",
        "towel": "浴后毛巾 · 卸下防备（洗澡后）",
    }
    sections = []
    for slug, files in results.items():
        figs = "".join(
            f'<figure><img src="{Path(f).name}" /><figcaption>{slug}-{i}</figcaption></figure>'
            for i, f in enumerate(files, 1)
        )
        sections.append(
            f"<section><h2>{labels[slug]}</h2><div class=\"grid\">{figs}</div></section>"
        )
    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8" />
<title>三张精修候选</title>
<style>
body{{margin:0;padding:24px;font-family:"Segoe UI","PingFang SC",sans-serif;background:#1a1f28;color:#f3ebe0}}
h1{{font-weight:500}} .hint{{opacity:.75;margin-bottom:24px}}
.grid{{display:grid;grid-template-columns:repeat(2,minmax(200px,1fr));gap:14px;max-width:560px}}
figure{{margin:0;background:#2a3140;border-radius:10px;overflow:hidden;border:1px solid rgba(243,235,224,.12)}}
img{{display:block;width:100%;background:#fff}} figcaption{{padding:8px 10px}}
section{{margin-bottom:32px}} h2{{font-size:1.05rem;font-weight:500}}
</style></head><body>
<h1>三张精修 · 每张 2 候选</h1>
<p class="hint">回编号即可锁定，例如 cup-1、smile-2、towel-1。立绘可跨情节复用。</p>
{"".join(sections)}
</body></html>"""
    (OUT_DIR / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ref = ref_b64()
    results: dict[str, list[str]] = {}
    for slug, src_name, prompt, denoise in PICKS:
        src = CAND / src_name
        print(f"polish {slug} denoise={denoise} ...", flush=True)
        init, w, h = b64_rgb(src)
        imgs = polish(init, w, h, prompt, denoise, ref)
        paths = []
        for i, raw in enumerate(imgs, 1):
            path = OUT_DIR / f"haru_{slug}_{i}.png"
            path.write_bytes(raw)
            paths.append(str(path))
            print(f"  saved {path.name}", flush=True)
        results[slug] = paths
        write_gallery(results)
    write_gallery(results)
    print("done", flush=True)


if __name__ == "__main__":
    main()
