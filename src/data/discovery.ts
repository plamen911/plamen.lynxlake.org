import type { Profile } from './types';

const SITE = 'https://plamen.lynxlake.org';
const absolute = (href: string): string => new URL(href, SITE).href;

/** Today's date (YYYY-MM-DD) at build time: the site is static, so a build is a content change. */
export const buildDate = (): string => new Date().toISOString().slice(0, 10);

/**
 * The page's JSON-LD graph: the site, the profile page, the person it is about and the FAQ, for search engines and
 * AI tools. Built from the public profile only.
 */
export function siteJsonLd(profile: Profile, dateModified: string = buildDate()): string {
  const { links } = profile;
  const person = `${SITE}/#person`;
  const website = `${SITE}/#website`;
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': website,
        url: `${SITE}/`,
        name: profile.name,
        inLanguage: 'en',
        publisher: { '@id': person },
      },
      {
        '@type': 'ProfilePage',
        '@id': `${SITE}/#profilepage`,
        url: `${SITE}/`,
        name: `${profile.name} — Backend & AI Engineer`,
        inLanguage: 'en',
        isPartOf: { '@id': website },
        mainEntity: { '@id': person },
        dateModified,
      },
      {
        '@type': 'Person',
        '@id': person,
        name: profile.name,
        alternateName: 'Пламен Марков',
        givenName: 'Plamen',
        familyName: 'Markov',
        url: `${SITE}/`,
        email: `mailto:${profile.email}`,
        jobTitle: 'Backend & AI Engineer',
        description: profile.summary,
        address: { '@type': 'PostalAddress', addressLocality: 'Pleven', addressCountry: 'BG' },
        knowsLanguage: ['bg', 'en'],
        alumniOf: [
          { '@type': 'CollegeOrUniversity', name: 'Technical University of Gabrovo' },
          { '@type': 'EducationalOrganization', name: 'SoftUni' },
        ],
        sameAs: [links.linkedin.href, links.github.href],
        knowsAbout: profile.stack
          .filter((g) => g.name === 'AI/LLM' || g.name === 'Backend')
          .flatMap((g) => g.items),
        mainEntityOfPage: { '@id': `${SITE}/#profilepage` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE}/#faq`,
        url: `${SITE}/#faq`,
        isPartOf: { '@id': website },
        about: { '@id': person },
        mainEntity: profile.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
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
      `- [Full profile as Markdown: experience, projects in detail, education](${SITE}/llms-full.txt)`,
      `- [${links.cv.label}](${absolute(links.cv.href)})`,
      `- [${links.linkedin.label}](${links.linkedin.href})`,
      `- [${links.github.label}](${links.github.href})`,
    ].join('\n')}`,
    `## Projects\n\n${projects.join('\n')}`,
    `## How he works with AI\n\n${profile.aiWorkflow.map((w) => `- ${w}`).join('\n')}`,
    `## Stack\n\n${profile.stack.map((g) => `- ${g.name}: ${g.items.join('; ')}`).join('\n')}`,
    `## Terms\n\n${profile.terms.map((t) => `- ${t}`).join('\n')}`,
    `## FAQ\n\n${faq(profile)}`,
  ].join('\n\n') + '\n';
}

const faq = (profile: Profile): string => profile.faq.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n');

/** /llms-full.txt: everything on the page as Markdown, for AI tools that want the whole profile in one request. */
export function llmsFullTxt(profile: Profile, updated: string = buildDate()): string {
  const { links } = profile;
  const projects = profile.projects.map((p) => {
    const refs = (p.links ?? []).map((l) => `- [${l.label}](${l.href})`).join('\n');
    return [
      `### ${p.title}`,
      `**Problem:** ${p.problem}`,
      `**Approach:** ${p.approach}`,
      `**Result:** ${p.result}`,
      `**Tags:** ${p.tags.join(', ')}`,
      refs,
    ].filter(Boolean).join('\n\n');
  });
  const roles = profile.experience.map((r) =>
    [`### ${r.title} · ${r.org} · ${r.period}`, r.summary, r.highlights.map((h) => `- ${h}`).join('\n')].join('\n\n'),
  );
  return [
    `# ${profile.name}`,
    `> ${profile.tagline}`,
    `Also written in Bulgarian as Пламен Марков. Based in Pleven, Bulgaria. ${profile.availability}. Last updated ${updated}.`,
    profile.summary,
    `## Contact\n\n${[
      `- Email: ${profile.email}`,
      `- Website with an AI assistant: ${SITE}/`,
      `- ${links.cv.label}: ${absolute(links.cv.href)}`,
      `- ${links.linkedin.label}: ${links.linkedin.href}`,
      `- ${links.github.label}: ${links.github.href}`,
    ].join('\n')}`,
    `## Terms\n\n${profile.terms.map((t) => `- ${t}`).join('\n')}`,
    `## AI shipped to production\n\n${projects.join('\n\n')}`,
    `## How he works with AI\n\n${profile.aiWorkflow.map((w) => `- ${w}`).join('\n')}`,
    `## Experience\n\n${roles.join('\n\n')}`,
    `## Stack\n\n${profile.stack.map((g) => `- ${g.name}: ${g.items.join('; ')}`).join('\n')}`,
    `## Languages\n\n${profile.languages.map((l) => `- ${l}`).join('\n')}`,
    `## Education\n\n${profile.education.map((e) => `- ${e}`).join('\n')}`,
    `## FAQ\n\n${faq(profile)}`,
  ].join('\n\n') + '\n';
}
