"""Checks a laid-out table against a correct right-to-left table, cell by cell: each line of
the drawn table, reordered the way Konsole does (icu.actual), must equal the cells of its row in
reverse order, each as a right-to-left paragraph of its own (icu.ideal). Whitespace and the blank
anchors are ignored; the borders and the order of the cells are not.

    bun tools/bidi-oracle/table.ts table.md 80 > t.json && python3 tools/bidi-oracle/table.py t.json
"""
import json,sys,re
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import icu
d=json.load(open(sys.argv[1]))
strip=lambda t: re.sub(r'[\s⠀ ‌]','',icu.norm(t))
def ideal(t): return icu.ideal(t) if re.search(r'[؀-ۿ]',t) else t
body=[l for l in d['lines'] if not re.match(r'^[┌├└]',l)]
k=0; bad=0
for row in d['cellLines']:
    height=max(len(c) for c in row)
    for i in range(height):
        line=body[k]; k+=1
        exp='│'+'│'.join(ideal(c[i]) if i<len(c) else '' for c in reversed(row))+'│'
        ok=strip(exp)==strip(icu.actual(line)); bad+=(not ok)
        if not ok: print('BAD',icu.readable(strip(icu.actual(line))),'\n   expected:',icu.readable(strip(exp)))
print(f'{k} cell lines checked, {bad} differ from a correct right-to-left table')
