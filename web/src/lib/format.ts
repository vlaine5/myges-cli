export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatMaybe(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }

  return String(value);
}
