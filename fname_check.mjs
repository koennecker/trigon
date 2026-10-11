// print filenames for years given as argv (JSON array)
import fs from 'node:fs';
function epheFile(kind, year) {
  const sgn = year < 0 ? -1 : 1;
  let icty = Math.trunc(year / 100);
  if (sgn < 0 && year % 100 !== 0) icty -= 1;
  while (icty % 6 !== 0) icty--;
  return kind + (icty < 0 ? 'm' : '_') + String(Math.abs(icty)).padStart(2, '0') + '.se1';
}
const years = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = {};
for (const y of years) out[y] = [epheFile('sepl', y), epheFile('semo', y)];
console.log(JSON.stringify(out));
