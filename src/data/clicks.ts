import type { Project } from './types';

/** The name a project link is counted under, e.g. `mcp-go-checker:npmjs` for npmjs.com. */
export const projectClickKey = (projectId: string, href: string): string =>
  `${projectId}:${new URL(href).hostname.replace(/^www\./, '').split('.')[0]}`;

/** Every link name /api/click accepts: the `data-click` values on the page. */
export const clickKeys = (projects: readonly Project[]): string[] => [
  'cv',
  'email',
  'linkedin',
  'github',
  ...projects.flatMap((p) => (p.links ?? []).map((l) => projectClickKey(p.id, l.href))),
];
