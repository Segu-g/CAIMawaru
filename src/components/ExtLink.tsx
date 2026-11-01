import type { ReactNode } from 'react';
import { safeUrl } from '../filter';

type Props = { href: string | undefined; className?: string; children: ReactNode };

export default function ExtLink({ href, className, children }: Props) {
  const url = safeUrl(href);
  if (!url) return null;
  return (
    <a href={url} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
