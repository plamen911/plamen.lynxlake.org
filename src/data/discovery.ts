import type { Profile } from './types';

const SITE = 'https://plamen.lynxlake.org';
const absolute = (href: string): string => new URL(href, SITE).href;

/** The page's JSON-LD: who this is, for search engines and AI tools. Built from the public profile only. */
export function personJsonLd(profile: Profile): string {
  const { links } = profile;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    url: `${SITE}/`,
    email: `mailto:${profile.email}`,
    jobTitle: 'Backend & AI Engineer',
    description: profile.tagline,
    sameAs: [links.linkedin.href, links.github.href],
    knowsAbout: profile.stack.find((g) => g.name === 'AI/LLM')?.items ?? [],
  };
  // `<` is escaped so the text can never close the script element that holds it.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** /llms.txt: the profile as plain Markdown, for AI tools that read a site on someone's behalf. */
export function llmsTxt(profile: Profile): string {
  const { links } = profile;
  const projects = profile.projects.map((p) => {
    const refs = (p.links ?? []).map((l) => ` [${l.label}](${l.href})`).join('');
    return `- **${p.title}**: ${p.result}${refs}`;
  });
  return [
    `# ${profile.name}`,
    `> ${profile.tagline}`,
    profile.summary,
    `${profile.availability}. Contact: ${profile.email}.`,
    `## Links\n\n${[
      `- [Website with an AI assistant](${SITE}/)`,
      `- [${links.cv.label}](${absolute(links.cv.href)})`,
      `- [${links.linkedin.label}](${links.linkedin.href})`,
      `- [${links.github.label}](${links.github.href})`,
    ].join('\n')}`,
    `## Projects\n\n${projects.join('\n')}`,
    `## How he works with AI\n\n${profile.aiWorkflow.map((w) => `- ${w}`).join('\n')}`,
    `## Stack\n\n${profile.stack.map((g) => `- ${g.name}: ${g.items.join('; ')}`).join('\n')}`,
    `## Terms\n\n${profile.terms.map((t) => `- ${t}`).join('\n')}`,
  ].join('\n\n') + '\n';
}
