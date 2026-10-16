"""Generate a self-contained bookmarklet; no remote script dependency."""
from pathlib import Path
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
source = (root / 'tools/export-official-session.js').read_text()
source = '\n'.join(line for line in source.splitlines() if not line.lstrip().startswith('//'))
(root / 'docs').mkdir(exist_ok=True)
(root / 'docs/bookmarklet.txt').write_text('javascript:' + quote(source, safe="()!'*~") + '\n')
print('Generated docs/bookmarklet.txt')
