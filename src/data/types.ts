export interface Link {
  label: string;
  href: string;
}

export interface Project {
  id: string;
  title: string;
  problem: string;
  approach: string;
  result: string;
  tags: string[];
  links?: Link[];
  tense: 'present' | 'past';
}

export interface Role {
  id: string;
  org: string;
  title: string;
  period: string;
  summary: string;
  highlights: string[];
}

export interface StackGroup {
  name: 'AI/LLM' | 'Backend' | 'Frontend' | 'Infra' | 'Quality';
  items: string[];
}

export interface Profile {
  name: string;
  tagline: string;
  availability: string;
  location: string;
  email: string;
  links: { linkedin: Link; github: Link; cv: Link };
  summary: string;
  aiWorkflow: string[];
  projects: Project[];
  experience: Role[];
  stack: StackGroup[];
  education: string[];
  languages: string[];
  terms: string[];
  starterQuestions: [string, string, string];
}
