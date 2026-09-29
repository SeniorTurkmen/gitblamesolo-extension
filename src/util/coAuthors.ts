export interface Person {
  name: string;
  email: string;
}

const CO_AUTHOR_LINE = /^co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/i;

/**
 * Pulls "Co-authored-by: Name <email>" trailers out of a commit message body.
 * Returns the co-authors, without duplicates or the commit's own author, and
 * the body without those lines so they aren't shown twice.
 */
export function extractCoAuthors(body: string, authorEmail = ''): { coAuthors: Person[]; body: string } {
  const coAuthors: Person[] = [];
  const seen = new Set<string>([authorEmail.toLowerCase()]);
  const kept: string[] = [];
  for (const line of body.split('\n')) {
    const match = CO_AUTHOR_LINE.exec(line.trim());
    if (!match) {
      kept.push(line);
      continue;
    }
    const [, name, email] = match;
    const key = email.toLowerCase() || name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      coAuthors.push({ name: name || email, email });
    }
  }
  return { coAuthors, body: kept.join('\n').trim() };
}
