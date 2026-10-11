#!/usr/bin/env python3
"""Build a compact composite city gazetteer from GeoNames cities5000 + countryInfo.
Output: data/cities.json — array of [name, asciiname, country, pop, lat, lng, [alt, ...]]
sorted by population descending. License: GeoNames CC-BY 4.0 (attribution required).
"""
import json, os, re, unicodedata, gzip

DATA = os.path.dirname(os.path.abspath(__file__)) + '/'

def levenshtein(a, b):
    if abs(len(a) - len(b)) > 4:
        return 99
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (ca != cb)))
        prev = cur
    return prev[-1]

def ascii_fold(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower())
                   if unicodedata.category(c) != 'Mn')

def is_latin_useful(s):
    if not s or len(s) > 30:
        return False
    has_ascii_letter = False
    has_vowel = False
    for ch in s:
        if ch.isascii() and ch.isalpha():
            has_ascii_letter = True
            if ch.lower() in 'aeiou':
                has_vowel = True
        elif ch.isalpha():
            # allow Latin diacritics, block other scripts
            try:
                if 'LATIN' not in unicodedata.name(ch):
                    return False
                if unicodedata.name(ch).split()[-1] in ('A', 'E', 'I', 'O', 'U'):
                    has_vowel = True
            except ValueError:
                return False
        elif ch not in " -'’.":
            return False
    # vowel requirement drops transliteration fragments (pkn, bkyn) and
    # airport codes (BJS, MOW) while keeping real exonyms (Roma, Peking)
    return has_ascii_letter and has_vowel

countries = {}
with open(DATA + 'countryInfo.txt', encoding='utf-8') as f:
    for line in f:
        if line.startswith('#') or not line.strip():
            continue
        p = line.rstrip('\n').split('\t')
        countries[p[0]] = p[4]

cities = []
with open(DATA + 'cities5000.txt', encoding='utf-8') as f:
    for line in f:
        p = line.rstrip('\n').split('\t')
        name, asciiname, alts = p[1], p[2], p[3]
        lat, lng = round(float(p[4]), 5), round(float(p[5]), 5)
        country = countries.get(p[8], p[8])
        pop = int(p[14]) if p[14] else 0
        fcode = p[7]
        # drop subdivisions/sections (PPLX) and hamlet-level localities (PPLL):
        # not cities, they pollute results (e.g. "Paris 15 Vaugirard")
        if fcode in ('PPLX', 'PPLL'):
            continue
        # real cities don't have digits in their names; this drops
        # arrondissements ("Paris 15 Vaugirard"), census tracts, etc.
        if re.search(r'\d', name):
            continue
        seen = {name.lower(), asciiname.lower()}
        cands = []
        for a in alts.split(','):
            a = a.strip()
            al = a.lower()
            if a and al not in seen and is_latin_useful(a):
                seen.add(al)
                # native exonyms sit close to the primary name
                # (München/Munich, Warszawa/Warsaw); junk transliterations don't
                na, nas = ascii_fold(name), ascii_fold(asciiname)
                fa = ascii_fold(a)
                d = min(levenshtein(fa, na), levenshtein(fa, nas))
                cands.append(((d, len(a), 0 if a.isascii() else 1), a))
        cands.sort(key=lambda t: t[0])
        # no cap: tiered search ranking contains the junk; recall matters more
        # than a few MB on a fetch-once-cache-forever asset
        kept = [a for _, a in cands]
        cities.append([name, asciiname, country, pop, lat, lng, kept])

cities.sort(key=lambda c: -c[3])
with open(DATA + 'cities.json', 'w', encoding='utf-8') as f:
    json.dump(cities, f, ensure_ascii=False, separators=(',', ':'))

raw = open(DATA + 'cities.json', encoding='utf-8').read()
gz = gzip.compress(raw.encode('utf-8'))
print(f'entries: {len(cities)}')
print(f'raw: {len(raw)/1e6:.2f} MB, gzipped: {len(gz)/1e6:.2f} MB')
print(f'with alternates: {sum(1 for c in cities if c[6])}')
