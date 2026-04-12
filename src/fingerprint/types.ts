export interface SourceEvidence {
  path: string;
  line?: number;
}

export interface Exposure {
  type: 'kafka-topic' | 'rest-endpoint' | 'grpc-service' | 'db-schema';
  identifier: string;
  role: 'producer' | 'consumer' | 'both' | 'server' | 'client';
  source: SourceEvidence;
  detection_method: 'static' | 'annotated' | 'inferred';
  confidence: 'static' | 'inferred';
}

export interface LanguageInfo {
  language: string;
  version?: string;
  build_tool?: string;
  dependencies?: Array<{ name: string; version: string; scope?: string }>;
}

export interface RepoFingerprint {
  schema_version: '2.0';
  repo: {
    name: string;
    path: string;
    remote?: string;
    branch?: string;
    sha?: string;
  };
  scanned_at: string;
  tech_stack: {
    languages: LanguageInfo[];
  };
  exposes: Exposure[];
  consumes: Exposure[];
  workflows_declared?: Array<{ name: string; entry_point?: boolean }>;
}
