export interface ServiceNode {
  id: string;
  repo: string;
  type: 'microservice' | 'library' | 'infrastructure' | 'frontend';
  tech_stack: {
    languages: string[];
    frameworks: string[];
    build: string[];
    runtime: string[];
    databases: string[];
  };
  exposes: string[];
  consumes: string[];
  last_scanned: string;
  scan_sha?: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: string;
  bidirectional: boolean;
  details: Record<string, unknown>;
  evidence: {
    from_file?: string;
    from_line?: number;
    to_file?: string;
    to_line?: number;
  };
  confidence: 'static' | 'inferred';
  discovered_at: string;
  workflows: string[];
}

export interface Graph {
  schema_version: string;
  services: ServiceNode[];
  edges: Edge[];
}
