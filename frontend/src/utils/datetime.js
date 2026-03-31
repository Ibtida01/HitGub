export function parseApiDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Backend stores TIMESTAMP (without timezone). Treat naive values as UTC.
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatApiDate(value, fallback = 'N/A') {
  const parsed = parseApiDate(value);
  return parsed ? parsed.toLocaleDateString() : fallback;
}

export function formatApiDateTime(value, fallback = 'N/A') {
  const parsed = parseApiDate(value);
  return parsed ? parsed.toLocaleString() : fallback;
}

export function timeAgo(value, options = {}) {
  const { emptyLabel = 'just now' } = options;
  const parsed = parseApiDate(value);
  if (!parsed) return emptyLabel;

  const diffMs = Date.now() - parsed.getTime();
  if (diffMs <= 0) return 'just now';

  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return parsed.toLocaleDateString();
}