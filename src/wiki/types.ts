export interface WikiPage {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
}
