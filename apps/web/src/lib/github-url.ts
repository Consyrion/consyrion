/** "https://github.com/owner/repo(.git)" → "owner/repo"; anything else → null. */
export function repositoryFullName(url: string | null | undefined): string | null {
  const match = url?.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}
