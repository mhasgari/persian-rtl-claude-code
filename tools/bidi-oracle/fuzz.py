"""Random Persian/Latin sentences through the layout, checked against the oracle.

    python3 tools/bidi-oracle/fuzz.py [seed] [sentences] [examples to print]

Differences that are only blank cells ("gap") are the anchors the layout needs
beside a bracket group written without a space; "order" differences are worth a
look, though some are the oracle's own limits (it keeps a Latin phrase whole but
cannot know every tokenisation a reader would).
"""
import json, os, random, re, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import icu

random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
P = ['سلام', 'دنیا', 'پلاگین', 'نسخه‌ی', 'کتاب‌ها', 'می‌کنم', 'آزمایش', 'مورد', 'و', 'را', 'که', 'این', 'تابع', 'فایل', 'متن', 'خط', 'کلمه', 'ردیف']
D = ['۱۲۳', '۴۵', '۰٫۵', '۷', '۱۴۰۴/۰۷/۱۸', '12', '4.5', '2024']
L = ['mod', 'reload', 'Konsole', 'f(x)', '6.png', 'e.g.', 'a-b', 'C++', 'x2']
SYM = ['●', '·', '•', '→', '—', '◆', '-']
END = ['.', '،', '؟', '!', ':', '؛', '…']

def tok():
    r = random.random()
    return (random.choice(P) if r < .55 else random.choice(D) if r < .68 else random.choice(L) if r < .88
            else random.choice(SYM))

def sentence():
    toks = [tok() for _ in range(random.randint(3, 7))]
    for i in range(len(toks) - 1):
        if random.random() < .12:
            toks[i] += random.choice(['،', '؛', ':', '.', '؟'])
    for _ in range(random.randint(0, 2)):
        i = random.randrange(len(toks)); j = random.randrange(i, min(len(toks), i + 4))
        o, c = random.choice([('(', ')'), ('(', ')'), ('[', ']'), ('«', '»'), ('"', '"')])
        toks[i] = o + toks[i]; toks[j] = toks[j] + c
        if random.random() < .3 and j < len(toks) - 1:
            toks[j] += random.choice(['،', '.', '؛'])
    return ' '.join(toks) + random.choice(END)

count = int(sys.argv[2]) if len(sys.argv) > 2 else 400
show = int(sys.argv[3]) if len(sys.argv) > 3 else 8
path = os.path.join(here, '.fuzz.md')
open(path, 'w').write('\n\n'.join(sentence() for _ in range(count)) + '\n')
out = subprocess.run(['bun', os.path.join(here, 'rows.ts'), path, '60'], capture_output=True, text=True, check=True).stdout
rows = json.loads(out)
ws = lambda t: re.sub(r'\s+', '', t)
bad = []
for r in rows:
    if not r['rtl'] or r['marker']:
        continue
    a, i = icu.norm(icu.actual(r['s'])), icu.norm(icu.ideal(r['logical']))
    if a != i:
        bad.append(('gap' if ws(a) == ws(i) else 'order', r, a, i))
print(len(rows), 'rows;', sum(b[0] == 'gap' for b in bad), 'gap-only;', sum(b[0] == 'order' for b in bad), 'order')
for kind, r, a, i in [b for b in bad if b[0] == 'order'][:show]:
    print('\n logical:', r['logical']); print(' ideal  :', icu.readable(i)); print(' actual :', icu.readable(a))
