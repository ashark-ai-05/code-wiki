export interface DetectionResult {
  detected: boolean;
  details: Record<string, unknown>;
}

export interface LanguageDetection extends DetectionResult {
  details: {
    language: string;
    version?: string;
    build_tool?: string;
    build_tool_version?: string;
    dependencies?: Array<{ name: string; version: string; scope?: string }>;
  };
}

export interface CommunicationDetection extends DetectionResult {
  details: {
    type: string;
    role: 'producer' | 'consumer' | 'both' | 'server' | 'client';
    identifiers: string[];
    config_files: string[];
  };
}

export interface InfrastructureDetection extends DetectionResult {
  details: { type: string; config_files: string[] };
}

export type AdapterType = 'language' | 'communication' | 'infrastructure' | 'ci-cd' | 'git-host' | 'artifact-registry' | 'observability';

export interface CodeWikiAdapter {
  name: string;
  type: AdapterType;
  filePatterns: string[];
  detect(repoPath: string): Promise<DetectionResult>;
  findConnections?(repoPath: string, context: ConnectionContext): Promise<EdgeCandidate[]>;
  healthCheck?(): Promise<{ healthy: boolean; message: string }>;
}

export interface ConnectionContext {
  allServices: ServiceNode[];
  symbolRegistry: Map<string, SymbolEntry>;
}

export interface ServiceNode {
  id: string;
  repo: string;
  tech_stack: Record<string, string[]>;
  exposes: string[];
  consumes: string[];
}

export interface SymbolEntry {
  name: string;
  type: 'kafka-topic' | 'rest-endpoint' | 'grpc-service' | 'maven-artifact' | 'db-schema';
  source_service: string;
  source_file: string;
  source_line?: number;
}

export interface EdgeCandidate {
  from: string;
  to: string;
  type: string;
  details: Record<string, unknown>;
  evidence: { from_file: string; from_line?: number; to_file?: string; to_line?: number };
  confidence: 'static' | 'inferred';
}
