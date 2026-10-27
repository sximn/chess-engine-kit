"""Freeze 200 complete, non-mate-in-one rows from a supplied Lichess CC0 CSV prefix.
Download example: curl --range 0-262143 https://database.lichess.org/lichess_db_puzzle.csv.zst -o /tmp/puzzles.zst
zstd -dc /tmp/puzzles.zst > /tmp/puzzles.csv  # truncated-frame warning expected for a range prefix
python3 scripts/import-puzzle-corpus.py /tmp/puzzles.csv
No filtering based on engine performance. First 100 development, next 100 held out.
"""
import csv, hashlib, json, sys
from pathlib import Path
rows = []
for row in csv.DictReader(Path(sys.argv[1]).read_text().splitlines()):
    if row.get('OpeningTags') is None or not row.get('Themes') or 'mateIn1' in row['Themes'].split():
        continue
    moves = row['Moves'].split()
    if len(moves) < 2:
        continue
    rows.append(dict(id=row['PuzzleId'], partition='development' if len(rows)<100 else 'held-out', rootFen=row['FEN'], movesUci=[moves[0]], solution=moves[1:], rating=int(row['Rating']), themes=row['Themes'].split(), gameUrl=row['GameUrl']))
    if len(rows) == 200:
        break
assert len(rows) == 200
result = dict(version=1, source='https://database.lichess.org/lichess_db_puzzle.csv.zst', rights='CC0-1.0, https://database.lichess.org/#puzzles', retrieved='2026-10-26', sampling='First 200 complete non-mateIn1 rows in a 262144-byte compressed prefix. No performance-based exclusion. Convenience sample, not population-representative.', prefixCsvSha256=hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(), positions=rows)
Path('tests/fixtures/tactical-corpus.json').write_text(json.dumps(result, indent=2)+'\n')
