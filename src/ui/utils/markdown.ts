/**
 * Markdown processing
 * Uses marked for parsing and cli-highlight for code syntax highlighting
 */
import { marked, Token } from 'marked';
import chalk from 'chalk';
import { EOL } from 'os';
import { highlight, supportsLanguage } from 'cli-highlight';

/**
 * Apply markdown formatting to content
 */
export function applyMarkdown(content: string): string {
  try {
    return marked
      .lexer(content)
      .map(token => format(token))
      .join('')
      .trim();
  } catch {
    // If parsing fails, return original content
    return content;
  }
}

function format(
  token: Token,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
): string {
  switch (token.type) {
    case 'blockquote':
      return chalk.dim.italic((token.tokens ?? []).map(t => format(t)).join(''));

    case 'code':
      if (token.lang && supportsLanguage(token.lang)) {
        return highlight(token.text, { language: token.lang }) + EOL;
      } else {
        // Fallback to markdown highlighting
        return highlight(token.text, { language: 'markdown' }) + EOL;
      }

    case 'codespan':
      // inline code
      return chalk.blue(token.text);

    case 'em':
      return chalk.italic((token.tokens ?? []).map(t => format(t)).join(''));

    case 'strong':
      return chalk.bold((token.tokens ?? []).map(t => format(t)).join(''));

    case 'heading':
      switch (token.depth) {
        case 1: // h1
          return (
            chalk.bold.italic.underline(
              (token.tokens ?? []).map(t => format(t)).join(''),
            ) +
            EOL +
            EOL
          );
        case 2: // h2
          return (
            chalk.bold((token.tokens ?? []).map(t => format(t)).join('')) +
            EOL +
            EOL
          );
        default: // h3+
          return (
            chalk.bold.dim((token.tokens ?? []).map(t => format(t)).join('')) +
            EOL +
            EOL
          );
      }

    case 'hr':
      return '---' + EOL;

    case 'image':
      return `[Image: ${token.title || token.text}: ${token.href}]`;

    case 'link':
      return chalk.blue.underline(token.href);

    case 'list': {
      return token.items
        .map((_: Token, index: number) =>
          format(
            _,
            listDepth,
            token.ordered ? token.start + index : null,
            token,
          ),
        )
        .join('');
    }

    case 'list_item':
      return (token.tokens ?? [])
        .map(
          t =>
            `${'  '.repeat(listDepth)}${format(t, listDepth + 1, orderedListNumber, token)}`,
        )
        .join('');

    case 'paragraph':
      return (token.tokens ?? []).map(t => format(t)).join('') + EOL;

    case 'space':
      return EOL;

    case 'text':
      if (parent?.type === 'list_item') {
        const bullet = orderedListNumber === null ? '-' : `${orderedListNumber}.`;
        const text = token.tokens
          ? token.tokens.map(t => format(t, listDepth, orderedListNumber, token)).join('')
          : token.text;
        return `${bullet} ${text}${EOL}`;
      } else {
        return token.tokens
          ? token.tokens.map(t => format(t)).join('')
          : token.text;
      }
  }

  return '';
}
