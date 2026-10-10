"""Oracle for the layout.

`actual` is what Konsole draws for the string the plugin emits: ICU's bidi
algorithm with a left-to-right paragraph and no glyph mirroring (both read off
screenshots of Konsole). `ideal` is what a correct right-to-left renderer draws
for the logical text: ICU bidi with a right-to-left paragraph and brackets
mirrored. A row is right when the two are equal.

Run with the output of rows.ts on stdin:

    bun tools/bidi-oracle/rows.ts text.md 114 | python3 tools/bidi-oracle/icu.py

Needs ICU (libicuuc) on the system; the version suffix of its symbols is found
automatically.
"""
import ctypes, ctypes.util, json, re, sys

_name = ctypes.util.find_library('icuuc')
if not _name:
    sys.exit('libicuuc (ICU) not found')
lib = ctypes.CDLL(_name)
_suffix = next((s for s in [''] + ['_%d' % n for n in range(99, 50, -1)] if hasattr(lib, 'ubidi_open' + s)), None)
if _suffix is None:
    sys.exit('ICU bidi symbols not found in ' + _name)

def _fn(name):
    return getattr(lib, name + _suffix)

_open, _set, _map, _levels, _close, _mirror = (
    _fn('ubidi_open'), _fn('ubidi_setPara'), _fn('ubidi_getVisualMap'),
    _fn('ubidi_getLevels'), _fn('ubidi_close'), _fn('u_charMirror'))
_open.restype = ctypes.c_void_p
_levels.restype = ctypes.POINTER(ctypes.c_uint8)
_mirror.restype = ctypes.c_int32

def _run(s, level):
    units = s.encode('utf-16-le'); n = len(units) // 2
    buf = (ctypes.c_uint16 * n).from_buffer_copy(units)
    para = ctypes.c_void_p(_open()); err = ctypes.c_int(0)
    _set(ctypes.c_void_p(para.value), buf, ctypes.c_int32(n), ctypes.c_uint8(level), None, ctypes.byref(err))
    m = (ctypes.c_int32 * n)(); _map(ctypes.c_void_p(para.value), m, ctypes.byref(err))
    lv = _levels(ctypes.c_void_p(para.value), ctypes.byref(err))
    levels = [lv[i] for i in range(n)]
    _close(ctypes.c_void_p(para.value))
    chars = [units[2*i:2*i+2].decode('utf-16-le', 'surrogatepass') for i in range(n)]
    return chars, list(m), levels

def actual(s):
    chars, m, _ = _run(s, 0)
    return ''.join(chars[m[i]] for i in range(len(chars)))

_LATIN = re.compile(r'[A-Za-z]')
_PERSIAN = re.compile(r'[\u0600-\u06FF]')

_EDGE_LEAD = '«([{"“‘<'
_EDGE_TRAIL = '.,;:!?،؛؟…»)]}"”’>'
_PAIR = {'(': ')', '[': ']', '{': '}', '«': '»', '<': '>'}

def _core(tok):
    """Split a token into (lead, core, trail): sentence punctuation at its edges is
    not part of the Latin word, a bracket pair inside it is."""
    lead = trail = ''
    while tok and tok[0] in _EDGE_LEAD and tok.count(tok[0]) > tok.count(_PAIR.get(tok[0], '\0')):
        lead += tok[0]; tok = tok[1:]
    while tok and tok[-1] in _EDGE_TRAIL:
        c = tok[-1]
        opener = next((k for k, v in _PAIR.items() if v == c), None)
        if opener and tok.count(opener) >= tok.count(c):
            break
        trail = c + trail; tok = tok[:-1]
    return lead, tok, trail

_PERSIAN_LETTER = re.compile(r'[\u0621-\u063A\u0641-\u064A\u066E-\u06D5\u06F0-\u06F9\u0660-\u0669\u0750-\u077F]')
_ASCII_NUM = re.compile(r'^[0-9.,:/%+\-]+$')

def isolate_latin(s):
    """A sensible renderer keeps a Latin phrase whole ("Vazir Code Hack", 6.png,
    mod(1)); plain UBA would split it around digits and punctuation. Wrap each
    maximal run of Latin words (and ASCII numbers beside them), less the sentence
    punctuation at its edges, in LRI..PDI so the oracle does too."""
    toks = re.split(r'(\s+)', s)
    words = [i for i, t in enumerate(toks) if t.strip()]
    latin = {i for i in words if _LATIN.search(toks[i]) and not _PERSIAN_LETTER.search(toks[i])}
    ascii_num = {i for i in words if i not in latin and _ASCII_NUM.match(toks[i])}
    # a token with no letter or digit at all (an arrow, a dash) between two Latin
    # tokens is Latin too: neutrals between two left-to-right letters take their side
    neutral = {i for i in words if i not in latin and i not in ascii_num
               and not re.search(r'[\w]', toks[i]) and not _PERSIAN.search(toks[i])}
    for k, i in enumerate(words):
        if i in neutral:
            prev_ok = k > 0 and (words[k - 1] in latin or words[k - 1] in ascii_num or words[k - 1] in neutral)
            next_ok = k + 1 < len(words) and (words[k + 1] in latin or words[k + 1] in ascii_num)
            if not (prev_ok and next_ok):
                neutral.discard(i)
    phrases, cur = [], []
    for i in words:
        if i in latin or i in neutral or (i in ascii_num and cur):
            cur.append(i)
        else:
            if cur: phrases.append(cur)
            cur = []
    if cur: phrases.append(cur)
    for ph in phrases:
        while ph and ph[-1] in neutral: ph = ph[:-1]
        if not ph or not any(i in latin for i in ph): continue
        lead, _, _ = _core(toks[ph[0]])
        _, _, trail = _core(toks[ph[-1]])
        toks[ph[0]] = toks[ph[0]][len(lead):]
        if len(ph) == 1:
            if trail: toks[ph[0]] = toks[ph[0]][:-len(trail)]
        else:
            if trail: toks[ph[-1]] = toks[ph[-1]][:-len(trail)]
        toks[ph[0]] = lead + '\u2066' + toks[ph[0]]
        toks[ph[-1]] = toks[ph[-1]] + '\u2069' + trail
    return ''.join(toks)

def ideal(s):
    chars, m, levels = _run(isolate_latin(s), 1)
    out = []
    for i in range(len(chars)):
        c, lvl = chars[m[i]], levels[m[i]]
        if lvl % 2 == 1:
            mc = _mirror(ctypes.c_int32(ord(c)))
            c = chr(mc)
        out.append(c)
    return ''.join(out)

def norm(t):
    # isolates are the oracle's own scaffolding; a zero-width joiner or non-joiner
    # has no width and only shapes the letters beside it, so where it sits is not order
    for cp in (0x2066, 0x2067, 0x2068, 0x2069, 0x200c, 0x200d):
        t = t.replace(chr(cp), '')
    return t.replace(chr(0x2800), ' ').replace(chr(0xa0), ' ')

def readable(v):
    """Un-reverse right-to-left letter runs so a visual string can be read."""
    import unicodedata
    out, run = [], []
    def flush():
        out.extend(reversed(run)); run.clear()
    for c in v:
        if unicodedata.bidirectional(c) in ('R', 'AL') or (c == '‌' and run):
            run.append(c)
        else:
            flush(); out.append(c)
    flush()
    return ''.join(out)

if __name__ == '__main__':
    rows = json.load(sys.stdin); bad = 0
    for r in rows:
        if not r['rtl'] or r['marker']:
            continue
        a, i = norm(actual(r['s'])), norm(ideal(r['logical']))
        if a != i:
            bad += 1
            print(f"MISMATCH [{r['block']}.{r['row']}]\n  logical : {r['logical']}\n  ideal   : {readable(i)}\n  actual  : {readable(a)}\n")
    print(f"{len(rows)} rows, {bad} mismatches")
