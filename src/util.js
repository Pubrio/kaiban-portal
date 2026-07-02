// Pull a clean HTML document out of an agent's text output.
export function extractHtml(result) {
  let text = String(result ?? '').trim();
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/<!DOCTYPE html>|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (start !== -1 && end !== -1) text = text.slice(start, end + '</html>'.length);
  if (!/<html[\s>]/i.test(text)) {
    throw new Error('The crew output did not contain a valid HTML document.');
  }
  return text + '\n';
}
