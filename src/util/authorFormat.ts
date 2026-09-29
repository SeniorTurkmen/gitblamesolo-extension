/** "Name <email>" when the email should be shown and is known, otherwise just the name. */
export function formatAuthor(name: string, email: string, showEmail: boolean): string {
  return showEmail && email ? `${name} <${email}>` : name;
}
