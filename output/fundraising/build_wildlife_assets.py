"""Slide-only SVG illustrations derived from the existing shoe artwork and App motifs.
Does not publish or overwrite NFT metadata/artwork.
Requires cairosvg (and Cairo on the host).
"""
from pathlib import Path
import re
import cairosvg
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / 'wildlife-assets'
OUT.mkdir(exist_ok=True)

def pattern(level, ink, shift=0, aurora=False, dusk=False):
    if level == 2:
        motif=f'<path d="M45 96 Q54 77 72 92 Q88 116 66 129 Q46 127 45 96 Z" fill="#121A2E" stroke="{ink}" stroke-width="2"/><path d="M60 93 Q79 107 64 122 M81 103 Q91 121 82 128 Q77 134 73 128" fill="none" stroke="{ink}" stroke-width="2.5"/>'
    elif level == 3:
        motif=f'<path d="M38 113 Q22 101 25 91 Q43 95 51 115" fill="#121A2E" stroke="{ink}" stroke-width="2"/>'
        motif+=''.join(f'<path d="M{67+n*14} {106+n*3} l9 -4 l9 9 l-8 10 l-10 -4 Z" fill="#0B1020" stroke="{ink}" stroke-width="1.5"/>' for n in range(4))
    elif level == 4:
        motif=''.join(f'<path d="M{62+n*12+shift} {102+n*3} l10 2 l-4 12 l-3 5 l-1 -12 Z" fill="{ink}"/>' for n in range(5))
        motif+=f'<path d="M181 111 l9 2 l-7 13 l-5 3 Z M197 115 l8 3 l-6 9 l-5 2 Z" fill="{ink}"/>'
    else:
        motif='<path d="M174 109 Q205 109 218 122 L207 130 Q187 135 174 130 Z" fill="#AAB7CC" fill-opacity="0.22"/>'
        motif+=''.join(f'<ellipse cx="{68+n%3*18+shift}" cy="{109+n//3*13}" rx="6" ry="4" fill="none" stroke="{ink}" stroke-width="2.4" stroke-dasharray="6 3"/>' for n in range(6))
        motif+=f'<path d="M181 120 q5 -7 10 0 q-4 7 -10 0 M200 123 q5 -7 10 0" fill="none" stroke="{ink}" stroke-width="2"/>'
    dash=' stroke-dasharray="4 3"' if dusk else ''
    return motif+f'<path d="M47 136 Q110 151 202 138" fill="none" stroke="{ink}" stroke-width="{2.5 if aurora else 1.5}"{dash}/>'

for level in range(2,6):
    for variant,ink,shift in [('dawn','#FFCB66',0),('dusk','#9B6CFF',3),('aurora','#30EBC8',-3)]:
        svg=(ROOT/f'web/nft/img/{level}.svg').read_text()
        svg=re.sub(r'<text\b.*?</text>', '', svg, flags=re.S)
        svg=svg.replace('viewBox="0 0 520 520" width="520" height="520"','viewBox="0 90 520 320" width="1040" height="640"')
        svg=svg.replace('<path d="M125 124',pattern(level,ink,shift,variant=='aurora',variant=='dusk')+'<path d="M125 124',1)
        dest=OUT/f'lv{level}-{variant}'
        dest.with_suffix('.svg').write_text(svg)
        cairosvg.svg2png(bytestring=svg.encode(),write_to=str(dest.with_suffix('.png')))
print('Created 12 slide illustrations')
