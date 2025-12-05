import { writeFileSync } from 'node:fs';

import { readRaw, readStringPairsAsMap } from '../../utils/csv.ts';
import { normalizeJSONLike, StrictJSON } from '../../utils/json.ts';
import { defined } from '../../utils/miscellaneous.ts';

const scoreToInt: (score: string) => number = (score: string): number => {
  return (
    {
      A: 1,
      B: 2,
      C: 3,
      D: 4,
      E: 5,
    }[score] ?? 0
  );
};

const drugNameToSpecialtyToScore: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();
for (const [specialty, drugName, , score] of readRaw(
  `${import.meta.dirname}/../../datasources/specialty-medications-ososs/out/specialty-medications-ososs.csv`,
) as [string, string, string, string, string, string, string, string, string][]) {
  drugNameToSpecialtyToScore.set(
    drugName,
    (drugNameToSpecialtyToScore.get(drugName) ?? new Map<string, number>()).set(specialty, scoreToInt(score)),
  );
}

const specialties: Set<string> = new Set<string>(
  Array.from(drugNameToSpecialtyToScore.values()).flatMap((specialtyToScore: Map<string, number>): string[] =>
    Array.from(specialtyToScore.keys()),
  ),
);

const cleanRcta: Set<string> = new Set<string>(
  readStringPairsAsMap(`${import.meta.dirname}/../rcta/out/rcta-composed-to-rcta-composed-clean.csv`).values(),
).difference(new Set<string>(['']));

const rctaToSpecialty: Map<string, Map<string, number>> = new Map<string, Map<string, number>>();

for (const rcta of cleanRcta) {
  for (const specialty of specialties) {
    let score: number | undefined = drugNameToSpecialtyToScore.get(rcta)?.get(specialty);
    if (!defined(score)) {
      score = Math.min(
        ...rcta
          .split('+')
          .map((rctaPart: string): number | undefined => drugNameToSpecialtyToScore.get(rctaPart)?.get(specialty))
          .filter(defined),
      );
      if (Infinity === score) {
        score = undefined;
      }
    }
    rctaToSpecialty.set(rcta, (rctaToSpecialty.get(rcta) ?? new Map<string, number>()).set(specialty, score ?? 0));
  }
}

writeFileSync(
  `${import.meta.dirname}/out/rcta-to-specialty.json`,
  StrictJSON.stringify(
    normalizeJSONLike(
      Object.fromEntries(
        Array.from(
          rctaToSpecialty.entries(),
          ([rcta, specialtyToScore]: [string, Map<string, number>]): [string, { [_: string]: number }] => [
            rcta,
            Object.fromEntries(specialtyToScore.entries()),
          ],
        ),
      ),
    ),
    undefined,
    2,
  ),
  { encoding: 'utf-8', flush: true },
);
