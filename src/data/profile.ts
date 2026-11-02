import type { Profile } from './types';

// The curated public profile. The page and the chat's system prompt are both
// generated from this file, so they cannot drift apart. Everything here is
// public; `npm run check-public` fails the build if a private fact slips in.
// Copy is written in a neutral voice so it reads well on the page and when the
// chat quotes it in the third person.

export const profile: Profile = {
  name: 'Plamen Markov',
  tagline: 'Backend engineer building AI into production systems',
  availability: 'Available · remote B2B · Europe (UTC+2)',
  location: 'Pleven, Bulgaria · Europe (UTC+2)',
  email: 'plamen326@gmail.com',
  links: {
    linkedin: { label: 'LinkedIn', href: 'https://www.linkedin.com/in/plamen-markov-14254965' },
    github: { label: 'GitHub', href: 'https://github.com/plamen911' },
    cv: { label: 'Download CV', href: '/cv/Plamen_Markov_CV.pdf' },
  },

  summary:
    'Backend engineer with 20+ years of remote production work, most of it as the engineer who owned the whole system: ' +
    'architecture, data model, rollout and years of maintenance after launch. ' +
    'Builds LLM features into production software: a tool-calling agent that is never allowed to compute a figure itself, ' +
    'a Claude plugin held to an LLM-judge eval suite, an MCP server published on npm and vision OCR. ' +
    'Earlier, built and ran a retrieval-augmented generation (RAG) product solo. ' +
    'PHP and Laravel are the foundation; TypeScript and LLM integration are where the work is heading.',

  aiWorkflow: [
    'Claude Code every day for over a year, inside client production codebases: refactoring, test generation and debugging.',
    'The value is senior review of generated code, not the generating: every agent-written change is read, tested and verified before it ships.',
    'Guardrails live in the pipeline, not in good intentions: on an insurance platform built and run solo, PHPStan level 9, 878 tests and dependency audits gate every push in CI.',
    'Repeatable AI work gets its own tooling: custom Claude Code skills, MCP servers and LLM-judge evals that catch regressions before users do.',
  ],

  projects: [
    {
      id: 'reporting-agent',
      title: 'Tool-calling reporting agent that never computes a number',
      problem:
        'Staff at an insurance brokerage wanted to ask about clients, payments and sales goals in plain language. ' +
        'A language model that writes its own queries or does its own arithmetic can return a confident wrong figure, ' +
        'and the data includes personal information.',
      approach:
        'Built on Laravel with laravel/ai. The agent is not allowed to compute or estimate any figure: every number comes from ' +
        'one of 15 curated tools that read through the existing reporting service. Tool schemas are enum-constrained, so the ' +
        'model picks filters from a fixed catalogue instead of free-forming a query. Access needs both an authorisation gate ' +
        "and a feature flag, and the tools are kept off the platform's public MCP endpoint, which exposes only an anonymous lookup.",
      result:
        'Shipped in a production insurance back office. Every figure in an answer traces back to a named tool call, and personal ' +
        'data cannot reach the public endpoint. Client code, so the architecture is described here and the code is not public.',
      tags: ['laravel/ai', 'Tool calling', 'Enum-constrained schemas', 'Laravel 13', 'PHP 8.4', 'Feature flags'],
      tense: 'present',
    },
    {
      id: 'fire-report-plugin',
      title: 'Claude plugin that drafts forensic fire-investigation reports',
      problem:
        'A court-format forensic fire-investigation report took an expert 5–6 hours at a desktop, working through a case file ' +
        'of 15–20 documents.',
      approach:
        'A Claude plugin, built with Claude Code. It reads phone photos of the case file and drafts the report on the required ' +
        'template. A mechanical check and a separate AI reviewer examine every draft before the expert signs it. Regression evals ' +
        'with an LLM judge run in CI, including trap cases where the correct answer is "no data" rather than an invented one. ' +
        'Personal-data checks are enforced in code, not left to the prompt.',
      result:
        'About 10–15 minutes per report instead of 5–6 hours, from a phone. The LLM judge catches all six planted fabricated ' +
        'facts in its eval set, and every rule in the plugin traces back to a failure an eval caught.',
      tags: ['Claude plugin', 'Claude Code', 'LLM-judge evals', 'Vision', 'MCP', 'CI'],
      tense: 'present',
    },
    {
      id: 'mcp-go-checker',
      title: 'MCP server for the Bulgarian motor-insurance register',
      problem:
        'Before selling mandatory motor liability insurance, a broker must know whether the vehicle is already insured and until ' +
        'when. The official register is a web page meant for people, so every check was manual and the online sales form could ' +
        'not use the answer.',
      approach:
        "A dedicated service automates the register lookup and returns structured JSON. The brokerage's Laravel backend reads it " +
        'through one interface, with two other data sources as interchangeable implementations. An MCP server in TypeScript ' +
        'exposes the check as a single tool to any MCP client; it was ported from a first Python version with the tool signature ' +
        'and output kept identical.',
      result:
        'Published on npm and runs with `npx -y go-insurance-checker`: no clone, no install. A check takes about 5–15 seconds, ' +
        'and the sales form now decides by itself whether a car can be insured and from which date.',
      tags: ['MCP', 'TypeScript', 'Node.js', 'npm', 'Laravel'],
      links: [
        { label: 'Source on GitHub', href: 'https://github.com/plamen911/go-insurance-checker' },
        { label: 'Package on npm', href: 'https://www.npmjs.com/package/go-insurance-checker' },
      ],
      tense: 'present',
    },
    {
      id: 'ocr-and-rag',
      // Two parts in one card: the OCR is live (present tense, hence `tense`);
      // the RAG product is earlier work and is only ever described in the past tense.
      title: 'Vision OCR for vehicle documents; earlier, a hybrid-search RAG product',
      problem:
        'OCR: insurance agents retyped 17 fields from every vehicle registration certificate into the policy form. ' +
        'RAG, earlier: drafting technical expert reports depended on finding the right passages in years of earlier reports ' +
        'and reference material.',
      approach:
        'OCR: a vision model (GPT-4o) reads the registration certificate and pre-fills the 17 fields, with national ID numbers ' +
        'checked against their checksum. RAG: the assistant combined PostgreSQL + pgvector semantic search with Postgres ' +
        'full-text search, merged and reranked the results with Cohere down to the top four passages, and used a ' +
        'structure-aware chunker, covered by 27 tests, so every passage kept its section heading.',
      result:
        'OCR: in use in the production insurance platform. RAG: a solo product that was built, deployed with Docker Compose ' +
        'on a VPS with TLS and nightly backups, and run in production by one engineer.',
      tags: ['GPT-4o vision', 'RAG', 'PostgreSQL', 'pgvector', 'Hybrid search', 'Cohere rerank', 'Laravel'],
      tense: 'present',
    },
    {
      id: 'site-assistant',
      title: 'The AI assistant on this page',
      problem:
        'A recruiter with a specific question should not have to read a whole page, or guess whether a role fits. But a public ' +
        'chatbot on a personal site can invent experience, leak private details or run up a bill.',
      approach:
        'Claude on a Cloudflare Pages Function, streamed to the page. Answers come only from the same data that renders this page, ' +
        'and cite the section they came from. The worst-case cost of each request is reserved atomically in D1 before the model ' +
        'is called and settled against real usage, within daily and monthly caps. Turnstile and hourly limits keep bots out, and ' +
        'a check in CI scans the public source and CV for private facts.',
      result:
        'Live on this page: ask it something, or paste a job description to see what matches and what is not shown. Evals against ' +
        'the real model test invented experience, private details, prompt injection and Bulgarian answers. The source is public.',
      tags: ['Claude API', 'Evals', 'Prompt injection defence', 'Cloudflare Pages', 'D1', 'TypeScript'],
      links: [{ label: 'Source on GitHub', href: 'https://github.com/plamen911/plamen.lynxlake.org' }],
      tense: 'present',
    },
  ],

  experience: [
    {
      id: 'smartwary',
      org: 'Smartwary (Bulgaria)',
      title: 'Senior PHP Developer, B2B contract',
      period: 'Aug 2025 – present',
      summary:
        "B2B contract with Smartwary, building Browswave's product: PriceLens, a multi-tenant pricing-intelligence SaaS for " +
        'Shopify merchants, and PromoManager, a second Shopify app built end to end. The client took PriceLens in-house in ' +
        'October 2026; the Smartwary contract continues, with no active project.',
      highlights: [
        'Introduced 436 tests to a three-year-old codebase that had almost none, plus a nightly end-to-end suite that drove a real Shopify demo store through install, sync, billing, repricing and uninstall.',
        'Fixed recurring production queue deadlocks with FOR UPDATE SKIP LOCKED, READ COMMITTED and a retry with exponential backoff.',
        'Made Shopify API use resilient across 24 tenant databases: leaky-bucket pacing, jittered retries that honour Retry-After, idempotent webhooks.',
        'Cut dashboard load times with a denormalised read model rebuilt in a shadow table and swapped in atomically, so the live table is never locked.',
      ],
    },
    {
      id: 'ivanov-new-media',
      org: 'Ivanov New Media Studio (Nantucket, MA, USA)',
      title: 'Remote developer, contractor',
      period: '2005 – 2025',
      summary:
        "Ivanov New Media Studio's long-term remote developer for twenty years; Nantucket Energy was their client. " +
        "Principal developer of that client's propane and heating-oil delivery platform for thirteen years, author of 86.5% of " +
        'its surviving code.',
      highlights: [
        'Integrated four tank-telemetry vendors over four transport styles: hand-built SOAP, two session-authenticated REST APIs and a LoRaWAN webhook decoding raw hex payloads.',
        'Built the 55-endpoint export API that drained the legacy database into its Laravel replacement over seven years, with both systems live.',
        'Built an unbilled-delivery detector that reconciles telemetry against the invoice ledger and catches deliveries that were made but never billed.',
      ],
    },
    {
      id: 'direct-clients',
      org: 'Direct clients',
      title: 'Independent contractor, sole developer',
      period: '2008 – present',
      summary:
        "Sole developer on production systems still in service, each owned end to end for over a decade: an insurance " +
        "brokerage's platform and NPP Kozloduy's occupational-health system.",
      highlights: [
        'Built the Laravel successor of an insurance platform and the migration layer that moved 26,000+ legacy policies into it, with a parity-tested cutover.',
        'Traced a report that had slowed from 0.24 s to 137 s to a non-sargable join and fixed it; deep pagination went from about 6 s to 0.1 s per page.',
        'Rebuilt the occupational-health system in place from PHP 5.6 to PHP 8.2, extracting 114 domain services from 172 page scripts; a full rewrite was evaluated and rejected, and the decision recorded in ADRs.',
        'Took a report page from 736 ms to 6 ms with generated columns and covering indexes.',
      ],
    },
    {
      id: 'own-products',
      org: 'Own products',
      title: 'Designer and sole developer',
      period: '2026',
      summary: 'Products designed, built and shipped solo.',
      highlights: [
        'ADR Zone: a React Native / Expo app in TypeScript, live on the App Store. An offline dangerous-goods reference with 1,818 substances, relevance ranking and a Cyrillic case-fold layer.',
        'go-insurance-checker: an MCP server in TypeScript, published on npm.',
        'A RAG assistant on Laravel, PostgreSQL + pgvector and Cohere rerank was built, deployed and run solo.',
      ],
    },
  ],

  stack: [
    {
      name: 'AI/LLM',
      items: [
        'Claude Code (daily, 1+ year)',
        'Claude plugins and skills',
        'MCP servers',
        'Tool-calling agent design',
        'LLM-judge evals',
        'RAG: pgvector, hybrid search, Cohere rerank',
        'Vision OCR (GPT-4o)',
        'laravel/ai',
        'Anthropic and OpenAI APIs',
      ],
    },
    {
      name: 'Backend',
      items: [
        'PHP 8 (20+ years)',
        'Laravel',
        'Symfony 7',
        'Livewire',
        'Node.js',
        'REST, GraphQL, webhooks',
        'Queues and scheduled jobs',
        'MySQL / MariaDB',
        'PostgreSQL + pgvector',
        'Redis',
        'SQLite',
      ],
    },
    {
      name: 'Frontend',
      items: ['TypeScript', 'React', 'React Native / Expo', 'Vue 2', 'Svelte', 'Alpine.js', 'Tailwind CSS'],
    },
    {
      name: 'Infra',
      items: ['Docker', 'AWS (EC2, S3)', 'Linux VPS: nginx, TLS, backups', 'Bitbucket Pipelines', 'GitHub Actions'],
    },
    {
      name: 'Quality',
      items: ['PHPUnit', 'Pest', 'Laravel Dusk', 'PHPStan level 9', 'CI gates', 'Architecture decision records'],
    },
  ],

  education: [
    'Technical University of Gabrovo – Computer Systems & Technologies (2005)',
    'SoftUni – PHP Web Developer (2019)',
    'SoftUni – Front-End Developer with JavaScript (2019)',
  ],

  languages: ['Bulgarian – native', 'English – B2 (working level)'],

  terms: [
    'Remote, B2B contract',
    'Available to start immediately',
    'Async-friendly',
    'European hours, with US overlap',
  ],

  starterQuestions: ['What AI work has he shipped?', 'Is he available?', "What's his stack?"],
};
