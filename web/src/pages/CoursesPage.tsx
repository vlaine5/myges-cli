import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel } from '../components/Ui';

interface CourseRow {
  name: string;
  teacher: string | null;
  studentGroup: string | null;
  students: number | null;
  coef: number | null;
  ects: number | null;
  trimester: string | null;
  rcId: number | null;
  hasGrades: boolean;
  hasDocuments: boolean;
}

interface CourseGroup {
  trimester: string;
  courses: CourseRow[];
  students: number;
}

interface CoursesView {
  provider: string;
  year: string;
  availableYears: string[];
  groups: CourseGroup[];
  courseCount: number;
  totalStudents: number;
  classCount: number;
}

const headCell: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};
const numHead: React.CSSProperties = { ...headCell, textAlign: 'right' };
const cell: React.CSSProperties = { padding: '0.5rem 0.75rem' };
const numCell: React.CSSProperties = { ...cell, textAlign: 'right' };

function fmt(value: number | null) {
  return value !== null && value !== undefined ? String(value) : '—';
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`badge badge-${on ? 'ok' : 'muted'}`} style={{ marginRight: '0.25rem' }}>
      {label}
    </span>
  );
}

export function CoursesPage() {
  const [view, setView] = useState<CoursesView | null>(null);
  const [years, setYears] = useState<string[]>([]);
  const [year, setYear] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(targetYear?: string) {
    setLoading(true);
    setError(null);

    try {
      const result = (await api.getCourses(targetYear)) as CoursesView;
      setView(result);
      setYear(result.year);
      setYears(result.availableYears ?? []);
    } catch (loadError) {
      setView(null);
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les cours.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Chargement initial uniquement (année la plus récente par défaut).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onYearChange(next: string) {
    setYear(next);
    void load(next);
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Scolarité</p>
          <h2>Mes cours</h2>
        </div>
        <button className="button button-secondary" onClick={() => void load(year || undefined)}>
          Rafraichir
        </button>
      </header>

      <ErrorCallout message={error} />

      <Panel title="Année académique">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '12rem' }}>
            <span className="meta-line">Année</span>
            <select
              className="input"
              value={year}
              disabled={years.length === 0}
              onChange={(event) => onYearChange(event.target.value)}
            >
              {years.length === 0 ? <option value="">—</option> : null}
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          {view ? (
            <p className="meta-line" style={{ margin: 0 }}>
              Source : {view.provider}
            </p>
          ) : null}
        </div>
      </Panel>

      {loading ? (
        <LoadingBlock label="Chargement des cours..." />
      ) : view ? (
        <>
          <div className="stats-grid">
            <Panel title="Cours">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{view.courseCount}</p>
              <p className="meta-line">matières sur l&apos;année</p>
            </Panel>
            <Panel title="Classes / groupes">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{view.classCount}</p>
              <p className="meta-line">groupes distincts</p>
            </Panel>
            <Panel title="Étudiants">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{view.totalStudents}</p>
              <p className="meta-line">somme des effectifs</p>
            </Panel>
          </div>

          {view.groups.length === 0 ? (
            <Panel title="Cours">
              <p className="muted">Aucun cours pour cette année.</p>
            </Panel>
          ) : (
            view.groups.map((group) => (
              <Panel key={group.trimester} title={group.trimester === '—' ? 'Cours' : group.trimester}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={headCell}>Matière</th>
                        <th style={headCell}>Classe / Groupe</th>
                        <th style={headCell}>Enseignant</th>
                        <th style={numHead}>Étudiants</th>
                        <th style={numHead}>Coef</th>
                        <th style={numHead}>ECTS</th>
                        <th style={headCell}>Contenu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.courses.map((course, index) => (
                        <tr
                          key={`${course.rcId ?? course.name}-${index}`}
                          style={{ borderBottom: '1px solid var(--border)' }}
                        >
                          <td style={{ ...cell, fontWeight: 500 }}>{course.name}</td>
                          <td style={cell}>{course.studentGroup ?? '—'}</td>
                          <td style={{ ...cell, fontSize: '0.8rem', color: 'var(--muted)' }}>
                            {course.teacher ?? '—'}
                          </td>
                          <td style={numCell}>{fmt(course.students)}</td>
                          <td style={numCell}>{fmt(course.coef)}</td>
                          <td style={numCell}>{fmt(course.ects)}</td>
                          <td style={cell}>
                            <Flag on={course.hasGrades} label="Notes" />
                            <Flag on={course.hasDocuments} label="Docs" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                        <td style={cell} colSpan={3}>
                          {group.courses.length} cours
                        </td>
                        <td style={numCell}>{group.students}</td>
                        <td style={numCell} colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Panel>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}
