export interface SourceConfig {
  provider: 'local' | 'bitbucket-cloud' | 'bitbucket-server' | 'github' | 'gitlab';
  paths?: string[];
  workspace?: string;
  auth?: Record<string, string>;
  include?: string[];
  exclude?: string[];
}

export interface WorkflowConfig {
  description: string;
  entry_points: string[];
  auto_discover?: boolean;
  auto_add_discovered_services?: boolean;
  discovered_services?: string[];
  tags?: string[];
  llm_model?: string;
}

export interface OutputConfig {
  wiki_path: string;
  git_enabled?: boolean;
  index_mode?: 'json' | 'sqlite';
  sqlite_path?: string;
  diagram_format?: 'mermaid' | 'plantuml' | 'both';
  render_diagrams?: boolean;
  markdown_style?: 'github' | 'obsidian' | 'standard';
}

export interface DetectionConfig {
  kafka?: boolean;
  rest_api?: boolean;
  grpc?: boolean;
  database?: boolean;
  maven_gradle?: boolean;
  npm?: boolean;
  websocket?: boolean;
  s3?: boolean;
  file_sharing?: boolean;
}

export interface ScanConfig {
  shallow_all_repos?: boolean;
  deep_workflows_only?: boolean;
  tree_sitter_parsing?: boolean;
  max_concurrency?: number;
}

export interface AnalysisConfig {
  scan?: ScanConfig;
  detection?: DetectionConfig;
}

export interface LlmUsageConfig {
  summarization?: boolean;
  dependency_extraction?: boolean;
  diagram_generation?: boolean;
  wiki_writing?: boolean;
}

export interface LlmCostControlsConfig {
  max_tokens_per_run?: number;
  warn_above?: number;
  budget_exceeded_behavior?: string;
}

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_key_env?: string;
  usage?: LlmUsageConfig;
  cost_controls?: LlmCostControlsConfig;
}

export interface FederationAuth {
  method: 'ssh' | 'token';
  env_var?: string;
  key_path?: string;
}

export interface FederationConfig {
  enabled: boolean;
  provider: 'git';
  url: string;
  branch: string;
  publish_strategy: 'branch' | 'direct';
  auth: FederationAuth;
}

export interface CodeWikiConfig {
  version: string;
  sources: SourceConfig[];
  workflows: Record<string, WorkflowConfig>;
  artifacts?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  llm?: LlmConfig;
  output: OutputConfig;
  analysis?: AnalysisConfig;
  adapters?: Record<string, unknown>;
  federation?: FederationConfig;
}
