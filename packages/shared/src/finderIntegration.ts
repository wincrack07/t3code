export function readFinderLink(value: string): string[] | null {
  const url = URL.parse(value);
  if (
    !url ||
    !["t3code:", "t3code-dev:"].includes(url.protocol) ||
    url.hostname !== "finder" ||
    url.pathname !== "" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    return null;
  const paths = url.searchParams.getAll("path");
  if (
    paths.length === 0 ||
    paths.length > 100 ||
    value.length > 64 * 1024 ||
    [...url.searchParams.keys()].some((key) => key !== "path") ||
    paths.some((path) => !path.startsWith("/") || path.includes("\0") || path.length > 4096)
  )
    return null;
  return [...new Set(paths)];
}

export function finderProjectForPaths<T extends { workspaceRoot: string }>(
  paths: readonly string[],
  projects: readonly T[],
): T | null {
  if (paths.length === 0) return null;
  return (
    projects
      .filter((project) => {
        const root = project.workspaceRoot.replace(/\/+$/, "");
        return paths.every((path) => path.startsWith(`${root}/`));
      })
      .sort((a, b) => b.workspaceRoot.length - a.workspaceRoot.length)[0] ?? null
  );
}
