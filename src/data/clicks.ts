import type { Project } from './types';

/** The name a project link is counted under, e.g. `mcp-go-checker:npmjs` for npmjs.com. */
export const projectClickKey = (projectId: string, href: string): string =>
  `${projectId}:${new URL(href).hostname.replace(/^www\./, '').split('.')[0]}`;

/** The name a page view is counted under, beside the link clicks. */
export const VIEW_KEY = 'view';

/** Every name /api/click accepts: the page view and the `data-click` values on the page. */
export const clickKeys = (projects: readonly Project[]): string[] => [
  VIEW_KEY,
  'cv',
  'email',
  'linkedin',
  'github',
  ...projects.flatMap((p) => (p.links ?? []).map((l) => projectClickKey(p.id, l.href))),
];
