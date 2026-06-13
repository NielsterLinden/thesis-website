import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/** Plain-prose markdown with GFM tables + KaTeX math, for figure captions and
 *  model notes. Assistant turns use their own renderer in Message.tsx, which
 *  additionally rewrites citation tokens into chips. */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}>
      {children}
    </ReactMarkdown>
  );
}
