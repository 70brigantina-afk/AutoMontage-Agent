#!/usr/bin/env python3
"""Small cloud video renderer. Inputs live in cloud-input/; output out/cloud-video.mp4.
This is a basic FFmpeg workflow, not the full AI-directed AutoMontage pipeline.
"""
import os, pathlib, subprocess, tempfile, textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
INPUT = ROOT / "cloud-input"
OUT = ROOT / "out" / "cloud-video.mp4"
OUT.parent.mkdir(exist_ok=True)
mode = os.environ.get("VIDEO_MODE", "script")
aspect = os.environ.get("VIDEO_ASPECT", "vertical")
w, h = (720, 1280) if aspect == "vertical" else (1280, 720)
title = os.environ.get("VIDEO_TITLE", "Мой ролик")
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(font_path, 44 if w == 720 else 52)
small = ImageFont.truetype(font_path, 30 if w == 720 else 36)

def run(*args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True)

def slide(text, path, photo=None):
    if photo:
        im = Image.open(photo).convert("RGB")
        iw, ih = im.size
        scale = max(w / iw, h / ih)
        im = im.resize((round(iw*scale), round(ih*scale)))
        im = im.crop(((im.width-w)//2, (im.height-h)//2, (im.width+w)//2, (im.height+h)//2))
        overlay = Image.new("RGBA", (w,h), (0,0,0,105))
        im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    else:
        im = Image.new("RGB", (w,h), "#17243d")
    draw = ImageDraw.Draw(im)
    lines = textwrap.wrap(text.strip(), width=23 if w == 720 else 44, break_long_words=True)
    lines = lines[:10]
    spacing = 18
    height = len(lines)*(font.size+spacing)
    y = max(45,(h-height)//2)
    for line in lines:
        bb = draw.textbbox((0,0),line,font=font)
        draw.text(((w-(bb[2]-bb[0]))//2,y),line,font=font,fill="white",stroke_width=1,stroke_fill="black")
        y += font.size+spacing
    im.save(path)

with tempfile.TemporaryDirectory() as td:
    temp = pathlib.Path(td)
    if mode == "video":
        source = INPUT / "video.mp4"
        if not source.exists():
            raise SystemExit("Для режима video загрузи cloud-input/video.mp4 в репозиторий.")
        run("ffmpeg","-y","-i",source,"-vf",f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1","-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-movflags","+faststart",OUT)
    else:
        if mode == "script":
            path = INPUT / "script.txt"
            if not path.exists():
                raise SystemExit("Для режима script создай cloud-input/script.txt со сценарием.")
            text = path.read_text(encoding="utf-8").strip()
            if not text:
                raise SystemExit("Файл сценария пуст.")
            chunks = [s.strip() for s in text.split("\n\n") if s.strip()]
            if len(chunks)==1:
                chunks = textwrap.wrap(text, width=90, break_long_words=False)
            items = [(c,None) for c in chunks[:30]]
        elif mode == "photos":
            photos = sorted([p for p in (INPUT / "photos").glob("*") if p.suffix.lower() in (".jpg",".jpeg",".png")])
            if not photos:
                raise SystemExit("Для режима photos загрузи JPG/PNG в cloud-input/photos/.")
            captions = (INPUT / "captions.txt")
            labels = captions.read_text(encoding="utf-8").splitlines() if captions.exists() else []
            items = [(labels[i].strip() if i < len(labels) and labels[i].strip() else title,p) for i,p in enumerate(photos[:30])]
        else:
            raise SystemExit("Неизвестный режим: "+mode)
        concat = temp/"concat.txt"
        with concat.open("w",encoding="utf-8") as f:
            for i,(text,photo) in enumerate(items):
                img = temp/f"slide{i:03}.png"
                slide(text,img,photo)
                f.write(f"file '{img}'\nduration 3\n")
            f.write(f"file '{img}'\n")
        run("ffmpeg","-y","-f","concat","-safe","0","-i",concat,"-vf",f"fps=25,format=yuv420p","-c:v","libx264","-preset","veryfast","-crf","23","-movflags","+faststart",OUT)
print("Видео готово:",OUT)
