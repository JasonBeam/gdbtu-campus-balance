"""Embed reviewed local onboarding sources into the standalone widget; no downloads."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
script=ROOT/'scriptable/校园余额.js'
start='// BEGIN GENERATED SCHOOL ONBOARDING\n'
end='// END GENERATED SCHOOL ONBOARDING\n'
core=(ROOT/'tools/onboarding-core.js').read_text()
nav=(ROOT/'tools/onboarding/official-login.js').read_text()
noise=(ROOT/'tools/onboarding/portal-noise-filter.js').read_text()
flow=(ROOT/'tools/onboarding/scriptable-flow.js').read_text()
panel=(ROOT/'tools/onboarding/inline-panel.js').read_text()
block=start+core+'\nconst OFFICIAL_NAVIGATION='+json.dumps(nav,ensure_ascii=False)+';\nconst PORTAL_ERROR_FILTER='+json.dumps(noise,ensure_ascii=False)+';\n'+panel+'\n'+flow+'\n'+end
source=script.read_text()
if start in source:
 before,tail=source.split(start,1);_,after=tail.split(end,1);source=before+block+after
else:
 source=source.replace('async function configure(){',block+'\nasync function configure(){',1)
script.write_text(source)
