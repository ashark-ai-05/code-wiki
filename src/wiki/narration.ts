export interface NarrationRegion {
  /** Byte offset of the character immediately after the start marker's newline. */
  innerStart: number;
  /** Byte offset of the character immediately before the end marker. */
  innerEnd: number;
}

const START_MARKER_RE =
  /<!--\s*narrated:start[^>]*-->[^\n]*\n/;
const END_MARKER_RE =
  /\n\s*<!--\s*narrated:end\s*-->/;

/**
 * Emit a marker block with an empty narration region. Used when generating
 * pages before the narration pass has ever run. The `pagePath` hint lets
 * humans / tooling know which page to target when narrating.
 */
export function emptyNarrationBlock(pagePath: string): string {
  return [
    '<!-- narrated:start narrated_at="" narrated_model="" -->',
    `_No narration yet. Run \`code-wiki narrate --page ${pagePath}\` to generate prose._`,
    '<!-- narrated:end -->',
  ].join('\n');
}

/**
 * Find the offsets of the narration region inside a markdown document.
 * Returns null when the page has no narration markers or only one of them.
 */
export function findNarrationRegion(
  markdown: string
): NarrationRegion | null {
  const startMatch = markdown.match(START_MARKER_RE);
  if (!startMatch || startMatch.index === undefined) return null;

  const afterStart = startMatch.index + startMatch[0].length;
  const remainder = markdown.slice(afterStart);
  const endMatch = remainder.match(END_MARKER_RE);
  if (!endMatch || endMatch.index === undefined) return null;

  return {
    innerStart: afterStart,
    innerEnd: afterStart + endMatch.index,
  };
}
