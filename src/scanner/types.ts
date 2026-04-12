export interface RepoFingerprint {
  repo_path: string;
  repo_name: string;
  tech_stack: {
    languages: Array<{
      language: string;
      version?: string;
      build_tool?: string;
      dependencies?: Array<{
        name: string;
        version: string;
        scope?: string;
      }>;
    }>;
  };
  communication: Array<{
    type: string;
    role: string;
    identifiers: string[];
    config_files: string[];
  }>;
  scanned_at: string;
}
