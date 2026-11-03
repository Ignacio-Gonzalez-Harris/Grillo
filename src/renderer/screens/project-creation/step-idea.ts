/**
 * Step 4, Idea: written text with documents attached, or a transcript pasted or uploaded (prototype states `idea` and
 * `idea-transcript`).
 */
import { attachmentsFrom } from './form';
import type { WizardContext } from './wizard';
import { el, filePicker, pageHead, reasonNote, segmented, tag } from './view';

const TEXT_FILES = '.txt,.md,.markdown,.csv,.json,.vtt,.srt';
const TRANSCRIPT_FILES = '.txt,.md,.vtt,.srt';

export function ideaHead(): HTMLElement {
  return pageHead(
    'What is the idea?',
    'Describe what you want to build in your own words, or hand over the transcript of a conversation about it. Grillo asks for the rest later.',
  );
}

export function ideaCard(ctx: WizardContext): HTMLElement {
  const { form, busy, reason } = ctx;
  const text = form.ideaFormat === 'text';
  const area = el('textarea', '');
  area.setAttribute('aria-label', text ? 'The idea' : 'Transcript');
  area.placeholder = text
    ? 'The product idea in your own words: what it is for, who uses it, what goes wrong today.'
    : 'Paste the transcript of a recorded conversation, or upload its file.';
  area.value = text ? form.ideaText : form.transcript;
  area.disabled = busy;
  area.addEventListener('input', () => {
    if (text) form.ideaText = area.value;
    else form.transcript = area.value;
    ctx.clearReason();
  });
  const files = text
    ? el('div', 'row', [
        ...filePicker('Attach documents', {
          accept: TEXT_FILES,
          multiple: true,
          disabled: busy,
          onFiles: (picked) =>
            void ctx.act(async () => {
              form.attachments = [...form.attachments, ...(await attachmentsFrom(picked))];
            }),
        }),
        ...form.attachments.map((attachment, index) =>
          tag(attachment.name, busy ? undefined : () => {
            form.attachments = form.attachments.filter((_entry, at) => at !== index);
            ctx.redraw();
          }, 'none'),
        ),
      ])
    : el('div', 'row', [
        ...filePicker('Upload transcript file', {
          accept: TRANSCRIPT_FILES,
          multiple: false,
          disabled: busy,
          onFiles: (picked) =>
            void ctx.act(async () => {
              const [file] = await attachmentsFrom(picked);
              if (file) {
                form.transcript = file.text;
                ctx.clearReason();
              }
            }),
        }),
      ]);
  return el('div', 'card stack', [
    segmented(
      'Idea format',
      [
        { value: 'text', text: 'Write or paste text' },
        { value: 'transcript', text: 'Paste or upload a transcript' },
      ],
      form.ideaFormat,
      (format) => {
        form.ideaFormat = format;
        ctx.clearReason();
        ctx.redraw();
      },
      busy,
    ),
    area,
    ...(reason === null ? [] : [reasonNote(reason)]),
    files,
    el('p', 'small muted m0', [
      "Grillo always works towards a PRD (the product document). It then opens a grilling agent (an AI assistant that asks the questions) that builds the map (your project's overview), the tickets (pieces of work) and their questions.",
    ]),
  ]);
}
