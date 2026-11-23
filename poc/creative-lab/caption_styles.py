"""Three animated caption styles (rebuilt from common reel motion patterns, not copied templates).
Usage: python3 caption_styles.py <script.json> <voice_dir_seconds_key> <order spec> -> captions_<style>.ass
"""
import json, sys

GOLD, WHITE, BLACK = "&H0037AFD4&", "&H00FFFFFF&", "&H00000000&"

HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Big,Noto Sans,118,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,8,4,5,60,60,0,1
Style: Box,Noto Sans,118,&H00000000&,&H00000000&,&H0037AFD4&,&H0037AFD4&,-1,0,0,0,100,100,0,0,3,18,0,5,60,60,0,1
Style: Line,Noto Sans,92,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,7,3,5,60,60,0,1
Style: Lux,Avenir Next,112,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1
Style: Shade,Arial,20,&H00000000&,&H00000000&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Type,Noto Sans,86,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,7,3,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
Y = 1060  # caption centre: above the bottom 380 px platform zone, below faces/headers


def ts(x):
    cs = int(round(max(0, x) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def is_key(w, key):
    return w.strip(",.!").lower().startswith(key.lower())


def shots(script, order, sec_key):
    """Yield (voice_start, shot_end, words, key, voice_seconds) per captioned shot."""
    by = {s["id"]: s for s in script["shots"]}
    t = 0.0
    for sid, dur in order:
        s = by[sid]
        if sid != "end":
            yield t + 0.15, t + dur - 0.1, s["caption"].split(), s["key"], s.get(sec_key) or dur * 0.6
        t += dur


def style_chunks(script, order, sec_key):
    """A. 1-2 word chunks pop in at the centre; the chunk with the key word sits in a gold box."""
    out = []
    for start, end, words, key, vs in shots(script, order, sec_key):
        chunks, cur = [], []
        for w in words:
            cur.append(w)
            if len(cur) == 2 or is_key(w, key) or len(" ".join(cur)) > 11:
                chunks.append(cur); cur = []
        if cur:
            chunks.append(cur)
        span = max(vs, 1.2) / len(chunks)
        for i, c in enumerate(chunks):
            a = start + i * span
            b = end if i == len(chunks) - 1 else a + span
            text = " ".join(c).upper()
            pop = "\\fscx70\\fscy70\\t(0,110,\\fscx112\\fscy112)\\t(110,200,\\fscx100\\fscy100)"
            if any(is_key(w, key) for w in c):
                out.append(f"Dialogue: 1,{ts(a)},{ts(b)},Box,,0,0,0,,{{\\pos(540,{Y})\\fad(40,60){pop}}} {text} ")
            else:
                out.append(f"Dialogue: 0,{ts(a)},{ts(b)},Big,,0,0,0,,{{\\pos(540,{Y})\\fad(40,60){pop}}}{text}")
    return HEAD + "\n".join(out) + "\n"


def style_slide(script, order, sec_key):
    """B. Line(s) slide up from behind a mask, staggered; key word gold."""
    out = []
    for start, end, words, key, vs in shots(script, order, sec_key):
        half = (len(words) + 1) // 2
        lines = [words[:half], words[half:]] if len(words) > 3 else [words]
        for i, ln in enumerate(lines):
            if not ln:
                continue
            y = Y - 55 * (len(lines) - 1) + i * 110
            a = start + i * 0.18
            txt = " ".join(f"{{\\1c{GOLD}}}{w}{{\\1c{WHITE}}}" if is_key(w, key) else w for w in ln)
            clip = f"\\clip(0,{y - 70},1080,{y + 70})"
            out.append(
                f"Dialogue: 0,{ts(a)},{ts(end)},Line,,0,0,0,,{{{clip}\\move(540,{y + 140},540,{y},0,320)\\fad(0,120)}}{txt}"
            )
    return HEAD + "\n".join(out) + "\n"


def style_type(script, order, sec_key):
    """C. Typewriter: characters appear one by one with a blinking cursor; key word gold."""
    out = []
    for start, end, words, key, vs in shots(script, order, sec_key):
        text = " ".join(words)
        total = min(max(vs * 0.85, 0.8), (end - start) * 0.8)
        step = total / max(1, len(text))
        spans = []  # (char index range) of key word for colouring
        pos = 0
        for w in words:
            if is_key(w, key):
                spans.append((pos, pos + len(w)))
            pos += len(w) + 1

        def render(n):
            s = ""
            for i, ch in enumerate(text[:n]):
                gold = any(a <= i < b for a, b in spans)
                s += (f"{{\\1c{GOLD}}}{ch}{{\\1c{WHITE}}}" if gold else ch)
            return s

        for n in range(1, len(text) + 1):
            a = start + (n - 1) * step
            b = start + n * step
            out.append(f"Dialogue: 0,{ts(a)},{ts(b)},Type,,0,0,0,,{{\\pos(540,{Y})}}{render(n)}|")
        # full text, cursor blinks
        t = start + len(text) * step
        blink = True
        while t < end:
            nxt = min(end, t + 0.35)
            out.append(f"Dialogue: 0,{ts(t)},{ts(nxt)},Type,,0,0,0,,{{\\pos(540,{Y})}}{render(len(text))}{'|' if blink else ' '}")
            blink = not blink
            t = nxt
    return HEAD + "\n".join(out) + "\n"


# Short editorial pairs (same facts as the long captions) for the luxury style
LUX = {
    "v1": ("CLASSIC", "VILLA STYLE"), "v2": ("SUN-FACING", "CORNER"), "v3": ("FOUR", "BALCONIES"),
    "s3": ("BRAND NEW", "UNTOUCHED"), "s4": ("HDHMR", "KITCHEN"), "s5": ("FRESH", "INTERIORS"),
    "s6": ("NEW", "CUPBOARDS"), "s7": ("OPEN", "TERRACE"), "vd": ("GOLDEN", "HOUR"),
    "pr": ("SAT SRI", "AKAL JI"),
}


def style_lux(script, order, sec_key):
    """D. Luxury: thin wide-spaced uppercase, two stacked lines, soft blur-in while the letters
    slowly spread apart (reference: cinematic real-estate reels)."""
    out = []
    t = 0.0
    for sid, dur in order:
        pair = LUX.get(sid)
        if pair:
            top = 430 if sid == "pr" else 800  # presenter: keep his face clear
            # soft blurred shade behind both lines so thin white text reads on white walls
            y0, y1 = top - 110, top + 260
            out.append(f"Dialogue: 0,{ts(t + 0.2)},{ts(t + dur - 0.1)},Shade,,0,0,0,,"
                       f"{{\\pos(0,0)\\fad(500,450)\\1a&H90&\\blur60\\p1}}m 60 {y0} l 1020 {y0} 1020 {y1} 60 {y1}{{\\p0}}")
            for i, line in enumerate(pair):
                a, b = t + 0.25 + i * 0.3, t + dur - 0.15
                y = top + i * 150
                anim = ("\\fad(550,450)\\fsp6\\blur9\\bord2\\3a&H90&\\4a&H80&\\shad3"
                        "\\t(0,900,\\fsp22\\blur1.2)")
                out.append(f"Dialogue: 1,{ts(a)},{ts(b)},Lux,,0,0,0,,{{\\pos(540,{y}){anim}}}{line}")
        t += dur
    return HEAD + "\n".join(out) + "\n"


if __name__ == "__main__":
    script = json.load(open(sys.argv[1]))
    sec_key = sys.argv[2]
    order = [(p.split(":")[0], float(p.split(":")[1])) for p in sys.argv[3].split(",")]
    styles = {"chunks": style_chunks, "slide": style_slide, "type": style_type, "lux": style_lux}
    pick = sys.argv[4].split(",") if len(sys.argv) > 4 else list(styles)
    for name, fn in ((n, styles[n]) for n in pick):
        open(f"captions_E_{name}.ass", "w", encoding="utf-8").write(fn(script, order, sec_key))
        print("wrote", f"captions_E_{name}.ass")
