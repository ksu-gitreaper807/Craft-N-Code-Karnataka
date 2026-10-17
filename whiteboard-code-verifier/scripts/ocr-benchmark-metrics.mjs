const critical = /==|!=|<=|>=|&&|\|\||[&;:{}()[\]*=<>+\-/"'\\,#]/g;

function distance(left, right) {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > prefix && rightEnd > prefix && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--; rightEnd--;
  }
  left = left.slice(prefix, leftEnd);
  right = right.slice(prefix, rightEnd);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const next = [row];
    for (let column = 1; column <= right.length; column++) {
      next[column] = Math.min(next[column - 1] + 1, previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = next;
  }
  return previous[right.length];
}

export function scoreTranscript(expected, actual) {
  const normalized = (value) => value.replace(/\r\n?/g, '\n');
  const gold = normalized(expected);
  const guess = normalized(actual);
  const goldCharacters = [...gold];
  const guessCharacters = [...guess];
  const goldLines = gold ? gold.split('\n') : [];
  const guessLines = guess ? guess.split('\n') : [];
  const goldCritical = gold.match(critical) ?? [];
  const guessCritical = guess.match(critical) ?? [];
  return {
    characters: goldCharacters.length,
    characterErrors: distance(goldCharacters, guessCharacters),
    lines: goldLines.length,
    exactLines: goldLines.reduce((count, line, index) => count + Number(line === guessLines[index]), 0),
    criticalSymbols: goldCritical.length,
    criticalErrors: distance(goldCritical, guessCritical),
    exact: gold === guess,
  };
}

export function summarizeScores(scores) {
  const totals = scores.reduce((all, score) => {
    for (const key of ['characters', 'characterErrors', 'lines', 'exactLines', 'criticalSymbols', 'criticalErrors']) {
      all[key] = (all[key] ?? 0) + score[key];
    }
    all.exactSamples = (all.exactSamples ?? 0) + Number(score.exact);
    return all;
  }, {});
  return { samples: scores.length, ...totals,
    characterErrorRate: totals.characters ? totals.characterErrors / totals.characters : Number(Boolean(totals.characterErrors)),
    exactLineRate: totals.lines ? totals.exactLines / totals.lines : 0,
    criticalSymbolErrorRate: totals.criticalSymbols ? totals.criticalErrors / totals.criticalSymbols : Number(Boolean(totals.criticalErrors)) };
}
