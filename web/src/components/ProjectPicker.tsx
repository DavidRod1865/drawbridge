import { useEffect, useState } from 'react';
import { Select } from './Select.tsx';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NotAuthenticatedError } from '../lib/api.ts';
import { listCompanies, listProjects, type Company, type Project } from '../lib/procore.ts';

interface Props {
  onSelect: (company: Company, project: Project) => void;
  onSessionLost: () => void;
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
  );
}
