export const HOMEPAGE_SECTION_IDS = [
  'hero',
  'workflow',
  'about',
  'services',
  'projects',
  'pricing',
] as const;

export type HomepageSectionId = (typeof HOMEPAGE_SECTION_IDS)[number];

export interface HomepageSectionContent {
  heading: string;
  body: string;
  enabled: boolean;
}

export type HomepageContent = Record<HomepageSectionId, HomepageSectionContent>;

export const DEFAULT_HOMEPAGE_CONTENT: HomepageContent = {
  hero: {
    heading: 'Motivated by success, powered by knowledge, driven by passion.',
    body: 'HI-SOTECH Solar Inverter Co. Ltd designs, engineers, and commissions dependable hybrid, off-grid, and commercial solar installations across Nigeria—from site load assessment to 5-stage handover.',
    enabled: true,
  },
  workflow: {
    heading: 'How HI-SOTECH takes your property from energy audit to 24/7 power.',
    body: 'A clear engineering process takes each project from load assessment and system design through delivery, installation, and ongoing support.',
    enabled: true,
  },
  about: {
    heading: 'Nigeria’s trusted partner for transparent solar engineering since 2010.',
    body: 'Founded in 2010 and registered in 2016 with Nigeria’s Corporate Affairs Commission (CAC), HI-SOTECH Solar Inverter Co. Ltd operates in strict compliance with the Nigerian Electricity Regulatory Commission (NERC). We bridge precision engineering, COREN/SPVI-certified field execution, and ongoing youth technician training across Abuja, Lagos, Plateau, Rivers, Bayelsa, Ekiti, and Akwa Ibom.',
    enabled: true,
  },
  services: {
    heading: 'Comprehensive solar systems for homes, SMEs, and institutions.',
    body: 'Explore our engineering, installation, and maintenance capabilities for homes, businesses, and institutions.',
    enabled: true,
  },
  projects: {
    heading: 'Verified field installations across Nigeria.',
    body: 'Browse selected residential, commercial, and institutional solar projects delivered by HI-SOTECH.',
    enabled: true,
  },
  pricing: {
    heading: 'Browse solar equipment and appliances in the Store.',
    body: 'Use current Store prices to prepare a solar estimate and calculate your daily power consumption.',
    enabled: true,
  },
};

export function normalizeHomepageContent(value: unknown): HomepageContent {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const content = {} as HomepageContent;

  for (const id of HOMEPAGE_SECTION_IDS) {
    const raw = source[id] && typeof source[id] === 'object'
      ? source[id] as Record<string, unknown>
      : {};
    const defaults = DEFAULT_HOMEPAGE_CONTENT[id];
    content[id] = {
      heading: typeof raw.heading === 'string' ? raw.heading.slice(0, 180) : defaults.heading,
      body: typeof raw.body === 'string' ? raw.body.slice(0, 1200) : defaults.body,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    };
  }

  return content;
}
