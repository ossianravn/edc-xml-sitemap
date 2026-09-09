const copenhagen = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const dayMs = 86_400_000;

function wallTime(year: number, month: number, day: number, hour: number,
  minute: number, second: number, millisecond = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

function localWallTime(instant: number): number {
  const parts = copenhagen.formatToParts(instant);
  const value = (key: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === key)?.value);
  return wallTime(value('year'), value('month'), value('day'), value('hour'),
    value('minute'), value('second'));
}

/** Offset-free EDC dates are Copenhagen wall times, independent of the host TZ. */
export function publicationDate(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const ms = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) return null;
  const wall = wallTime(year, month, day, hour, minute, second, ms);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day) return null;
  const zone = match[8];
  if (zone === 'Z') return wall;
  if (zone) {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hours > 23 || minutes > 59) return null;
    const sign = zone[0] === '+' ? 1 : -1;
    return wall - sign * (hours * 60 + minutes) * 60_000;
  }
  // Probe both sides of a DST transition, then round-trip each possible offset.
  const offsets = new Set([-dayMs, 0, dayMs].map(delta => {
    const instant = wall - ms + delta;
    return localWallTime(instant) - instant;
  }));
  const candidates = [...offsets].map(offset => wall - offset)
    .filter(instant => localWallTime(instant - ms) === wall - ms);
  // A gap has no matching instant; an overlap chooses the earlier occurrence.
  return candidates.length ? Math.min(...candidates) : null;
}
