function cleanString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, ' ').trim();

  return cleaned.length > 0 ? cleaned : null;
}

function splitValues(value: string) {
  return value
    .split(/[,/;]| et /gi)
    .map((entry) => cleanString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseStudentCount(value: string) {
  const match = value.match(/\b(\d{1,4})\b/);

  if (!match) {
    return null;
  }

  const [, rawNumber] = match;

  if (!rawNumber) {
    return null;
  }

  const parsed = Number.parseInt(rawNumber, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

export interface StructuredDescriptionFields {
  teacher: string | null;
  groups: string[];
  subject: string | null;
  modality: string | null;
  activityType: string | null;
  moduleCode: string | null;
  room: string | null;
  studentCount: number | null;
}

export function parseStructuredDescription(description: string | null | undefined): StructuredDescriptionFields {
  const result: StructuredDescriptionFields = {
    teacher: null,
    groups: [],
    subject: null,
    modality: null,
    activityType: null,
    moduleCode: null,
    room: null,
    studentCount: null,
  };

  if (!description) {
    return result;
  }

  const allLines = description.split('\n').map((line) => line.trim());
  const structuredLines: string[] = [];

  for (const line of allLines) {
    if (line === '') {
      break;
    }

    structuredLines.push(line);
  }

  for (const line of structuredLines) {
    const colonIndex = line.indexOf(':');

    if (colonIndex === -1) {
      continue;
    }

    const rawKey = line.slice(0, colonIndex).trim().toLowerCase();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (!rawValue) {
      continue;
    }

    if (rawKey.startsWith('enseignant')) {
      result.teacher = cleanString(rawValue);
      continue;
    }

    if (rawKey.startsWith('groupe') || rawKey === 'promotion' || rawKey === 'option') {
      result.groups.push(...splitValues(rawValue));
      continue;
    }

    if (rawKey.startsWith('mati') || rawKey === 'matiere' || rawKey === 'matière') {
      result.subject = cleanString(rawValue);
      continue;
    }

    if (rawKey === 'code module' || rawKey === 'module') {
      result.moduleCode = cleanString(rawValue);

      if (!result.subject) {
        result.subject = cleanString(rawValue);
      }
      continue;
    }

    if (rawKey.startsWith('modal')) {
      result.modality = cleanString(rawValue);
      continue;
    }

    if (rawKey.startsWith('activit')) {
      result.activityType = cleanString(rawValue);
      continue;
    }

    if (rawKey === 'salle') {
      result.room = cleanString(rawValue);
      continue;
    }

    if (
      rawKey.includes('effectif') ||
      rawKey.includes("eleves") ||
      rawKey.includes('élèves') ||
      rawKey.includes('etudiants') ||
      rawKey.includes('étudiants')
    ) {
      result.studentCount = parseStudentCount(rawValue);
    }
  }

  result.groups = [...new Set(result.groups)];

  return result;
}
