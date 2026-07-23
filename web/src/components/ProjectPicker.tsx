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

/** The "How it works" flow, shown as the same card tiles as the drawing-area page. */
function HowItWorks() {
  return (
    <section className="w-full" aria-label="How Drawbridge works">
      <p className="mb-6 text-center font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
        How it works
      </p>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="grid gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <step.icon className="size-5" aria-hidden />
              </span>
              <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                Step {i + 1}
              </span>
            </div>
            <h3 className="text-sm font-semibold">{step.title}</h3>
            <p className="text-sm text-muted-foreground">{step.desc}</p>
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
