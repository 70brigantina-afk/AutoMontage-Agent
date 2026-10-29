import math, wave, struct, pathlib, subprocess
from PIL import Image, ImageDraw, ImageFont
O=pathlib.Path("out"); O.mkdir(exist_ok=True)
W,H,FPS,D=540,960,24,20
font="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
big=ImageFont.truetype(font,42); small=ImageFont.truetype(font,25)
scenes=[("НУЖНЫ КЛИЕНТЫ?",["На создание сайтов"],"start"),("ПОКАЖИ РЕЗУЛЬТАТ",["Выбери одну нишу","Сделай пример сайта"],"site"),("НАЧНИ ДИАЛОГ",["Найди бизнес с задачей","Предложи конкретное улучшение"],"chat"),("УПРОСТИ ПЕРВЫЙ ШАГ",["Предложи короткий разбор","Договорись о следующем шаге"],"done")]
p=subprocess.Popen(["ffmpeg","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libx264","-preset","veryfast","-crf","22","-pix_fmt","yuv420p",str(O/"silent.mp4")],stdin=subprocess.PIPE)
for n in range(FPS*D):
 t=n/FPS; idx=min(3,int(t/5)); u=t%5; title,lines,kind=scenes[idx]
 im=Image.new("RGB",(W,H),(15,20,38)); d=ImageDraw.Draw(im)
 for j in range(7):
  x=int((j*113+t*18)%700)-80; y=int(140+j*105+20*math.sin(t+j))
  d.ellipse((x,y,x+100,y+100),outline=(30,47,69),width=2)
 def center(txt,y,f,fill):
  bb=d.textbbox((0,0),txt,font=f); d.text(((W-bb[2])/2,y),txt,font=f,fill=fill)
 center("КЛИЕНТЫ • САЙТЫ • РОСТ",90,small,"#7ee5c0")
 # Website / conversation animation
 shift=int(22*math.exp(-u*3)); y=230+shift
 d.rounded_rectangle((65,y,475,y+290),radius=22,fill="#24324c",outline="#7ee5c0",width=3)
 for j in range(3): d.ellipse((85+j*20,y+16,94+j*20,y+25),fill="#7ee5c0")
 if kind in ("start","site"):
  d.rounded_rectangle((88,y+55,452,y+140),radius=12,fill="#7357dd")
  d.rounded_rectangle((108,y+78,310,y+92),radius=5,fill="white")
  for j in range(3):
   xx=88+j*124; d.rounded_rectangle((xx,y+164,xx+112,y+236),radius=8,fill="#3d526d")
  d.rounded_rectangle((180,y+253,360,y+275),radius=8,fill="#7ee5c0")
 else:
  for j in range(3):
   x=90 if j%2==0 else 150; yy=y+65+j*65
   d.rounded_rectangle((x,yy,x+280,yy+48),radius=14,fill="#7357dd" if j%2==0 else "#34705f")
   d.line((x+20,yy+23,x+220,yy+23),fill="white",width=4)
 # Wrap headline to fit
 words=title.split(); rows=[]; row=""
 for word in words:
  trial=(row+" "+word).strip()
  if d.textbbox((0,0),trial,font=big)[2]>490: rows.append(row); row=word
  else: row=trial
 rows.append(row)
 for j,row in enumerate(rows): center(row,575+j*54,big,"white")
 for j,line in enumerate(lines): center(line,720+j*40,small,"#d1d9e9")
 d.rounded_rectangle((40,887,500,893),radius=3,fill="#24324c")
 d.rounded_rectangle((40,887,40+max(1,int(460*t/D)),893),radius=3,fill="#7ee5c0")
 p.stdin.write(im.tobytes())
p.stdin.close()
if p.wait()!=0: raise RuntimeError("Video encoding failed")
# Original instrumental: chords, plucked melody, kick and hi-hat.
sr=44100; notes=[261.63,329.63,392,493.88,440,392,329.63,293.66]
with wave.open(str(O/"music.wav"),"wb") as wav:
 wav.setparams((1,2,sr,0,"NONE","not compressed"))
 data=bytearray()
 for i in range(sr*D):
  t=i/sr; beat=t*2; phase=beat%1
  root=[130.81,110,87.31,98][int(t/5)%4]
  chord=sum(math.sin(2*math.pi*root*r*t) for r in [1,1.25,1.5])/3
  mel=math.sin(2*math.pi*notes[int(beat*2)%8]*t)*math.exp(-5*((beat*2)%1))
  kick=math.sin(2*math.pi*(50*t+2*(1-math.exp(-30*phase))))*math.exp(-15*phase)
  hat=math.sin(2*math.pi*7900*t)*math.sin(2*math.pi*11300*t)*math.exp(-35*((beat*2)%1))
  fade=min(1,t/1.2,(D-t)/1.5)
  v=(.16*chord+.16*mel+.23*kick+.05*hat)*fade
  data.extend(struct.pack("<h",int(max(-1,min(1,v))*26000)))
 wav.writeframes(data)
subprocess.run(["ffmpeg","-y","-i",str(O/"silent.mp4"),"-i",str(O/"music.wav"),"-c:v","copy","-c:a","aac","-b:a","160k","-shortest","-movflags","+faststart",str(O/"clients-with-music.mp4")],check=True)
