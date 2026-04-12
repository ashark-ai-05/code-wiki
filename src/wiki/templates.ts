import type { ServiceNode, Edge } from '../graph/types.js';

export function frontmatter(
  fields: Record<string, unknown>
): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value.map((v) => `"${v}"`).join(', ')}]`
      );
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function serviceOverview(
  service: ServiceNode,
  edges: Edge[]
): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    summary: `${service.id} — ${service.type}`,
    source_repos: [service.id],
    source_pass: 'fingerprint',
    tags: [
      ...service.tech_stack.languages,
      ...service.tech_stack.frameworks,
    ],
  });

  const downstream = edges.filter((e) => e.from === service.id);
  const upstream = edges.filter((e) => e.to === service.id);

  let md = `${fm}# ${service.id}\n\n`;
  md +=
    '> Auto-generated from structural analysis. Run `code-wiki build` with LLM to generate detailed prose.\n\n';
  md += '## Tech Stack\n\n';
  md += `- **Languages:** ${service.tech_stack.languages.join(', ') || 'unknown'}\n`;
  md += `- **Frameworks:** ${service.tech_stack.frameworks.join(', ') || 'none detected'}\n`;
  md += `- **Build:** ${service.tech_stack.build.join(', ') || 'unknown'}\n\n`;

  if (downstream.length > 0) {
    md += '## Downstream Dependencies\n\n';
    for (const edge of downstream) {
      md += `- **${edge.to}** via ${edge.type}`;
      if (edge.details.topic)
        md += ` (topic: \`${edge.details.topic}\`)`;
      md += '\n';
    }
    md += '\n';
  }

  if (upstream.length > 0) {
    md += '## Upstream Dependencies\n\n';
    for (const edge of upstream) {
      md += `- **${edge.from}** via ${edge.type}`;
      if (edge.details.topic)
        md += ` (topic: \`${edge.details.topic}\`)`;
      md += '\n';
    }
    md += '\n';
  }

  return md;
}

export function serviceTechStack(service: ServiceNode): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  let md = `${fm}# ${service.id} — Tech Stack\n\n`;
  md += '| Category | Technologies |\n';
  md += '|----------|--------------|\n';
  md += `| Languages | ${service.tech_stack.languages.join(', ') || '-'} |\n`;
  md += `| Frameworks | ${service.tech_stack.frameworks.join(', ') || '-'} |\n`;
  md += `| Build | ${service.tech_stack.build.join(', ') || '-'} |\n`;
  md += `| Runtime | ${service.tech_stack.runtime.join(', ') || '-'} |\n`;
  md += `| Databases | ${service.tech_stack.databases.join(', ') || '-'} |\n`;

  return md;
}

export function serviceDependencies(
  service: ServiceNode,
  edges: Edge[]
): string {
  const fm = frontmatter({
    generated_by: 'code-wiki',
    generated_at: new Date().toISOString(),
    source_repos: [service.id],
  });

  const downstream = edges.filter((e) => e.from === service.id);
  const upstream = edges.filter((e) => e.to === service.id);

  let md = `${fm}# ${service.id} — Dependencies\n\n`;

  md += '## Downstream (this service calls)\n\n';
  if (downstream.length === 0) {
    md += 'No downstream dependencies detected.\n\n';
  } else {
    md += '| Target | Type | Details | Confidence |\n';
    md += '|--------|------|---------|------------|\n';
    for (const edge of downstream) {
      const detail = edge.details.topic
        ? `topic: ${edge.details.topic}`
        : JSON.stringify(edge.details);
      md += `| [[${edge.to}]] | ${edge.type} | ${detail} | ${edge.confidence} |\n`;
    }
    md += '\n';
  }

  md += '## Upstream (calls this service)\n\n';
  if (upstream.length === 0) {
    md += 'No upstream dependencies detected.\n\n';
  } else {
    md += '| Source | Type | Details | Confidence |\n';
    md += '|--------|------|---------|------------|\n';
    for (const edge of upstream) {
      const detail = edge.details.topic
        ? `topic: ${edge.details.topic}`
        : JSON.stringify(edge.details);
      md += `| [[${edge.from}]] | ${edge.type} | ${detail} | ${edge.confidence} |\n`;
    }
    md += '\n';
  }

  return md;
}

export function wikiIndex(
  services: ServiceNode[],
  edges: Edge[]
): string {
  let md = '# Code Wiki\n\n';
  md += `> Auto-generated codebase intelligence. Last updated: ${new Date().toISOString()}\n\n`;
  md += `## Services (${services.length})\n\n`;
  md += '| Service | Languages | Frameworks | Connections |\n';
  md += '|---------|-----------|------------|-------------|\n';

  for (const svc of services) {
    const connCount = edges.filter(
      (e) => e.from === svc.id || e.to === svc.id
    ).length;
    md += `| [[${svc.id}]] | ${svc.tech_stack.languages.join(', ')} | ${svc.tech_stack.frameworks.join(', ') || '-'} | ${connCount} |\n`;
  }
  md += '\n';

  md += '## Dependency Graph\n\n';
  md += '```mermaid\ngraph LR\n';
  for (const edge of edges) {
    const label = edge.details.topic
      ? String(edge.details.topic)
      : edge.type;
    md += `  ${edge.from} -->|${label}| ${edge.to}\n`;
  }
  md += '```\n';

  return md;
}
