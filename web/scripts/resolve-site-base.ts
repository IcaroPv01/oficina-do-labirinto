export type SiteBaseEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** Resolves the public base for local builds, project Pages and user Pages. */
export function resolveSiteBase(environment: SiteBaseEnvironment): string {
  const explicitBase = environment["VITE_BASE_PATH"]?.trim();
  if (explicitBase) {
    return normalizePathBase(explicitBase);
  }

  if (environment["GITHUB_ACTIONS"] !== "true") {
    return "/";
  }

  const repository = environment["GITHUB_REPOSITORY"]?.trim();
  const parts = repository?.split("/") ?? [];
  const owner = parts[0];
  const name = parts[1];
  if (parts.length !== 2 || !owner || !name) {
    throw new Error(
      "GITHUB_REPOSITORY deve estar no formato proprietario/repositorio.",
    );
  }

  return name.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? "/"
    : `/${name}/`;
}

function normalizePathBase(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized.startsWith("/")) {
    throw new Error("VITE_BASE_PATH deve ser um caminho iniciado por /.");
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}
