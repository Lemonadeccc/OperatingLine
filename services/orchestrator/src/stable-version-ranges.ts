type StableVersion = readonly [major: number, minor: number, patch: number];

interface VersionBound {
  readonly version: StableVersion;
  readonly inclusive: boolean;
}

interface VersionInterval {
  readonly lower: VersionBound | null;
  readonly upper: VersionBound | null;
}

function parseStableVersion(value: string, label: string): StableVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(value.trim());
  if (match === null) {
    throw new Error(`${label} must begin with a stable semantic version`);
  }
  const version = match.slice(1).map(Number) as unknown as StableVersion;
  if (version.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${label} contains an unsafe semantic version component`);
  }
  return version;
}

function compareVersions(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseComparator(comparator: string, label: string) {
  const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(comparator);
  if (match === null) {
    throw new Error(`${label} range contains an unsupported comparator: ${comparator}`);
  }
  return {
    operator: match[1] ?? '=',
    version: parseStableVersion(match[2]!, `${label} range`),
  };
}

function strongerLower(current: VersionBound | null, candidate: VersionBound): VersionBound {
  if (current === null) return candidate;
  const comparison = compareVersions(candidate.version, current.version);
  if (comparison > 0) return candidate;
  if (comparison < 0) return current;
  return { version: current.version, inclusive: current.inclusive && candidate.inclusive };
}

function strongerUpper(current: VersionBound | null, candidate: VersionBound): VersionBound {
  if (current === null) return candidate;
  const comparison = compareVersions(candidate.version, current.version);
  if (comparison < 0) return candidate;
  if (comparison > 0) return current;
  return { version: current.version, inclusive: current.inclusive && candidate.inclusive };
}

function parseIntervals(range: string, label: string): VersionInterval[] {
  const intervals: VersionInterval[] = [];
  for (const alternative of range.split('||')) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) {
      throw new Error(`${label} range must contain at least one comparator`);
    }
    let lower: VersionBound | null = null;
    let upper: VersionBound | null = null;
    for (const value of comparators) {
      const comparator = parseComparator(value, label);
      switch (comparator.operator) {
        case '>=':
          lower = strongerLower(lower, { version: comparator.version, inclusive: true });
          break;
        case '>':
          lower = strongerLower(lower, { version: comparator.version, inclusive: false });
          break;
        case '<=':
          upper = strongerUpper(upper, { version: comparator.version, inclusive: true });
          break;
        case '<':
          upper = strongerUpper(upper, { version: comparator.version, inclusive: false });
          break;
        default:
          lower = strongerLower(lower, { version: comparator.version, inclusive: true });
          upper = strongerUpper(upper, { version: comparator.version, inclusive: true });
      }
    }
    if (lower !== null && upper !== null) {
      const comparison = compareVersions(lower.version, upper.version);
      if (comparison > 0 || (comparison === 0 && (!lower.inclusive || !upper.inclusive))) {
        continue;
      }
    }
    intervals.push({ lower, upper });
  }
  return intervals;
}

function compareLower(left: VersionBound | null, right: VersionBound | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  const comparison = compareVersions(left.version, right.version);
  if (comparison !== 0) return comparison;
  if (left.inclusive === right.inclusive) return 0;
  return left.inclusive ? -1 : 1;
}

function intervalsConnect(left: VersionInterval, right: VersionInterval): boolean {
  if (left.upper === null || right.lower === null) return true;
  const comparison = compareVersions(left.upper.version, right.lower.version);
  return comparison > 0 || (comparison === 0 && (left.upper.inclusive || right.lower.inclusive));
}

function widerUpper(left: VersionBound | null, right: VersionBound | null): VersionBound | null {
  if (left === null || right === null) return null;
  const comparison = compareVersions(left.version, right.version);
  if (comparison > 0) return left;
  if (comparison < 0) return right;
  return { version: left.version, inclusive: left.inclusive || right.inclusive };
}

function mergeIntervals(intervals: readonly VersionInterval[]): VersionInterval[] {
  const sorted = [...intervals].sort((left, right) => compareLower(left.lower, right.lower));
  const merged: VersionInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || !intervalsConnect(previous, interval)) {
      merged.push(interval);
      continue;
    }
    merged[merged.length - 1] = {
      lower: previous.lower,
      upper: widerUpper(previous.upper, interval.upper),
    };
  }
  return merged;
}

function containsInterval(container: VersionInterval, candidate: VersionInterval): boolean {
  const lowerContained =
    container.lower === null ||
    (candidate.lower !== null &&
      (compareVersions(container.lower.version, candidate.lower.version) < 0 ||
        (compareVersions(container.lower.version, candidate.lower.version) === 0 &&
          (container.lower.inclusive || !candidate.lower.inclusive))));
  const upperContained =
    container.upper === null ||
    (candidate.upper !== null &&
      (compareVersions(container.upper.version, candidate.upper.version) > 0 ||
        (compareVersions(container.upper.version, candidate.upper.version) === 0 &&
          (container.upper.inclusive || !candidate.upper.inclusive))));
  return lowerContained && upperContained;
}

export function satisfiesStableVersionRange(value: string, range: string, label: string): boolean {
  const version = parseStableVersion(value, label);
  return parseIntervals(range, label).some((interval) => {
    const aboveLower =
      interval.lower === null ||
      compareVersions(version, interval.lower.version) > 0 ||
      (compareVersions(version, interval.lower.version) === 0 && interval.lower.inclusive);
    const belowUpper =
      interval.upper === null ||
      compareVersions(version, interval.upper.version) < 0 ||
      (compareVersions(version, interval.upper.version) === 0 && interval.upper.inclusive);
    return aboveLower && belowUpper;
  });
}

/** Return true only when every version accepted by `candidate` is accepted by `container`. */
export function isStableVersionRangeSubset(candidate: string, container: string): boolean {
  const candidateIntervals = parseIntervals(candidate, 'Candidate version');
  if (candidateIntervals.length === 0) return false;
  const containerIntervals = mergeIntervals(parseIntervals(container, 'Container version'));
  return candidateIntervals.every((interval) =>
    containerIntervals.some((containerInterval) => containsInterval(containerInterval, interval)),
  );
}
