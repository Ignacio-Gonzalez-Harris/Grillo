/**
 * The two export formats of a PRD version (PRD section 4.7 item 4): the Markdown file exactly as the store keeps it
 * (`.grillo/prd/v<n>.md`, docs/store-layout.md), and one self-contained HTML file whose only style is the liquid
 * glass tokens and the document stylesheet, inlined, so it opens anywhere with nothing to fetch.
 */
import type { PrdVersion } from '../../../main/store/types';
import { formatPrdVersion } from '../../../main/store/github/repo/records';
import tokensCss from '../../theme/tokens.css?raw';
import documentCss from './prd-doc.css?raw';
import { escapeHtml, renderPrdVersion } from './render';

/** A file the member saves. */
export interface ExportFile {
  name: string;
  type: string;
  content: string;
}

export type ExportFormat = 'markdown' | 'html';

/** How long a download's address stays valid: long enough for the save dialog, then its memory is freed. */
const KEEP_DOWNLOAD_URL_MS = 60_000;

type ExportedVersion = Pick<PrdVersion, 'number' | 'date' | 'body' | 'appendix'>;

/** The day of an ISO moment, as the screen and the files show it (`2026-10-22`). */
export function dayOf(moment: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(moment)?.[0] ?? moment;
}

/** `PRD · version 2`, the heading of a version on the screen and the title of its HTML file. */
export function versionTitle(number: number): string {
  return `PRD · version ${number}`;
}

/** `<repo>-prd-v<n>.<ext>`: which project and which version, in a name every system accepts. */
function fileName(project: string, number: number, extension: string): string {
  const repository = project.split('/').pop() ?? project;
  const safe = repository.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'project';
  return `${safe}-prd-v${number}.${extension}`;
}

/** The stored file, byte for byte as the store writes it: header lines, body, the appendix marker, the appendix. */
export function markdownExport(project: string, version: ExportedVersion): ExportFile {
  return { name: fileName(project, version.number, 'md'), type: 'text/markdown', content: formatPrdVersion(version) };
}

/** One HTML file holding everything it shows: no script, no stylesheet link, no image or font to load. */
export function htmlExport(project: string, version: ExportedVersion): ExportFile {
  const title = escapeHtml(versionTitle(version.number));
  const content = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>\n${tokensCss}\n${documentCss}\n</style>`,
    '</head>',
    '<body class="prd-export">',
    '<article class="prd-doc">',
    `<p class="prd-doc-meta">${escapeHtml(project)} · ${title} · ${escapeHtml(dayOf(version.date))}</p>`,
    renderPrdVersion(version),
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { name: fileName(project, version.number, 'html'), type: 'text/html', content };
}

export function exportFile(format: ExportFormat, project: string, version: ExportedVersion): ExportFile {
  return format === 'markdown' ? markdownExport(project, version) : htmlExport(project, version);
}

/** Hands the file to the browser as a download: Electron asks the member where to save it. */
export function saveFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: `${file.type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), KEEP_DOWNLOAD_URL_MS);
}
