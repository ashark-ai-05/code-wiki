import type { CodeWikiConfig, AnalysisConfig, LlmConfig, OutputConfig } from './schema.js';

export const CONFIG_DEFAULTS = {
  output: {
    git_enabled: true,
    index_mode: 'json' as const,
    diagram_format: 'mermaid' as const,
    render_diagrams: true,
    markdown_style: 'github' as const,
  } satisfies Partial<OutputConfig>,

  analysis: {
    scan: {
      shallow_all_repos: true,
      deep_workflows_only: true,
      tree_sitter_parsing: false,
      max_concurrency: 4,
    },
    detection: {
      kafka: true,
      rest_api: true,
      grpc: true,
      database: true,
      maven_gradle: true,
      npm: true,
      websocket: true,
      s3: true,
      file_sharing: true,
    },
  } satisfies Partial<AnalysisConfig>,

  llm: {
    usage: {
      summarization: true,
      dependency_extraction: true,
      diagram_generation: true,
      wiki_writing: true,
    },
    cost_controls: {
      max_tokens_per_run: 100000,
      warn_above: 80000,
      budget_exceeded_behavior: 'warn',
    },
  } satisfies Partial<LlmConfig>,
};

/**
 * Deep merge two objects. Arrays replace (not merge), objects merge recursively,
 * explicit values in `override` take precedence over `base`.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>,
): T {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    const baseVal = base[key];

    if (overrideVal === undefined) {
      // keep base value
      continue;
    }

    if (
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key as string] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      result[key as string] = overrideVal;
    }
  }

  return result as T;
}

/**
 * Apply defaults to a partial config. Explicit values in `partial` override defaults.
 */
export function applyDefaults(partial: CodeWikiConfig): CodeWikiConfig {
  const output = deepMerge(
    CONFIG_DEFAULTS.output as unknown as Record<string, unknown>,
    (partial.output ?? {}) as unknown as Record<string, unknown>,
  ) as unknown as CodeWikiConfig['output'];

  const analysis = deepMerge(
    CONFIG_DEFAULTS.analysis as unknown as Record<string, unknown>,
    (partial.analysis ?? {}) as unknown as Record<string, unknown>,
  ) as unknown as CodeWikiConfig['analysis'];

  const llm = partial.llm
    ? (deepMerge(
        CONFIG_DEFAULTS.llm as unknown as Record<string, unknown>,
        partial.llm as unknown as Record<string, unknown>,
      ) as unknown as CodeWikiConfig['llm'])
    : undefined;

  return {
    ...partial,
    output,
    analysis,
    ...(llm !== undefined ? { llm } : {}),
  };
}
