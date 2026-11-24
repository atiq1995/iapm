'use client';
// Small, safe Markdown renderer for assistant answers.
// Builds React elements only (no innerHTML), so model output cannot inject markup.
// Record IDs such as [RIR-00012] or AST-1 become buttons that open the record.

import React from 'react';

type Props = { text: string; isKnown: (id: string) => boolean; onCite: (id: string) => void };

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[(?:RIR|AST|ACT)-[A-Za-z0-9-]+\]|\b(?:RIR|AST|ACT)-[A-Za-z0-9-]*[A-Za-z0-9]\b|\*(?=\S)[^*\n]*?\S\*(?![*\w]))/g;

function inline(text: string, p: Props, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(INLINE)) {
    const token = m[0], at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${i++}`;
    if (token.startsWith('**')) out.push(<strong key={k}>{inline(token.slice(2, -2), p, k)}</strong>);
    else if (token.startsWith('`')) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('*')) out.push(<em key={k}>{token.slice(1, -1)}</em>);
    else {
      const id = token.replace(/^\[|\]$/g, '');
      out.push(p.isKnown(id)
        ? <button type="button" key={k} className="asst-cite" onClick={() => p.onCite(id)} title="Open this record">{id}</button>
        : <span key={k} className="asst-cite unverified" title="Not found in the database: unverified">{id}</span>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const LIST = /^\s*([-*•]|\d+[.)])\s+/;

export function AssistantMarkdown(props: Props) {
  const lines = props.text.replace(/\r/g, '').split('\n');
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const k = `p${blocks.length}`;
    blocks.push(<p key={k}>{para.flatMap((l, i) => (i ? [<br key={`${k}b${i}`} />, ...inline(l, props, `${k}-${i}`)] : inline(l, props, `${k}-${i}`)))}</p>);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { flush(); const k = `h${blocks.length}`; blocks.push(<h4 key={k}>{inline(heading[1], props, k)}</h4>); continue; }
    if (line.trim().startsWith('|')) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      i--;
      const body = rows.filter(r => !isRule(r)).map(cells);
      const hasHead = rows.length > 1 && isRule(rows[1]);
      const head = hasHead ? body.shift() : undefined;
      const k = `t${blocks.length}`;
      blocks.push(
        <div className="asst-table" key={k}><table>
          {head && <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, props, `${k}h${j}`)}</th>)}</tr></thead>}
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, props, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (LIST.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(lines[i++].replace(LIST, ''));
      i--;
      const k = `l${blocks.length}`;
      const children = items.map((t, j) => <li key={j}>{inline(t, props, `${k}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    para.push(line);
  }
  flush();
  return <div className="asst-md">{blocks}</div>;
}
