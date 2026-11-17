import {
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronDown,
  Clock,
  Mail,
  MapPin,
  Moon,
  Phone,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { formatNgn } from '../lib/solar';
import type { CatalogItem } from '../lib/types';
import { Reveal } from './Reveal';
import type { AppRoute } from './TopBar';

interface PublicSiteProps {
  catalog: CatalogItem[];
  darkMode: boolean;
  onToggleTheme: () => void;
  onNavigate: (route: AppRoute, sectionId?: string) => void;
}

const WORKFLOW_STEPS = [
  {
    code: '01',
    title: 'Assess',
    subtitle: 'Appliance Audit & Physical Site Survey',
    description:
      'Use the offline-capable Load Estimator or speak with our Abuja desk to calculate exact connected wattage, daily kWh demand, and inverter surge capacity before site visit.',
    deliverables: [
      'Physical roof geometry & shading check',
      'Earthing resistance & DB phase audit',
      'Itemised bill of quantities from Storefront prices',
    ],
    ctaLabel: 'Open Load Estimator',
    ctaRoute: 'estimator' as AppRoute,
  },
  {
    code: '02',
    title: 'Design',
    subtitle: 'Modular Redundancy & Formal Approval',
    description:
      'Every quotation is built directly from verified Storefront equipment & service rates, reviewed by the Managing Director, and issued with 7-day price protection.',
    deliverables: [
      'Modular parallel inverter sizing (3kVA to 120kW+)',
      'LiFePO4 storage sizing for 5–15 year lifespan',
      'Proforma invoice & bank payment verification gate',
    ],
    ctaLabel: 'Browse Storefront Prices',
    ctaRoute: 'store' as AppRoute,
  },
  {
    code: '03',
    title: 'Deliver',
    subtitle: '5-Stage Installation & Lifetime Support',
    description:
      'Managing Director job release dispatches certified COREN & SPVI engineers across Nigeria, with photo-verified stage tracking and dedicated Customer Portal help desk support.',
    deliverables: [
      'Live HISO reference tracking across 5 field stages',
      '1-year comprehensive workmanship warranty',
      'Customer Equipment Registry & Help Desk tickets',
    ],
    ctaLabel: 'Track a Project',
    ctaRoute: 'track' as AppRoute,
  },
];

const SERVICES = [
  {
    num: '01.',
    title: 'Hybrid Solar Inverter Systems',
    summary:
      'Seamless integration of PV solar panels, lithium battery banks, and PHCN/utility power across residential homes, offices, and government facilities (15kW–140kW+).',
  },
  {
    num: '02.',
    title: 'Off-Grid Power Plants (60–360V)',
    summary:
      'Standalone solar power plants engineered for remote estates, industrial sites, and rural communities needing total independence from unstable utility grids.',
  },
  {
    num: '03.',
    title: 'Solar Panel & Battery Engineering',
    summary:
      'Certified structural racking, 550W/500W monocrystalline arrays, LiFePO4 battery banks, DC/AC surge protection, and array reorientation or capacity expansion.',
  },
  {
    num: '04.',
    title: 'Solar Street Lighting & Institutional',
    summary:
      'All-in-one solar street lighting for highways and estates plus compliant institutional deployments (Ekiti State Ministry of Health, Nigeria Civil Defence, RAAMP).',
  },
  {
    num: '05.',
    title: 'Investor & Developer Support',
    summary:
      'Turnkey solar feasibility, procurement, commissioning, and long-term asset management engineered to protect infrastructure capital.',
  },
  {
    num: '06.',
    title: 'Operations, Maintenance & Help Desk',
    summary:
      'Preventive thermal checks, inverter firmware diagnostics, battery health audits, and rapid customer service ticket dispatch from your Customer Profile.',
  },
];

const PROJECTS = [
  {
    title: '10kWp / 10kWh Solar Hybrid System',
    location: 'Residential Electrification · Bayelsa',
    sector: 'Residential',
    metric: 'Uninterrupted 24/7 Home Backup',
    image: '/assets/site/project-2-lithium-bank.jpg',
    detail: 'Lithium battery bank paired with high-efficiency hybrid conversion and smart load prioritization.',
  },
  {
    title: '10kWp / 24kWh - 8kW Business Hybrid',
    location: 'Port Harcourt, Rivers State',
    sector: 'Commercial',
    metric: '10kWp Solar · 24kWh Storage',
    image: '/assets/site/project-3-ph-commercial.jpg',
    detail: 'Commercial office solar hybrid plant engineered for uninterrupted daytime & evening operations.',
  },
  {
    title: '16kW Parallel Hybrid Inverter Array',
    location: 'Utako, FCT Abuja',
    sector: 'Commercial',
    metric: 'Modular 16kW Load Capacity',
    image: '/assets/site/project-7-survey-team.jpg',
    detail: 'Redundant parallel hybrid inverters supporting dual solar charging and PHCN utility integration.',
  },
  {
    title: '15kWh Hybrid Off-Grid Plant',
    location: 'Imiringi, Bayelsa State',
    sector: 'Residential',
    metric: 'Supports PHCN & PV Charging',
    image: '/assets/site/project-5-bayelsa-15kwh.jpg',
    detail: 'Durable off-grid hybrid configuration eliminating fuel generator dependence.',
  },
  {
    title: '500W Monocrystalline Roof Array',
    location: '24kW Solar Charging · Residential',
    sector: 'Residential',
    metric: '24kW Maximum Array Input',
    image: '/assets/site/project-4-panels-500w.jpg',
    detail: 'Precision anodized mounting and clean MC4 string wiring for maximum daily kWh yield.',
  },
  {
    title: 'Institutional & Health Centre Electrification',
    location: 'Ekiti Health Centre · RAAMP Jos · Maitama',
    sector: 'Institutional',
    metric: 'COREN & NERC Compliant Delivery',
    image: '/assets/site/project-8-inverter-wall.jpg',
    detail: 'Heavy-duty inverter wall, DC/AC breaker distribution, and lithium storage cabinets.',
  },
];

const PACKAGES = [
  {
    name: 'Starter Home',
    audience: 'Apartments & essential residential backup',
    price: 4500000,
    specs: [
      '6 units × 500W Solar Panels (3.0kW)',
      '1 unit × 3kVA Hybrid Inverter',
      '1 unit × 12kWh Lithium Battery Bank',
      'Solar cables, mountings, logistics & installation',
    ],
  },
  {
    name: 'Business Essential',
    audience: 'Homes with ACs, clinics & growing SMEs',
    price: 9200000,
    specs: [
      '16 units × 500W Solar Panels (8.0kW)',
      '3 units × 10kVA Hybrid Inverters',
      '2 units × 30kWh Lithium Battery Bank',
      'Full BOS accessories, logistics & installation',
    ],
  },
  {
    name: 'Premium Off-Grid',
    audience: 'Commercial complexes, factories & institutions',
    price: 25000000,
    specs: [
      '120 units × 500W Solar Panels (60kW)',
      '8 units × 30kVA Parallel Hybrid Inverters',
      '10 units × 120kWh Lithium Battery Bank',
      'Modular redundant engineering & commissioning',
    ],
  },
];

const PARTNERS = [
  'Victron Energy',
  'SRNE',
  'Schneider Electric',
  'Felicity Solar',
  'Tesla',
  'Megatech',
  'Simba Group',
  'Livoltek',
];

const FAQS = [
  {
    q: 'How can I get an accurate, itemized solar price quote?',
    a: 'Use our offline-capable Load Estimator to size your appliances using live Storefront prices and submit directly for an engineering HISO reference, or reach our Abuja desk on +234 703 777 0002.',
  },
  {
    q: 'Do you work with government ministries and corporate institutions?',
    a: 'Yes. HI-SOTECH has delivered systems for public and institutional clients including Ekiti State Ministry of Health, RAAMP Plateau, and Nigeria Civil Defence under COREN, SPVI, and NERC standards.',
  },
  {
    q: 'Can I monitor warranty repairs or log a complaint after installation?',
    a: 'Yes. Open the Customer Portal to register your installed inverters, batteries, and panels, edit your site details, and submit service requests or complaints directly to our Help Desk and Admin team.',
  },
  {
    q: 'What is the validity of quotations and warranty coverage?',
    a: 'Every formal HI-SOTECH quotation is valid for 7 days and installations carry a 1-year comprehensive workmanship warranty, backed by expected lifespans of 5–15 years (batteries), 1–20 years (inverters), and 10–35 years (panels).',
  },
];

export function PublicSite({ catalog, darkMode, onToggleTheme, onNavigate }: PublicSiteProps) {
  const [workflowIdx, setWorkflowIdx] = useState(0);
  const [projectSector, setProjectSector] = useState<'All' | 'Residential' | 'Commercial' | 'Institutional'>('All');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactLocation, setContactLocation] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState('');
  const [submittedRef, setSubmittedRef] = useState('');

  const activeWorkflow = WORKFLOW_STEPS[workflowIdx];
  const filteredProjects = PROJECTS.filter((p) => (projectSector === 'All' ? true : p.sector === projectSector));

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContactError('');
    setSubmittedRef('');
    if (!contactName.trim() || !contactPhone.trim() || !contactLocation.trim()) {
      setContactError('Please enter your name, phone number, and site location.');
      return;
    }
    setContactBusy(true);
    try {
      const created = await api.submitPublicEnquiry({
        customerName: contactName,
        email: contactEmail,
        phone: contactPhone,
        location: contactLocation,
        needSummary: contactMessage || 'General solar consultation request',
        appliances: [],
        estimate: {
          connectedLoadWatts: 0,
          dailyEnergyKwh: 0,
          inverterMinKw: 0,
          batteryTargetKwh: 0,
          recommendedPanels550w: 0,
          recommendedBatteries5kwh: 0,
        },
      });
      setSubmittedRef(created.refCode);
      setContactName('');
      setContactPhone('');
      setContactEmail('');
      setContactLocation('');
      setContactMessage('');
    } catch (err) {
      setContactError((err as Error).message);
    } finally {
      setContactBusy(false);
    }
  }

  return (
    <div id="home">
      {/* Hero Section (Immediate render above the fold) */}
      <section className="relative overflow-hidden bg-[#081E3E] text-white">
        <div className="mx-auto grid max-w-7xl items-stretch gap-10 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-20">
          <div className="flex flex-col justify-center lg:col-span-6">
            <p className="text-xs font-semibold tracking-widest text-red-300">
              CAC REGISTERED SINCE 2016 · COREN · SPVI · NERC COMPLIANT
            </p>
            <h1 className="mt-4 max-w-xl text-balance text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Motivated by success, powered by knowledge, driven by passion.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-300">
              HI-SOTECH Solar Inverter Co. Ltd designs, engineers, and commissions dependable hybrid, off-grid, and
              commercial solar installations across Nigeria—from site load assessment to 5-stage handover.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={() => onNavigate('estimator')}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-[#D61F26] px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#B0171D]"
              >
                Open Load Estimator
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('store')}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-400 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white/10"
              >
                Browse Storefront
              </button>
              <button
                type="button"
                onClick={() => onNavigate('customer')}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-3.5 text-sm font-medium text-slate-200 underline-offset-4 hover:text-white hover:underline"
              >
                Customer Service Portal
              </button>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-3 border-t border-white/15 pt-6 sm:gap-6">
              <div>
                <div className="font-mono-num text-xl font-bold text-white sm:text-2xl">50MWp+</div>
                <div className="mt-1 text-xs text-slate-300">Installed nationwide</div>
              </div>
              <div>
                <div className="font-mono-num text-xl font-bold text-white sm:text-2xl">8+ Years</div>
                <div className="mt-1 text-xs text-slate-300">Engineering track record</div>
              </div>
              <div>
                <div className="font-mono-num text-xl font-bold text-white sm:text-2xl">24/7</div>
                <div className="mt-1 text-xs text-slate-300">Backup reliability</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[300px] overflow-hidden rounded-xl border border-white/15 bg-[#0F2D59] sm:min-h-[360px]">
              <img
                src="/src/assets/images/hero_solar_array_1794819204906.jpg"
                alt="Architectural Nigerian commercial and residential complex powered by HI-SOTECH solar arrays at golden hour"
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#081E3E]/95 via-[#081E3E]/70 to-transparent p-5 sm:p-6">
                <p className="text-xs font-medium text-red-300">Global Technology Partners</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {PARTNERS.join(' · ')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Workflow Stepper (bamcore.tech/hiso architecture) */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wider text-[#D61F26]">ENGINEERING DELIVERY WORKFLOW</p>
              <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-[#081E3E] dark:text-white">
                How HI-SOTECH takes your property from energy audit to 24/7 power.
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('track')}
              className="whitespace-nowrap rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-[#081E3E] hover:border-[#081E3E] dark:border-slate-700 dark:text-white"
            >
              Track HISO Request
            </button>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-5">
              {WORKFLOW_STEPS.map((step, idx) => {
                const active = workflowIdx === idx;
                return (
                  <button
                    key={step.code}
                    type="button"
                    onClick={() => setWorkflowIdx(idx)}
                    className={`rounded-xl border p-5 text-left transition-colors ${
                      active
                        ? 'border-[#D61F26] bg-[#081E3E] text-white'
                        : 'border-slate-200 bg-white text-[#081E3E] hover:border-slate-400 dark:border-slate-800 dark:bg-[#0B1D39] dark:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="font-mono-num text-[#D61F26] dark:text-red-400">
                        Phase {step.code}
                      </span>
                      <span className={active ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}>
                        {step.title}
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-lg font-bold">{step.subtitle}</h3>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-7 lg:col-span-7 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div>
                <div className="font-mono-num text-xs font-semibold text-[#D61F26]">
                  {activeWorkflow.code}. {activeWorkflow.title}
                </div>
                <h3 className="mt-2 text-2xl font-bold text-[#081E3E] dark:text-white">
                  {activeWorkflow.subtitle}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {activeWorkflow.description}
                </p>
                <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5 text-sm dark:border-slate-800">
                  {activeWorkflow.deliverables.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#D61F26]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-6 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onNavigate(activeWorkflow.ctaRoute)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#D61F26] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#B0171D]"
                >
                  {activeWorkflow.ctaLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* About & Leadership */}
      <section id="about" className="border-y border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-[#091830]">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-5">
            <Reveal>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-[#0B1D39]">
                <img
                  src="/assets/site/about-team.jpeg"
                  alt="Engr. Oseni Olalekan and the HI-SOTECH Solar Engineering team"
                  className="aspect-[4/3] w-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="border-t border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
                  <p className="text-xs font-semibold text-[#D61F26]">Founder & Managing Director</p>
                  <h3 className="mt-1 text-lg font-bold text-[#081E3E] dark:text-white">Engr. Oseni Olalekan</h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    COREN Registered · SPVI Certified · Leading HI-SOTECH Solar Inverter Co. Ltd since 2016
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-7">
            <Reveal delayMs={90}>
              <p className="text-xs font-semibold tracking-wider text-[#D61F26]">ABOUT HI-SOTECH</p>
              <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-[#081E3E] dark:text-white">
                Nigeria’s trusted partner for transparent solar engineering since 2016.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Founded in 2016 and registered under Nigeria’s Corporate Affairs Commission (CAC), HI-SOTECH Solar
                Inverter Co. Ltd operates in strict compliance with the Nigerian Electricity Regulatory Commission (NERC).
                We bridge precision engineering, COREN/SPVI-certified field execution, and ongoing youth technician
                training across Abuja, Lagos, Plateau, Rivers, Bayelsa, Ekiti, and Akwa Ibom.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-[#0B1D39]">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#081E3E] dark:text-white">
                    <Award className="h-4 w-4 text-[#D61F26]" />
                    COREN &amp; SPVI Certified
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    Registered with the Council for the Regulation of Engineering in Nigeria and Solar Photovoltaic
                    Integration standards.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-[#0B1D39]">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#081E3E] dark:text-white">
                    <ShieldCheck className="h-4 w-4 text-[#D61F26]" />
                    Core Values &amp; Warranty
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    Innovation, Integrity, Quality, and Customer Focus—backed by a 1-year installation warranty and up
                    to 10-year select equipment guarantees.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wider text-[#D61F26]">SERVICES &amp; CAPABILITIES</p>
            <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight text-[#081E3E] dark:text-white">
              Comprehensive solar systems for homes, SMEs, and institutions.
            </h2>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((svc, idx) => (
              <Reveal key={svc.num} delayMs={(idx % 3) * 70}>
                <div className="h-full rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:border-[#081E3E]/40 dark:border-slate-800 dark:bg-[#0B1D39]">
                  <div className="font-mono-num text-sm font-semibold text-[#D61F26]">{svc.num}</div>
                  <h3 className="mt-2 text-lg font-bold text-[#081E3E] dark:text-white">{svc.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{svc.summary}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Selected Projects with Real HI-SOTECH Photography */}
      <section id="projects" className="border-y border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-[#091830]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-wider text-[#D61F26]">PROJECTS PORTFOLIO</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#081E3E] dark:text-white">
                  Verified field installations across Nigeria.
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#061327]">
                {(['All', 'Residential', 'Commercial', 'Institutional'] as const).map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setProjectSector(sec)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                      projectSector === sec
                        ? 'bg-white text-[#081E3E] shadow-sm dark:bg-[#0B1D39] dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {sec}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredProjects.map((project) => (
                <article
                  key={project.title}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-[#0B1D39]"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-slate-200 dark:bg-slate-800">
                    <img
                      src={project.image}
                      alt={project.title}
                      className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>{project.sector}</span>
                      <span aria-hidden="true">·</span>
                      <span>{project.location}</span>
                    </div>
                    <h3 className="mt-2 text-lg font-bold text-[#081E3E] dark:text-white">{project.title}</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{project.detail}</p>
                    <div className="mt-4 border-t border-slate-200 pt-3 font-mono-num text-xs font-semibold text-[#D61F26] dark:border-slate-700">
                      {project.metric}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pricing Tiers & Storefront Snapshot */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wider text-[#D61F26]">PACKAGES &amp; STOREFRONT PRICING</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#081E3E] dark:text-white">
                Transparent packages aligned with live hardware prices.
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('store')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#081E3E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#D61F26]"
            >
              View Full Storefront
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {PACKAGES.map((pkg) => (
              <div
                key={pkg.name}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{pkg.audience}</p>
                  <h3 className="mt-1 text-xl font-bold text-[#081E3E] dark:text-white">{pkg.name}</h3>
                  <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    {pkg.specs.map((sp) => (
                      <li key={sp} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#D61F26]" />
                        <span>{sp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Starts from</div>
                  <div className="font-mono-num mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">
                    {formatNgn(pkg.price)}
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('estimator')}
                    className="mt-4 w-full rounded-lg bg-[#081E3E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#D61F26] dark:bg-[#D61F26] dark:hover:bg-[#B0171D]"
                  >
                    Customise in Load Estimator
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Quote Validity, Warranty & Lifespans */}
          <div className="mt-8 grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-4 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div>
              <div className="text-xs font-semibold text-[#D61F26]">Quote Validity &amp; Warranty</div>
              <p className="mt-1 text-sm font-bold text-[#081E3E] dark:text-white">
                7-Day Validity · 1-Year Workmanship
              </p>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Lithium Batteries Lifespan</div>
              <p className="font-mono-num mt-1 text-lg font-bold text-[#081E3E] dark:text-white">5–15 Years</p>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Hybrid Inverters Lifespan</div>
              <p className="font-mono-num mt-1 text-lg font-bold text-[#081E3E] dark:text-white">1–20 Years</p>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Solar PV Panels Lifespan</div>
              <p className="font-mono-num mt-1 text-lg font-bold text-[#081E3E] dark:text-white">10–35 Years</p>
            </div>
          </div>

          {catalog.length > 0 && (
            <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Live Storefront Rate Snapshot</h3>
                <button
                  type="button"
                  onClick={() => onNavigate('store')}
                  className="text-xs font-semibold text-[#D61F26] hover:underline"
                >
                  Open All {catalog.length} Items in Storefront →
                </button>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 pr-4 font-semibold">SKU</th>
                      <th className="py-2.5 pr-4 font-semibold">Equipment / Service</th>
                      <th className="py-2.5 pr-4 font-semibold">Type</th>
                      <th className="py-2.5 text-right font-semibold">Storefront Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {catalog.slice(0, 6).map((item) => (
                      <tr key={item.sku}>
                        <td className="font-mono-num py-2.5 pr-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                          {item.sku}
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">{item.name}</td>
                        <td className="py-2.5 pr-4 capitalize text-slate-600 dark:text-slate-400">{item.itemType}</td>
                        <td className="font-mono-num py-2.5 text-right font-semibold text-[#081E3E] dark:text-white">
                          {formatNgn(item.priceNgn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FAQ Accordion */}
          <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Frequently Asked Questions</h3>
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {FAQS.map((faq, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div key={faq.q} className="py-3">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      className="flex w-full items-center justify-between gap-4 py-1 text-left text-sm font-semibold text-[#081E3E] dark:text-white"
                    >
                      <span>{faq.q}</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{faq.a}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </section>

      {/* Contact & Consultation Intake */}
      <section id="contact" className="border-t border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-[#091830]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-5">
            <p className="text-xs font-semibold tracking-wider text-[#D61F26]">ABUJA HEADQUARTERS</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#081E3E] dark:text-white">
              Speak directly with our solar engineering desk.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Wherever there is sunlight, HI-SOTECH Solar Inverter Co. Ltd is ready to serve. Every inquiry receives an
              immediate HISO tracking reference.
            </p>

            <div className="mt-8 space-y-4 text-sm text-slate-700 dark:text-slate-300">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#D61F26]" />
                <span>No. 5 Adamu Fika Street, Life Camp, Abuja, Nigeria</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 shrink-0 text-[#D61F26]" />
                <a href="tel:+2347037770002" className="font-mono-num font-medium hover:text-[#D61F26]">
                  +234 703 777 0002 (Call &amp; WhatsApp)
                </a>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 shrink-0 text-[#D61F26]" />
                <span>hisotechnologies@gmail.com</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-[#D61F26]" />
                <span>Monday – Friday · 9:00 AM – 7:00 PM</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <form
              onSubmit={handleContactSubmit}
              className="rounded-xl border border-slate-200 bg-slate-50 p-6 sm:p-8 dark:border-slate-800 dark:bg-[#0B1D39]"
            >
              <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Request a Technical Callback</h3>

              {submittedRef && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <span>
                      Enquiry logged with reference <strong className="font-mono-num">{submittedRef}</strong>.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('track')}
                    className="font-semibold underline"
                  >
                    Track Status
                  </button>
                </div>
              )}

              {contactError && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
                  {contactError}
                </p>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Full Name *</span>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Ibrahim Danjuma"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Phone / WhatsApp *</span>
                  <input
                    type="tel"
                    required
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+234 803 000 0000"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Email Address</span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="you@company.ng"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Site Location *</span>
                  <input
                    type="text"
                    required
                    value={contactLocation}
                    onChange={(e) => setContactLocation(e.target.value)}
                    placeholder="e.g. Maitama, Abuja"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                  />
                </label>
              </div>
              <label className="mt-4 block text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Project Summary</span>
                <textarea
                  rows={3}
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Tell us about your building, backup priority, or solar requirement..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#061327] dark:text-white"
                />
              </label>

              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  disabled={contactBusy}
                  className="rounded-lg bg-[#D61F26] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B0171D] disabled:opacity-60"
                >
                  {contactBusy ? 'Submitting...' : 'Submit Enquiry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* Quiet Footer (No cPanel download button) */}
      <footer className="border-t border-slate-200 bg-[#081E3E] text-slate-300 dark:border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img
              src="/assets/hisotech-logo-mark.png"
              alt="HI-SOTECH"
              className="h-7 w-7 rounded bg-white p-0.5 object-contain"
              referrerPolicy="no-referrer"
            />
            <div>
              <p className="text-sm font-semibold text-white">HI-SOTECH Solar Inverter Co. Ltd</p>
              <p className="text-xs text-slate-400">No. 5 Adamu Fika Street, Life Camp, Abuja · Mon–Fri 9 AM – 7 PM</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <button type="button" onClick={() => onNavigate('store')} className="hover:text-white">
              Storefront
            </button>
            <button type="button" onClick={() => onNavigate('estimator')} className="hover:text-white">
              Load Estimator
            </button>
            <button type="button" onClick={() => onNavigate('customer')} className="hover:text-white">
              Customer Portal
            </button>
            <button type="button" onClick={() => onNavigate('track')} className="hover:text-white">
              Track Request
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle light or dark theme"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
            >
              {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {darkMode ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
