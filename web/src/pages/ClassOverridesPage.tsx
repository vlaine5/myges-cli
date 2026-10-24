import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorCallout, LoadingBlock, Panel, SuccessCallout } from '../components/Ui';

interface EnrichmentRule {
  id: string;
  name: string;
  matchProvider: string | null;
  matchClassLike: string | null;
  injectStudentCount: number | null;
  enabled: boolean;
  priority: number;
}

type ProviderOption = '' | 'myges' | 'myefrei' | 'ensup';

export function ClassOverridesPage() {
  const [rules, setRules] = useState<EnrichmentRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProviderOption>('');
  const [className, setClassName] = useState('');
  const [studentCount, setStudentCount] = useState('');

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const allRules = (await api.listEnrichmentRules()) as EnrichmentRule[];
      setRules(allRules.filter((rule) => rule.injectStudentCount !== null));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Impossible de charger les effectifs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    if (!className.trim() || !studentCount) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await api.createEnrichmentRule({
        name: `Effectif ${className.trim()}`,
        matchProvider: provider || null,
        matchClassLike: className.trim(),
        injectStudentCount: Number(studentCount),
        priority: 0,
        enabled: true,
      });
      setClassName('');
      setStudentCount('');
      setProvider('');
      setSuccess('Effectif enregistré.');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Création impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(rule: EnrichmentRule) {
    setSubmitting(true);
    setError(null);

    try {
      await api.updateEnrichmentRule(rule.id, {
        name: rule.name,
        matchProvider: rule.matchProvider,
        matchClassLike: rule.matchClassLike,
        injectStudentCount: rule.injectStudentCount,
        priority: rule.priority,
        enabled: !rule.enabled,
      });
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Mise a jour impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(rule: EnrichmentRule) {
    setSubmitting(true);
    setError(null);

    try {
      await api.deleteEnrichmentRule(rule.id);
      setSuccess('Effectif supprimé.');
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Suppression impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingBlock label="Chargement des effectifs..." />;
  }

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <p className="eyebrow">Données enseignement</p>
          <h2>Effectifs par classe</h2>
        </div>
      </header>

      <Panel title="Ajouter un effectif">
        <ErrorCallout message={error} />
        <SuccessCallout message={success} />
        <p className="meta-line">
          Force le nombre d&apos;étudiants pour toute séance dont le nom de classe contient le texte
          saisi ci-dessous (insensible à la casse). Utile quand la source académique n&apos;envoie
          pas d&apos;effectif fiable.
        </p>
        <div className="form-grid">
          <label>
            Provider
            <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderOption)}>
              <option value="">Tous</option>
              <option value="myges">MyGES</option>
              <option value="myefrei">myEfrei</option>
              <option value="ensup">Ensup (HyperPlanning)</option>
            </select>
          </label>
          <label>
            Nom de la classe
            <input
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="ex: L3 INFO"
            />
          </label>
          <label>
            Nombre d&apos;étudiants
            <input
              type="number"
              min={0}
              value={studentCount}
              onChange={(event) => setStudentCount(event.target.value)}
            />
          </label>
        </div>
        <div className="actions-row">
          <button
            className="button"
            disabled={submitting || !className.trim() || !studentCount}
            onClick={() => void handleCreate()}
          >
            Ajouter
          </button>
        </div>
      </Panel>

      <Panel title="Effectifs configurés">
        {rules.length === 0 ? (
          <p className="muted">Aucun effectif configuré pour le moment.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Provider</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Classe</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Étudiants</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)' }}>Actif</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {rule.matchProvider ?? 'Tous'}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{rule.matchClassLike}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>{rule.injectStudentCount}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={submitting}
                        onChange={() => void handleToggle(rule)}
                      />
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                      <button
                        className="button button-secondary"
                        disabled={submitting}
                        onClick={() => void handleDelete(rule)}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
