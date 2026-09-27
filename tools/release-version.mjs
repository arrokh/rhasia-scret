const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemVer(value) {
  if (typeof value !== "string") return null;
  const match = semverPattern.exec(value);
  if (!match) return null;
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4]?.split(".") ?? [],
    build: match[5]?.split(".") ?? [],
  };
}

export function isValidSemVer(value) {
  return parseSemVer(value) !== null;
}

export function isStableSemVer(value) {
  const parsed = parseSemVer(value);
  return parsed !== null && parsed.prerelease.length === 0 && parsed.build.length === 0;
}

export function compareSemVer(left, right) {
  const leftVersion = requireSemVer(left);
  const rightVersion = requireSemVer(right);
  for (const field of ["major", "minor", "patch"]) {
    const comparison = compareNumeric(leftVersion[field], rightVersion[field]);
    if (comparison !== 0) return comparison;
  }

  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) return 0;
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }

  const sharedLength = Math.min(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumeric(leftIdentifier, rightIdentifier);
      if (comparison !== 0) return comparison;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    const comparison = leftIdentifier < rightIdentifier ? -1 : leftIdentifier > rightIdentifier ? 1 : 0;
    if (comparison !== 0) return comparison;
  }
  return Math.sign(leftVersion.prerelease.length - rightVersion.prerelease.length);
}

export function bumpSemVer(version, kind) {
  const parsed = requireSemVer(version);
  if (kind !== "patch" && kind !== "minor" && kind !== "major") {
    throw new Error(`Release bump must be patch, minor, or major; received ${String(kind)}.`);
  }

  if (kind === "major") return `${increment(parsed.major)}.0.0`;
  if (kind === "minor") return `${parsed.major}.${increment(parsed.minor)}.0`;
  return `${parsed.major}.${parsed.minor}.${increment(parsed.patch)}`;
}

function requireSemVer(value) {
  const parsed = parseSemVer(value);
  if (!parsed) throw new Error(`Invalid SemVer release version: ${String(value)}.`);
  return parsed;
}

function compareNumeric(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function increment(value) {
  return (BigInt(value) + 1n).toString();
}
