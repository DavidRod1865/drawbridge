import { useEffect, useState } from 'react';
import { ArrowUpToLine, FileUp, FolderOpen, ListChecks, type LucideIcon } from 'lucide-react';
import { Select } from './Select.tsx';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NotAuthenticatedError, setCompanyId as rememberCompanyForApi } from '../lib/api.ts';
import { listCompanies, listProjects, type Company, type Project } from '../lib/procore.ts';

interface Props {
  onSelect: (company: Company, project: Project) => void;
  onSessionLost: () => void;
}

// The four stages of a package's trip through Drawbridge, shown as a stepper below the
// picker so a first-time user sees the whole flow before they start.
const STEPS: readonly { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: FolderOpen,
    title: 'Pick Project & Area',
    desc: 'Choose where the drawings belong in Procore.',
  },
  {
    icon: FileUp,
    title: 'Drop Your PDFs',
    desc: 'Drawbridge splits the package and reads every sheet.',
  },
  {
    icon: ListChecks,
    title: 'Review & Fix',
    desc: 'Confirm numbers, titles, and disciplines. Preview any sheet.',
  },
  {
    icon: ArrowUpToLine,
    title: 'Send to Procore',
    desc: 'Sheets upload straight into the Drawings tool for final review.',
  },
];

/** The numbered, connected "How it works" diagram. */
function HowItWorks() {
  return (
    <section className="w-full" aria-label="How Drawbridge works">
      <p className="mb-6 text-center font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
        How it works
      </p>
      <ol className="grid gap-8 sm:grid-cols-4 sm:gap-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative flex flex-col items-center text-center">
            {/* Connector to the previous step — desktop only; sits behind the circles. */}
            {i > 0 && (
              <span
                className="absolute top-5 right-1/2 hidden h-px w-full -translate-y-1/2 bg-border sm:block"
                aria-hidden
              />
            )}
            {/* Orange accent on the icons and number badge keeps the stepper on-brand;
                its smaller scale and placement below the card keep it from competing. */}
            <div className="relative z-10 grid size-10 place-items-center rounded-full border bg-card text-primary">
              <step.icon className="size-[18px]" aria-hidden />
              {/* Step number, tucked at the corner so the sequence reads at a glance. */}
              <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {i + 1}
              </span>
            </div>
            <div className="mt-3 text-sm font-medium">{step.title}</div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{step.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ProjectPicker({ onSelect, onSessionLost }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Errors are reported rather than swallowed: a silent empty dropdown is
  // indistinguishable from "you have no projects", which sends people hunting in the
  // wrong place.
  function handleError(cause: unknown) {
    if (cause instanceof NotAuthenticatedError) {
      onSessionLost();
      return;
    }
    setError(cause instanceof Error ? cause.message : String(cause));
  }

  useEffect(() => {
    setLoading(true);
    listCompanies()
      .then((result) => {
        setCompanies(result);
        // Most users belong to exactly one company; skip a pointless choice.
        if (result.length === 1 && result[0]) setCompanyId(result[0].id);
      })
      .catch(handleError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (companyId === null) return;
    // Attach the Procore-Company-Id header before the first company-scoped call.
    // Procore identifies company-scoped requests (listing projects included) by this
    // header, not the ?company_id query param alone — production returns 404
    // "Item not found" without it. This is what api.ts intends by "set once when the
    // user picks a company"; setting it only on project selection was too late, since
    // listProjects runs first.
    rememberCompanyForApi(companyId);
    setLoading(true);
    setProjects([]);
    listProjects(companyId)
      .then(setProjects)
      .catch(handleError)
      .finally(() => setLoading(false));
  }, [companyId]);

  const company = companies.find((item) => item.id === companyId);

  const projectPlaceholder =
    companyId === null
      ? 'Choose a company first'
      : loading
        ? 'Loading…'
        : projects.length === 0
          ? 'No projects found'
          : 'Choose a project';

  return (
    <div className="grid w-full max-w-3xl justify-items-center gap-10">
      <Card className="w-full max-w-md gap-5 p-6">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Select a project</h2>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-1.5">
        <Label>Company</Label>
        <Select
          options={companies.map((item) => ({ value: String(item.id), label: item.name }))}
          value={companyId === null ? null : String(companyId)}
          placeholder={loading && companies.length === 0 ? 'Loading…' : 'Choose a company'}
          onChange={(value) => setCompanyId(Number(value))}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Project</Label>
        <Select
          // Project numbers are how people actually refer to jobs, so lead with them.
          options={projects.map((project) => ({
            value: String(project.id),
            label: project.project_number
              ? `${project.project_number} — ${project.name}`
              : project.name,
          }))}
          value={null}
          placeholder={projectPlaceholder}
          onChange={(value) => {
            const project = projects.find((item) => item.id === Number(value));
            if (project && company) onSelect(company, project);
          }}
        />
      </div>
      </Card>

      <HowItWorks />
    </div>
  );
}
