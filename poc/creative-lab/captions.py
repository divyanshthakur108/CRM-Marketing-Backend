"""Animated caption styles for the POC reel (ASS / libass).
Writes captions_pop.ass, captions_highlight.ass, captions_stack.ass.
Text uses only facts from the project information (TDI Wellington Heights 2)."""

GOLD = "&H0037AFD4&"   # #D4AF37 in ASS BGR order
WHITE = "&H00FFFFFF&"

# (segment duration in s, caption words, key word) in reel order; None = no caption
SHOTS = [
    (5.000, "Your new home in Sector 117", "home"),
    (2.500, "Ready to move", "Ready"),
    (3.542, "Kitchen newly made in HDHMR", "HDHMR"),
    (3.000, "New paint. Untouched flat.", "Untouched"),
    (3.000, "Sun-facing corner flat", "Sun-facing"),
    (3.000, "All cupboards newly made", "newly"),
    (3.500, "4 balconies + side park", "4"),
    (5.167, "₹1.35 Cr. Book your visit.", "₹1.35"),
    (4.625, None, None),  # end card already has the facts
]

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Noto Sans,{size},{primary},{secondary},&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,6,3,2,70,70,780,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ts(s: float) -> str:
    cs = int(round(s * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def timeline():
    t = 0.0
    for dur, text, key in SHOTS:
        if text:
            yield t + 0.25, t + dur - 0.15, text, key
        t += dur


def is_key(word: str, key: str) -> bool:
    return word.strip(".,+").lower().startswith(key.lower())


def pop():
    """1. Pop-up words: each word fades in from 60% and bounces to 112% then 100%."""
    lines = []
    for start, end, text, key in timeline():
        words, out = text.split(), []
        step = min(220, int((end - start) * 1000 * 0.55 / max(1, len(words))))
        for i, w in enumerate(words):
            t0 = i * step
            color = GOLD if is_key(w, key) else WHITE
            out.append(
                f"{{\\alpha&HFF&\\fscx60\\fscy60\\1c{color}"
                f"\\t({t0},{t0 + 1},\\alpha&H00&)\\t({t0},{t0 + 140},\\fscx112\\fscy112)"
                f"\\t({t0 + 140},{t0 + 260},\\fscx100\\fscy100)}}{w}"
            )
        lines.append(f"Dialogue: 0,{ts(start)},{ts(end)},Cap,,0,0,0,,{{\\fad(0,150)}}" + " ".join(out))
    return HEADER.format(size=78, primary=WHITE, secondary=WHITE) + "\n".join(lines) + "\n"


def highlight():
    """2. Highlight captions: whole line appears, words light up gold as if spoken; key word bigger."""
    lines = []
    for start, end, text, key in timeline():
        words = text.split()
        per = int((end - start) * 100 * 0.7 / max(1, len(words)))  # centiseconds per word
        out = []
        for w in words:
            big = "\\fscx118\\fscy118" if is_key(w, key) else "\\fscx100\\fscy100"
            out.append(f"{{\\kf{per}{big}}}{w}")
        lines.append(
            f"Dialogue: 0,{ts(start)},{ts(end)},Cap,,0,0,0,,{{\\fad(120,150)\\blur0.6}}" + " ".join(out)
        )
    # karaoke: SecondaryColour (white) -> PrimaryColour (gold) as each word is "spoken"
    return HEADER.format(size=74, primary=GOLD, secondary=WHITE) + "\n".join(lines) + "\n"


def stack():
    """4. Kinetic stack: 1-2 big words per line, lines slide in from the left one after another."""
    lines = []
    for start, end, text, key in timeline():
        words = text.split()
        chunks, cur = [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) >= 9 or w.endswith("."):
                chunks.append(" ".join(cur)); cur = []
        if cur:
            chunks.append(" ".join(cur))
        top = 1180 - 110 * len(chunks)
        for i, c in enumerate(chunks):
            y = top + i * 110
            delay = i * 0.16
            color = GOLD if any(is_key(w, key) for w in c.split()) else WHITE
            lines.append(
                f"Dialogue: 0,{ts(start + delay)},{ts(end)},Cap,,0,0,0,,"
                f"{{\\an4\\move(-420,{y},70,{y},0,260)\\fad(80,150)\\fs96\\1c{color}}}{c.upper()}"
            )
    return HEADER.format(size=96, primary=WHITE, secondary=WHITE) + "\n".join(lines) + "\n"


if __name__ == "__main__":
    for name, fn in (("pop", pop), ("highlight", highlight), ("stack", stack)):
        with open(f"captions_{name}.ass", "w", encoding="utf-8") as f:
            f.write(fn())
        print("wrote", f"captions_{name}.ass")
