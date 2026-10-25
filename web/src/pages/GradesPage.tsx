import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel } from '../components/Ui';

interface BulletinCourse {
  course: string;
  teacher: string | null;
  coef: number | null;
  ects: number | null;
  continuous: Array<number | null>;
  exam: number | null;
  average: number | null;
}

interface BulletinTrimester {
  trimester: string;
  trimesterName: string;
  courses: BulletinCourse[];
  average: number | null;
  ectsTotal: number;
  maxContinuous: number;
}

interface Bulletin {
  provider: string;
  year: string;
  availableYears: string[];
  trimesters: BulletinTrimester[];
  overallAverage: number | null;
  ectsTotal: number;
  courseCount: number;
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

function fmt(value: number | null, suffix = '') {
  return value !== null && value !== undefined ? `${value}${suffix}` : '—';
}

function GradeValue({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="muted">—</span>;
  }
  return <>{value.toFixed(2)}</>;
}

export function GradesPage() {
  const [bulletin, setBulletin] = useState<Bulletin | null>(null);
  const [years, setYears] = useState<string[]>([]);
  const [year, setYear] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(targetYear?: string) {
    setLoading(true);
    setError(null);

    try {
      const result = (await api.getBulletin(targetYear)) as Bulletin;
      setBulletin(result);
      setYear(result.year);
      setYears(result.availableYears ?? []);
    } catch (loadError) {
      setBulletin(null);
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les notes.');
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
          <h2>Notes &amp; bulletins</h2>
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
          {bulletin ? (
            <p className="meta-line" style={{ margin: 0 }}>
              Source : {bulletin.provider} — {bulletin.courseCount} matière(s)
            </p>
          ) : null}
        </div>
      </Panel>

      {loading ? (
        <LoadingBlock label="Chargement des notes..." />
      ) : bulletin ? (
        <>
          <div className="stats-grid">
            <Panel title="Moyenne générale">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                <GradeValue value={bulletin.overallAverage} />
              </p>
              <p className="meta-line">pondérée par coef. (toutes matières notées)</p>
            </Panel>
            <Panel title="ECTS">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{bulletin.ectsTotal}</p>
              <p className="meta-line">total crédits sur l&apos;année</p>
            </Panel>
            <Panel title="Trimestres">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{bulletin.trimesters.length}</p>
              <p className="meta-line">{bulletin.courseCount} ligne(s) matière</p>
            </Panel>
          </div>

          {bulletin.trimesters.length === 0 ? (
            <Panel title="Bulletin">
              <p className="muted">Aucune note pour cette année.</p>
            </Panel>
          ) : (
            bulletin.trimesters.map((trimester) => {
              const ccColumns = Array.from({ length: trimester.maxContinuous }, (_, i) => i);
              return (
                <Panel
                  key={trimester.trimester}
                  title={trimester.trimesterName || `Trimestre ${trimester.trimester}`}
                >
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={headCell}>Matière</th>
                          <th style={headCell}>Enseignant</th>
                          <th style={numHead}>Coef</th>
                          <th style={numHead}>ECTS</th>
                          {ccColumns.map((i) => (
                            <th key={i} style={numHead}>{`CC${i + 1}`}</th>
                          ))}
                          <th style={numHead}>Examen</th>
                          <th style={numHead}>Moyenne</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trimester.courses.map((course, index) => (
                          <tr
                            key={`${course.course}-${index}`}
                            style={{ borderBottom: '1px solid var(--border)' }}
                          >
                            <td style={{ ...cell, fontWeight: 500 }}>{course.course || '—'}</td>
                            <td style={{ ...cell, fontSize: '0.8rem', color: 'var(--muted)' }}>
                              {course.teacher ?? '—'}
                            </td>
                            <td style={numCell}>{fmt(course.coef)}</td>
                            <td style={numCell}>{fmt(course.ects)}</td>
                            {ccColumns.map((i) => (
                              <td key={i} style={numCell}>
                                <GradeValue value={course.continuous[i] ?? null} />
                              </td>
                            ))}
                            <td style={numCell}>
                              <GradeValue value={course.exam} />
                            </td>
                            <td style={{ ...numCell, fontWeight: 700 }}>
                              <GradeValue value={course.average} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                          <td style={cell} colSpan={2}>
                            Moyenne du trimestre
                          </td>
                          <td style={numCell} />
                          <td style={numCell}>{fmt(round1(trimester.ectsTotal))}</td>
                          {ccColumns.map((i) => (
                            <td key={i} style={numCell} />
                          ))}
                          <td style={numCell} />
                          <td style={numCell}>
                            <GradeValue value={trimester.average} />
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Panel>
              );
            })
          )}
        </>
      ) : null}
    </div>
  );
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
