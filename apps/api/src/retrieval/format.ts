export type AnswerShape = 'table' | 'bullets' | 'steps' | 'images' | 'pdf' | 'prose';

export function requestedShape(message: string): AnswerShape {
  const text = message.toLowerCase();
  if (/\btable\b/.test(text)) return 'table';
  if (text.includes('bullet')) return 'bullets';
  if (/step by step|numbered/.test(text)) return 'steps';
  if (/\b(photo|photograph|picture|image|gallery)s?\b/.test(text)) return 'images';
  if (/\bpdf\b/.test(text)) return 'pdf';
  return 'prose';
}

export function shapeInstruction(message: string): string {
  const shape = requestedShape(message);
  if (shape === 'table') {
    return 'The user asked for a table. Use one Markdown table. Write "Not in the official sources" for a missing cell. Do not invent rows.';
  }
  if (shape === 'bullets') {
    return 'The user asked for bullet points. Use a Markdown bullet list and do not use a table.';
  }
  if (shape === 'steps') {
    return 'The user asked for steps. Use a numbered Markdown list and do not use a table.';
  }
  if (shape === 'images') {
    return 'The user asked for images. Do not invent image addresses. Mention an image only when its official URL is in the evidence.';
  }
  if (shape === 'pdf') {
    return 'The user asked for a PDF. Link an official lbrce.ac.in PDF only when that URL is in the evidence. Do not claim a PDF was created.';
  }
  return 'Use short headings or paragraphs. Do not use a table unless the evidence is a grid or the user asked for a table.';
}
